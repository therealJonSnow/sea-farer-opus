// usage: node tools/shoot.mjs outdir [shots=0,1,2,3,4,5] [w=2560] [h=1440]
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('..', import.meta.url).pathname;
const [out = 'shots', list = '0,1,2,3,4,5', W = 2560, H = 1440] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync(root + 'index.html')); }).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
for (const s of list.split(',')) {
  const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 600)); });
  p.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 800)));
  const t0 = Date.now();
  await p.goto(`http://localhost:${port}/?shot=${s}&w=${W}&h=${H}`);
  try { await p.waitForFunction('window.__ready === true', null, { timeout: 300000 }); } catch (e) { console.log('timeout', s, await p.evaluate(() => document.body.innerText)); }
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, `shot${s}.png`) });
  console.log('shot', s, (Date.now() - t0) / 1000 + 's');
  await p.close();
}
await b.close(); srv.close();
