// Runs ?bench (60 s scripted fly-through) and a CDP sampling heap profile to attribute JS allocations.
// node tools/bench.mjs [W] [H] [extraQuery]
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'http'; import fs from 'fs';
const root = new URL('..', import.meta.url).pathname;
const [W = 2560, H = 1440, extra = '&offscreen'] = process.argv.slice(2);
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync(root + 'index.html')); }).listen(0);
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: +W, height: +H } });
p.on('pageerror', e => console.log('pageerror:', e.message));
const cdp = await p.context().newCDPSession(p);
await p.goto(`http://localhost:${srv.address().port}/?bench&w=${W}&h=${H}${extra}`);
await p.waitForFunction('window.__m === 1', null, { timeout: 600000, polling: 200 });
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await p.waitForFunction('window.__bench', null, { timeout: 400000, polling: 1000 });
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const rep = await p.evaluate(() => window.__bench);
const agg = {};
const walk = (n, stack) => { const fn = (n.callFrame.functionName || '(anon)') + ' ' + (n.callFrame.url.includes('localhost') ? 'page' : n.callFrame.url.slice(-30)); const sz = n.selfSize; if (sz) agg[fn] = (agg[fn] || 0) + sz; n.children.forEach(c => walk(c, stack)); };
walk(profile.head);
const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(JSON.stringify({ bench: rep, allocBytesByFunction: top }, null, 1));
await b.close(); srv.close();
