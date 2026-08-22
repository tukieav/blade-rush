// Record fresh gameplay, then compose the portal-ready MP4s. Each video opens
// on its matching cover for 0.7s and contains only live gameplay afterwards.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://localhost:8527';
const GAMEPLAY_SECONDS = 15.3;
const COVER_SECONDS = 0.7;
const OUT_SECONDS = GAMEPLAY_SECONDS + COVER_SECONDS;

async function record({ width, height, name, cover }) {
  const dir = `marketing/.round3-${name}-raw`;
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir, size: { width, height } },
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.booted());

  // The final 15.3s are deliberately all gameplay. Capturing a longer source
  // lets us discard browser navigation/boot frames without faking gameplay.
  for (let i = 0; i < 7; i++) {
    await page.evaluate((n) => window.__astro.setLevel(n), i % 3 === 0 ? 5 : i % 3 === 1 ? 3 : 7);
    await page.waitForTimeout(360);
    await page.evaluate(() => window.__astro.throwNow());
    await page.waitForTimeout(720);
    await page.evaluate(() => window.__astro.winLevel());
    await page.waitForTimeout(1320);
  }
  await page.evaluate(() => window.__astro.setLevel(7));
  await page.waitForTimeout(4200);

  const video = page.video();
  await page.close();
  await ctx.close();
  const raw = await video.path();
  await browser.close();

  execFileSync('ffmpeg', [
    '-y', '-loop', '1', '-t', String(COVER_SECONDS), '-i', cover,
    '-sseof', '-' + GAMEPLAY_SECONDS, '-i', raw,
    '-filter_complex',
    `[0:v]scale=${width}:${height}:flags=lanczos,setsar=1[cover];[1:v]scale=${width}:${height}:flags=lanczos,setsar=1[game];[cover][game]concat=n=2:v=1:a=0[v]`,
    '-map', '[v]', '-t', String(OUT_SECONDS), '-r', '30', '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', `marketing/${name}.mp4`,
  ], { stdio: 'inherit' });
}

await record({ width: 1920, height: 1080, name: 'video-landscape', cover: 'marketing/cover-16x9.png' });
await record({ width: 800, height: 1200, name: 'video-portrait', cover: 'marketing/cover-2x3.png' });
console.log('Round 3 MP4s recorded and composed.');
