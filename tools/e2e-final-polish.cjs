// Focused regression proof for the three final-polish defects.
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:8527';
let failures = 0;
function check(name, value, detail = '') {
  console.log((value ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' (' + detail + ')' : ''));
  if (!value) failures++;
}

(async () => {
  const errors = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.booted(), null, { timeout: 20000 });

  const reversal = await page.evaluate(() => {
    window.__astro.setLevel(5);
    window.__astro.advance(4);
    return window.__astro.getPatternForTest();
  });
  check('active reversal reports its current state', reversal.active && reversal.label === 'REVERSING NOW', JSON.stringify(reversal));
  check('mutation proof: active reversal is not labelled incoming', reversal.label !== 'REVERSAL INCOMING', reversal.label);

  const toast = await page.evaluate(() => {
    window.__astro.migrateMetaForTest(JSON.stringify({ stats: { throws: 9 } }));
    window.__astro.setLevel(1);
    window.__astro.throwNow();
    window.__astro.advance(.4);
    return window.__astro.getToastLayoutForTest();
  });
  check('mission feedback stays below target telegraph', toast.count === 1 && toast.top > toast.cueBottom, JSON.stringify(toast));
  check('mutation proof: legacy toast position intersects target', 150 < toast.targetBottom, JSON.stringify(toast));

  const mobile = await page.evaluate(() => {
    window.__astro.setLevel(1);
    window.__astro.winLevel();
    window.__astro.advance(1.3);
    window.__astro.forceGameOver();
    return { layout: window.__astro.getLayout(), state: window.__astro.getState() };
  });
  check('390x844 x2 reward target is at least 44 CSS px', mobile.state.state === 'gameover' && mobile.state.runShards > 0 && mobile.layout.x2ControlPx >= 44, JSON.stringify(mobile));
  check('mutation proof: old 60px x2 target fails at 390x844', 60 * mobile.layout.stageScale < 44, mobile.layout.stageScale.toFixed(4));

  check('final polish flow has zero page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' FINAL POLISH TESTS FAILED' : 'ALL FINAL POLISH TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
