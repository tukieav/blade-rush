// Round 4 visual evidence: all cover variants plus the first menu frame at 907x510.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8527';
const files = ['cover-16x9.png', 'cover-2x3.png', 'cover-1x1.png'];
mkdirSync('qa/round4', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
for (const file of files) {
  const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
  const src = 'data:image/png;base64,' + readFileSync('marketing/' + file).toString('base64');
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#ec3d9a,#ffad45)}img{width:100%;height:100%;object-fit:contain}</style><img src="${src}">`);
  await page.screenshot({ path: 'qa/round4/907x510-' + file });
  await page.close();
}
const menu = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
await menu.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await menu.waitForFunction(() => window.__astro && window.__astro.booted(), null, { timeout: 20000 });
await menu.waitForTimeout(350);
await menu.screenshot({ path: 'qa/round4/907x510-menu.png' });
await menu.screenshot({ path: 'marketing/screenshot-menu.png' });
await menu.close();
await browser.close();
console.log('Round 4 cover and menu shots written');
