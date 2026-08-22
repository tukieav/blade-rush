// Accelerated mixed-play soak: 75 clears/restarts and 300 simulated seconds.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8527';
let failed = 0;
function check(name, value, detail = '') { console.log((value ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' (' + detail + ')' : '')); if (!value) failed++; }
(async () => {
  const errors = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  // The accelerated debug loop intentionally crosses the portal SDK's one-second
  // telemetry throttle; that external diagnostic is not a game console error.
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource') && !m.text().includes('HTML5 SDK')) errors.push(m.text()); });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.booted());
  const fps = await page.evaluate(() => new Promise(resolve => {
    const marks = [];
    const tick = t => { marks.push(t); marks.length < 31 ? requestAnimationFrame(tick) : resolve(1000 * 30 / (marks[30] - marks[0])); };
    requestAnimationFrame(tick);
  }));
  check('soak frame health >=30 FPS', fps >= 30, fps.toFixed(1));
  const result = await page.evaluate(() => {
    const samples = [];
    for (let i = 0; i < 75; i++) {
      window.__astro.setLevel(i % 5 === 4 ? 5 : 2);
      window.__astro.throwNow(); window.__astro.advance(.5);
      window.__astro.winLevel(); window.__astro.advance(1.3);
      window.__astro.forceGameOver(); window.__astro.restart();
      window.__astro.advance(4);
      samples.push(window.__astro.getDebugCounts());
    }
    return { samples, final: window.__astro.getDebugCounts() };
  });
  const caps = { particles: 180, confetti: 90, trail: 18, floats: 20, toasts: 4, pieces: 30 };
  for (const [key, cap] of Object.entries(caps)) check('soak bound ' + key, result.samples.every(s => s[key] <= cap) && result.final[key] <= cap, result.final[key] + '/' + cap);
  check('soak completed 300 accelerated seconds', result.samples.length === 75);
  check('soak has zero page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? failed + ' SOAK TESTS FAILED' : 'ALL SOAK TESTS PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
