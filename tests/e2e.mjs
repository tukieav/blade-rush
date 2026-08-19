// Playwright e2e for Blade Rush — run: node tests/e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8483';
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

await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const dbg = await page.evaluate(() => !!window.__astro);
check('debug hook present', dbg);

const st0 = await page.evaluate(() => window.__astro.getState());
check('starts in menu', st0.state === 'menu');

// click PLAY (game coords 270,640 -> css coords via bbox)
const bbox = await page.locator('#game').boundingBox();
const toCss = (x, y) => [bbox.x + x * (bbox.width / 540), bbox.y + y * (bbox.height / 960)];
let [px, py] = toCss(270, 640);
await page.mouse.click(px, py);
await page.waitForTimeout(400);
let st = await page.evaluate(() => window.__astro.getState());
check('PLAY starts game', st.state === 'playing' && st.level === 1);

// a few throws
for (let i = 0; i < 3; i++) {
  [px, py] = toCss(270, 480);
  await page.mouse.click(px, py);
  await page.waitForTimeout(700);
}
st = await page.evaluate(() => window.__astro.getState());
check('3 throws stuck blades', st.stuck >= 3 || st.level > 1);
check('score increased', st.score > 0);
await page.screenshot({ path: 'marketing/shot-gameplay-raw.png' });

// complete level via debug
await page.evaluate(() => window.__astro.winLevel());
await page.waitForTimeout(1800);
st = await page.evaluate(() => window.__astro.getState());
check('level completed -> level 2', st.level === 2 && st.state === 'playing');

// force game over
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(300);
st = await page.evaluate(() => window.__astro.getState());
check('game over state', st.state === 'gameover');
check('continue offered', st.canContinue === true);

// rewarded continue (no SDK locally -> continues immediately)
[px, py] = toCss(270, 560);
await page.mouse.click(px, py);
st = await waitState((s) => s.state === 'playing');
check('rewarded continue resumes level', st.state === 'playing' && st.level === 2);
check('continue used once', st.continueUsed === true);

// die again -> no continue button
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(300);
st = await page.evaluate(() => window.__astro.getState());
check('second game over, no continue', st.state === 'gameover' && st.canContinue === false);

// PLAY AGAIN (midgame ad no-op locally)
[px, py] = toCss(270, 660);
await page.mouse.click(px, py);
st = await waitState((s) => s.state === 'playing');
check('play again restarts', st.state === 'playing' && st.level === 1 && st.score === 0);
check('best score persisted', st.best > 0);

check('zero page/console errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED');
process.exit(failed === 0 ? 0 : 1);
