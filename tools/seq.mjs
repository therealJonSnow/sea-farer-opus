// node tools/seq.mjs outdir t0 seconds fps W H
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'http'; import fs from 'fs';
const root = new URL('..', import.meta.url).pathname;
const [out, t0 = 20, secs = 4, fps = 30, W = 2560, H = 1440] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync(root + 'index.html')); }).listen(0);
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: +W, height: +H } });
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto(`http://localhost:${srv.address().port}/?capture&w=${W}&h=${H}`);
await p.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const n = Math.round(secs * fps);
for (let i = 0; i < n; i++) {
  await p.evaluate(([t, d]) => window.__frame(t, d), [+t0 + i / fps, 1 / fps]);
  await p.screenshot({ path: `${out}/f${String(i).padStart(4, '0')}.png` });
}
await b.close(); srv.close(); console.log('frames', n);
