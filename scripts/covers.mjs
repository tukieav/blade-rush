// Render gameplay covers + polished screenshots from cover-gameplay.html
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const MIME = { '.html': 'text/html', '.png': 'image/png' };
const REQUESTED_PORT = Number(process.env.R3_COVER_PORT || 0);
const srv = createServer((req, res) => {
  const p = 'marketing' + decodeURIComponent(req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => srv.listen(REQUESTED_PORT, r));
const PORT = srv.address().port;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
async function render(w, h, out, extra = '') {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${PORT}/cover-gameplay.html?w=${w}&h=${h}${extra}`);
  await page.waitForFunction(() => document.title === 'done', null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'marketing/' + out, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log(out, 'done');
}
await render(1920, 1080, 'cover-16x9.png');
await render(800, 800, 'cover-1x1.png');
await render(800, 1200, 'cover-2x3.png');
await browser.close();
srv.close();
