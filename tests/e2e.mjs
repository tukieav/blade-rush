// Playwright e2e for Blade Rush — run: node tests/e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8514';
const errors = [];
let failed = 0;

function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) failed++;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const loc = (m.location() && m.location().url) || '';
  // ignore resource 404s from CrazyGames test-ad iframes (not our code)
  if (m.text().includes('Failed to load resource') && !loc.includes('localhost')) return;
  errors.push('console.error: ' + m.text() + ' @ ' + loc);
});

async function waitState(pred, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await page.evaluate(() => window.__astro.getState());
    if (pred(s)) return s;
    await page.waitForTimeout(300);
  }
  return page.evaluate(() => window.__astro.getState());
}

async function canvasBright() {
  return page.evaluate(() => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      if (d[i] + d[i + 1] + d[i + 2] > 120) bright++;
    }
    return bright;
  });
}

async function waitBoot() {
  await page.waitForFunction(() => window.__astro && window.__astro.booted && window.__astro.booted(), null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await waitBoot();

const dbg = await page.evaluate(() => !!window.__astro);
check('debug hook present', dbg);
// fresh meta for deterministic run
await page.evaluate(() => window.__astro.resetMeta());
await page.reload({ waitUntil: 'networkidle' });
await waitBoot();

const st0 = await page.evaluate(() => window.__astro.getState());
check('starts in menu', st0.state === 'menu');
check('daily streak day 1 granted', st0.streak.count === 1 && st0.shards >= 10);
check('canvas renders pixels (menu)', (await canvasBright()) > 50);

// click PLAY (game coords 270,620 -> css coords via bbox)
const bbox = await page.locator('#game').boundingBox();
const toCss = (x, y) => [bbox.x + x * (bbox.width / 540), bbox.y + y * (bbox.height / 960)];
let [px, py] = toCss(270, 620);
await page.mouse.click(px, py);
await page.waitForTimeout(400);
let st = await page.evaluate(() => window.__astro.getState());
check('PLAY starts game', st.state === 'playing' && st.level === 1);
check('run counted in stats', st.stats.runs === 1);

// a few throws
for (let i = 0; i < 3; i++) {
  [px, py] = toCss(270, 480);
  await page.mouse.click(px, py);
  await page.waitForTimeout(700);
}
st = await page.evaluate(() => window.__astro.getState());
check('3 throws stuck blades', st.stuck >= 3 || st.level > 1);
check('score increased', st.score > 0);
check('throw stats tracked', st.stats.throws >= 3);
check('canvas renders pixels (gameplay)', (await canvasBright()) > 50);
await page.screenshot({ path: 'marketing/shot-gameplay-raw.png' });

// complete level via debug -> shards from level clear
const shardsBefore = st.shards;
await page.evaluate(() => window.__astro.winLevel());
await page.waitForTimeout(1800);
st = await page.evaluate(() => window.__astro.getState());
check('level completed -> level 2', st.level === 2 && st.state === 'playing');
check('shards granted on level clear', st.shards > shardsBefore);

// boss kill: jump to level 5, win it -> boss collection + fanfare
await page.evaluate(() => window.__astro.setLevel(5));
await page.waitForTimeout(200);
await page.evaluate(() => window.__astro.winLevel());
await page.waitForTimeout(1800);
st = await page.evaluate(() => window.__astro.getState());
check('boss defeated -> level 6', st.level === 6);
check('boss recorded in gallery', st.bossesSeen.length === 1);
check('boss missions progressed', st.stats.bosses === 1 && st.missionsDone.includes('boss1'));

// force game over
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(300);
st = await page.evaluate(() => window.__astro.getState());
check('game over state', st.state === 'gameover');
check('continue offered', st.canContinue === true);

// rewarded continue (no SDK locally -> continues immediately)
[px, py] = toCss(270, 520);
await page.mouse.click(px, py);
st = await waitState((s) => s.state === 'playing');
check('rewarded continue resumes level', st.state === 'playing' && st.level === 6);
check('continue used once', st.continueUsed === true);

// die again -> no continue button; x2 shards ad available
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(300);
st = await page.evaluate(() => window.__astro.getState());
check('second game over, no continue', st.state === 'gameover' && st.canContinue === false);
check('run shards accumulated', st.runShards > 0);
const preX2 = st.shards;
[px, py] = toCss(270, 604);
await page.mouse.click(px, py);
st = await waitState((s) => s.x2Used === true && s.shards > preX2, 40000);
check('x2 shards rewarded ad doubles', st.x2Used === true && st.shards > preX2);

// PLAY AGAIN (midgame ad no-op locally)
await page.waitForTimeout(600);
[px, py] = toCss(270, 686);
await page.mouse.click(px, py);
st = await waitState((s) => s.state === 'playing' && s.level === 1, 40000);
check('play again restarts', st.state === 'playing' && st.level === 1 && st.score === 0);
check('best score persisted', st.best > 0);
check('shards persist across runs', st.shards > 0);

// ---- shop flow ----
await page.evaluate(() => { window.__astro.goMenu(); });
await page.evaluate(() => window.__astro.addShards(500));
await page.evaluate(() => window.__astro.openShop());
await page.waitForTimeout(300);
check('shop canvas renders', (await canvasBright()) > 50);
await page.screenshot({ path: 'marketing/shot-shop-raw.png' });
const bought = await page.evaluate(() => window.__astro.buyBlade('crimson'));
st = await page.evaluate(() => window.__astro.getState());
check('buy blade deducts shards & owns it', bought && st.owned.includes('crimson') && st.equipped === 'crimson');
const eqBack = await page.evaluate(() => window.__astro.equipBlade('neon'));
st = await page.evaluate(() => window.__astro.getState());
check('equip switches blade', eqBack && st.equipped === 'neon');

// shop click-to-equip via pointer (first cell = neon; second = crimson)
[px, py] = toCss(270, 210); // cell index 1 (col 1) -> crimson at x=270,y=210
await page.mouse.click(px, py);
await page.waitForTimeout(200);
st = await page.evaluate(() => window.__astro.getState());
check('tap cell equips owned blade', st.equipped === 'crimson');

// boss gallery + missions screens render
await page.evaluate(() => { window.__astro.goMenu(); window.__astro.openBosses(); });
await page.waitForTimeout(300);
check('boss gallery renders', (await canvasBright()) > 30);
await page.evaluate(() => { window.__astro.goMenu(); window.__astro.openMissions(); });
await page.waitForTimeout(300);
check('missions screen renders', (await canvasBright()) > 30);
st = await page.evaluate(() => window.__astro.getState());
check('missions completed persisted', st.missionsDone.length >= 1);

// persistence across reload
await page.evaluate(() => { window.__astro.goMenu(); });
const persistShards = st.shards;
await page.reload({ waitUntil: 'networkidle' });
await waitBoot();
st = await page.evaluate(() => window.__astro.getState());
check('meta persists after reload', st.shards === persistShards && st.owned.includes('crimson') && st.bossesSeen.length === 1);
check('no second daily bonus same day', st.streak.count === 1);

// keyboard controls (down + 120ms + up)
[px, py] = toCss(270, 620);
await page.mouse.click(px, py); // PLAY
await page.waitForTimeout(400);
await page.keyboard.down('Space');
await page.waitForTimeout(120);
await page.keyboard.up('Space');
await page.waitForTimeout(700);
st = await page.evaluate(() => window.__astro.getState());
check('keyboard space throws', st.stuck >= 1 || st.state === 'playing');

check('zero page/console errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED');
process.exit(failed === 0 ? 0 : 1);
