// Full-viewport visual smoke test for the desktop arena overhaul.
// Run after `npm run build` with a static server on BASE_URL (defaults to :8527).
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:8527';
const cases = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '390x844', width: 390, height: 844 },
];
let failures = 0;

function check(label, condition, detail = '') {
  console.log((condition ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!condition) failures++;
}

async function inspectViewport(browser, spec) {
  const errors = [];
  const page = await browser.newPage({ viewport: spec, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() && m.location().url) || '';
    if (m.text().includes('Failed to load resource') && !loc.includes('localhost')) return;
    errors.push('console.error: ' + m.text());
  });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.booted(), null, { timeout: 20000 });
  await page.waitForTimeout(500);

  const canvas = await page.evaluate(() => {
    const c = document.getElementById('game');
    const box = c.getBoundingClientRect();
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const alive = (x, y) => {
      const i = (Math.floor(y) * c.width + Math.floor(x)) * 4;
      return data[i] + data[i + 1] + data[i + 2] > 12;
    };
    const samples = [];
    for (let n = 0; n < 20; n++) {
      const t = (n + 0.5) / 20;
      samples.push(alive(1, (c.height - 2) * t), alive(c.width - 2, (c.height - 2) * t));
    }
    return { cssW: box.width, cssH: box.height, pxW: c.width, pxH: c.height, edgeAlive: samples.filter(Boolean).length, edgeTotal: samples.length };
  });
  check(spec.name + ' canvas fills viewport', Math.abs(canvas.cssW - spec.width) < 1 && Math.abs(canvas.cssH - spec.height) < 1,
    canvas.cssW + 'x' + canvas.cssH);
  check(spec.name + ' DPR backing canvas matches viewport', canvas.pxW >= spec.width && canvas.pxH >= spec.height,
    canvas.pxW + 'x' + canvas.pxH);
  check(spec.name + ' arena edge pixels alive', canvas.edgeAlive === canvas.edgeTotal,
    canvas.edgeAlive + '/' + canvas.edgeTotal);
  if (spec.width < 600) {
    const layout = await page.evaluate(() => window.__astro.getLayout());
    check(spec.name + ' touch controls are at least 44px', layout.minControlPx >= 44, layout.minControlPx.toFixed(1) + 'px');
  }

  await page.evaluate(() => window.__astro.setLevel(1));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__astro.throwNow());
  await page.waitForTimeout(800);
  let state = await page.evaluate(() => window.__astro.getState());
  check(spec.name + ' throw registers', state.stuck >= 1 || state.level > 1, 'stuck=' + state.stuck);
  await page.evaluate(() => window.__astro.winLevel());
  await page.waitForTimeout(1450);
  state = await page.evaluate(() => window.__astro.getState());
  check(spec.name + ' level clear advances', state.level === 2 && state.state === 'playing', 'level=' + state.level + ', state=' + state.state);

  // Capture the settled arena, not the intentionally loud clear-toast frame.
  await page.waitForTimeout(1300);
  await page.screenshot({ path: 'qa/desktop/' + spec.name + '.png' });
  check(spec.name + ' zero page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

(async () => {
  mkdirSync('qa/desktop', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  for (const spec of cases) await inspectViewport(browser, spec);
  await browser.close();
  console.log(failures === 0 ? 'ALL DESKTOP ARENA TESTS PASSED' : failures + ' DESKTOP ARENA TESTS FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
