// QA screenshot capture: menu, gameplay wood/metal/energy, boss, break, armory
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:8527';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__astro && window.__astro.booted());
await page.waitForTimeout(600);
const shot = (n) => page.screenshot({ path: 'marketing/qa-' + n + '.png' });
await shot('menu');
await page.screenshot({ path: 'marketing/screenshot-menu.png' });
// gameplay wood (level 1) with some stuck blades
await page.evaluate(() => window.__astro.setLevel(1));
await page.waitForTimeout(200);
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(500); }
await shot('wood');
await page.screenshot({ path: 'marketing/screenshot-gameplay.png' });
// metal (level 3)
await page.evaluate(() => window.__astro.setLevel(3));
for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(500); }
await shot('metal');
// energy (level 7)
await page.evaluate(() => window.__astro.setLevel(7));
for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(500); }
await shot('energy');
// boss (level 5)
await page.evaluate(() => window.__astro.setLevel(5));
for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__astro.throwNow()); await page.waitForTimeout(500); }
await shot('boss');
// mid-break (win level -> capture pieces flying)
await page.evaluate(() => window.__astro.winLevel());
await page.waitForTimeout(350);
await shot('break');
// impact sparks: new level, throw, screenshot right at impact
await page.waitForTimeout(1500);
await page.evaluate(() => window.__astro.setLevel(2));
await page.evaluate(() => window.__astro.throwNow());
await page.waitForTimeout(260);
await shot('impact');
// armory
await page.evaluate(() => { window.__astro.addShards(600); window.__astro.goMenu(); window.__astro.openShop(); });
await page.waitForTimeout(500);
await shot('armory');
await browser.close();
console.log('shots done');
