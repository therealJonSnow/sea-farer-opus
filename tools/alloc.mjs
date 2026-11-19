// Steady-state JS allocation check for the per-frame CPU path (sim + uniform upload), after JIT warm-up.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'http'; import fs from 'fs';
const root = new URL('..', import.meta.url).pathname;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync(root + 'index.html')); }).listen(0);
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const cdp = await p.context().newCDPSession(p);
await p.goto(`http://localhost:${srv.address().port}/?bench&offscreen&w=320&h=180&warm=100000`);
await p.waitForFunction('window.__cpu', null, { timeout: 120000 });
await p.evaluate(() => window.__cpu(120000)); // JIT warm-up (~11 min of play at 180 Hz)
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const N = 20000;
await p.evaluate(n => window.__cpu(n), N);
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const agg = {}; let total = 0;
const walk = n => { if (n.selfSize) { const k = n.callFrame.functionName || '(anon)'; agg[k] = (agg[k] || 0) + n.selfSize; total += n.selfSize; } n.children.forEach(walk); };
walk(profile.head);
console.log(JSON.stringify({ frames: N, sampledBytes: total, bytesPerFrame: +(total / N).toFixed(2), byFunction: Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 10) }, null, 1));
await b.close(); srv.close();
