// Record gameplay preview videos (<20s) with the new art
import { chromium } from 'playwright';
const BASE = 'http://localhost:8527';

async function record(w, h, dir) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, recordVideo: { dir, size: { width: w, height: h } } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.booted());
  await page.waitForTimeout(800);
  // start + play through levels incl. boss
  await page.evaluate(() => window.__astro.setLevel(1));
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(650); }
  await page.evaluate(() => window.__astro.winLevel());
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.__astro.setLevel(5));
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(600); }
  await page.evaluate(() => window.__astro.winLevel());
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__astro.setLevel(7));
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(600); }
  await ctx.close();
  await browser.close();
}
await record(540, 960, 'marketing/vid-portrait');
await record(960, 540, 'marketing/vid-landscape');
console.log('recorded');
