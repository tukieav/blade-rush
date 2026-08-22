// Render title-only bright covers from the procedural cover illustration.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const MIME = { '.html': 'text/html', '.png': 'image/png' };
const server = createServer((req, res) => {
  const file = 'marketing' + decodeURIComponent(req.url.split('?')[0]);
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
async function render(w, h, name) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${port}/cover.html?w=${w}&h=${h}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready');
  await page.screenshot({ path: 'marketing/' + name, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close(); console.log(name + ' rendered');
}
await render(1920, 1080, 'cover-16x9.png');
await render(800, 1200, 'cover-2x3.png');
await render(800, 800, 'cover-1x1.png');
await browser.close(); server.close();
