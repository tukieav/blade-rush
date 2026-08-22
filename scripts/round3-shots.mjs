// Focused visual evidence for the two Round 3 game-feel improvements.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8733';
mkdirSync('qa/round3', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro && window.__astro.booted());

await page.evaluate(() => {
  window.__astro.setLevel(1);
  for (let i = 0; i < 3; i++) {
    window.__astro.throwNow();
    window.__astro.advance(.5);
  }
});
await page.screenshot({ path: 'qa/round3/907x510-combo-wave.png' });

await page.evaluate(() => window.__astro.winLevel());
await page.waitForTimeout(32);
await page.screenshot({ path: 'qa/round3/907x510-break-frame.png' });
await browser.close();
console.log('Round 3 quality screenshots written');
