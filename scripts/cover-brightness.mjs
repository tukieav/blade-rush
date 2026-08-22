// Hard Round 4 cover acceptance gate: luminance and saturation on rendered PNGs.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const files = ['marketing/cover-16x9.png', 'marketing/cover-2x3.png', 'marketing/cover-1x1.png'];
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();
let failed = 0;
for (const file of files) {
  const src = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  const value = await page.evaluate(async (src) => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lum = 0, dark = 0, sat = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255, max=Math.max(r,g,b), min=Math.min(r,g,b);
      const l = (0.2126*r + 0.7152*g + 0.0722*b) * 255;
      lum += l; dark += l < 40 ? 1 : 0; sat += max === 0 ? 0 : (max-min)/max; n++;
    }
    return { meanLum: lum/n, darkFrac: dark/n, meanSat: sat/n };
  }, src);
  const ok = value.meanLum >= 80 && value.darkFrac <= .35 && value.meanSat >= .35;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} meanLum=${value.meanLum.toFixed(2)} darkFrac=${value.darkFrac.toFixed(4)} meanSat=${value.meanSat.toFixed(4)}`);
  if (!ok) failed++;
}
await browser.close();
console.log(failed ? `${failed} COVER BRIGHTNESS GATES FAILED` : 'ALL COVER BRIGHTNESS GATES PASSED');
if (failed) process.exit(1);
