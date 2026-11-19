// Steady-state JS allocation check after JIT warm-up.
//  1. CPU path: sim + uniform upload (window.__cpu), comparable to the original 61 B/frame figure.
//  2. Full frame (window.__frames): sim + uniforms + culling + command encoding/submission, which includes
//     WebGPU's own wrapper objects (encoder, pass encoders, command buffer, swap-chain view).
import { launch, serve, checkAdapter } from './lib.mjs';
const s = serve();
const b = await launch();
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
await p.goto(s.url('?noop')); await checkAdapter(p);
const cdp = await p.context().newCDPSession(p);
await p.goto(s.url('?bench&offscreen&w=320&h=180&warm=100000'));
await p.waitForFunction('window.__cpu', null, { timeout: 120000 });
const prof = async (fn, n) => {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await p.evaluate(([f, n]) => window[f](n), [fn, n]);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const agg = {}; let total = 0;
  const walk = n => { if (n.selfSize) { const k = n.callFrame.functionName || '(anon)'; agg[k] = (agg[k] || 0) + n.selfSize; total += n.selfSize; } n.children.forEach(walk); };
  walk(profile.head);
  return { frames: n, sampledBytes: total, bytesPerFrame: +(total / n).toFixed(2), byFunction: Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 10) };
};
await p.evaluate(() => window.__cpu(120000)); // JIT warm-up (~11 min of play at 180 Hz)
const cpu = await prof('__cpu', 20000);
await p.evaluate(() => window.__frames(3000));
const full = await prof('__frames', 3000);
console.log(JSON.stringify({ cpuPath: cpu, fullFrame: full }, null, 1));
await b.close(); s.close();
