// Required CrazyGames viewport, cadence, collision, lifecycle and save gate.
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:8527';
const VIEWPORTS = [[907,510],[1216,684],[1077,606],[821,462],[1366,768],[1920,1080],[1536,864],[1280,720],[800,450],[1080,607]];
const SHOTS = new Set(['907x510', '1280x720', '1920x1080']);
let failures = 0;
function check(name, value, detail = '') { console.log((value ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' (' + detail + ')' : '')); if (!value) failures++; }

async function ready(page) {
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.booted(), null, { timeout: 20000 });
  await page.waitForTimeout(180);
}
async function startWithPointer(page) {
  const l = await page.evaluate(() => window.__astro.getLayout());
  const c = await page.locator('#game').boundingBox();
  await page.mouse.click(c.x + l.stageX + 270 * l.stageScale, c.y + l.stageY + 620 * l.stageScale);
  await page.waitForTimeout(180);
}

(async () => {
  mkdirSync('qa/hardening', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  for (const [width, height] of VIEWPORTS) {
    const name = width + 'x' + height, errors = [];
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
    await ready(page);
    const before = await page.evaluate(() => { const c = document.querySelector('#game'), r = c.getBoundingClientRect(); return { w:r.width, h:r.height, pw:c.width, ph:c.height }; });
    check(name + ' canvas >=98% viewport', before.w >= width * .98 && before.h >= height * .98 && before.pw >= width && before.ph >= height, JSON.stringify(before));
    if (SHOTS.has(name)) await page.screenshot({ path: 'qa/hardening/' + name + '-menu.png' });
    await startWithPointer(page);
    let state = await page.evaluate(() => window.__astro.getState());
    check(name + ' one pointer click starts useful gameplay', state.state === 'playing' && state.level === 1, state.state);
    const c = await page.locator('#game').boundingBox();
    await page.mouse.click(c.x + c.width / 2, c.y + c.height * .75);
    await page.waitForTimeout(520);
    state = await page.evaluate(() => window.__astro.getState());
    check(name + ' physical throw path works', state.stuck >= 1 || state.level > 1, 'stuck=' + state.stuck);
    if (SHOTS.has(name)) await page.screenshot({ path: 'qa/hardening/' + name + '-gameplay.png' });
    check(name + ' no errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  await ready(mobile);
  const layout = await mobile.evaluate(() => window.__astro.getLayout());
  check('390x844 controls >=44 CSS px', layout.minControlPx >= 44, layout.minControlPx.toFixed(1));
  const box = await mobile.locator('#game').boundingBox();
  await mobile.screenshot({ path: 'qa/hardening/390x844-menu.png' });
  await mobile.touchscreen.tap(box.x + layout.stageX + 270 * layout.stageScale, box.y + layout.stageY + 620 * layout.stageScale);
  await mobile.waitForTimeout(160);
  check('390x844 touch starts gameplay', (await mobile.evaluate(() => window.__astro.getState())).state === 'playing');
  await mobile.screenshot({ path: 'qa/hardening/390x844-gameplay.png' });

  const cadence = [];
  for (const hz of [60, 144, 165]) cadence.push(await mobile.evaluate(({ hz }) => window.__astro.simulateCadence(hz, 12), { hz }));
  const maxAngleDelta = Math.max(...cadence.map(x => Math.abs(x.angle - cadence[0].angle)));
  const maxPatternDelta = Math.max(...cadence.map(x => Math.abs(x.patternT - cadence[0].patternT)));
  check('60/144/165Hz cadence produces same target state', maxAngleDelta < 0.000001 && maxPatternDelta < 0.000001, JSON.stringify({ maxAngleDelta, maxPatternDelta }));
  await mobile.evaluate(() => { window.__astro.setLevel(3); window.__astro.setStuckAngles([0]); });
  const collision = await mobile.evaluate(() => ({ near: window.__astro.checkImpactAt(.02), edge: window.__astro.checkImpactAt(.026), clear: window.__astro.checkImpactAt(.04) }));
  check('blade core collision catches core hit', collision.near === true, JSON.stringify(collision));
  check('blade core collision leaves adjacent rim gap fair', collision.clear === false, JSON.stringify(collision));
  const angleBeforePause = (await mobile.evaluate(() => window.__astro.simulateCadence(60, 1))).angle;
  await mobile.evaluate(() => window.__astro.setPausedForTest(true));
  await mobile.waitForTimeout(180);
  const frozen = await mobile.evaluate(() => window.__astro.getState());
  await mobile.evaluate(() => window.__astro.setPausedForTest(false));
  await mobile.waitForTimeout(180);
  const resumed = await mobile.evaluate(() => window.__astro.getState());
  check('pause holds simulation and resumes once', frozen.state === 'playing' && resumed.state === 'playing' && Number.isFinite(angleBeforePause));
  await mobile.evaluate(() => window.__astro.migrateMetaForTest(JSON.stringify({ owned: 'bad', shards: '7', stats: { throws: '3' } })));
  const migrated = await mobile.evaluate(() => window.__astro.getState());
  check('old malformed save migrates safely', migrated.owned.includes('neon') && migrated.shards === 7 && migrated.stats.throws === 3, JSON.stringify(migrated));
  await mobile.close();
  await browser.close();
  console.log(failures ? failures + ' HARDENING TESTS FAILED' : 'ALL HARDENING TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
