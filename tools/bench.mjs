// Runs ?bench (scripted fly-through) in a real GPU-backed Chrome and prints the JSON report.
// node tools/bench.mjs [W=2560] [H=1440] [extraQuery=""]   e.g. node tools/bench.mjs 1280 720 "&secs=20"
// Pass W=0 to render at the window's native size × DPR (env SF_DPR, default 1).
// Env: SF_BROWSER / SF_HEADLESS / SF_FLAGS (see lib.mjs), SF_HEAP=1 adds a CDP sampling heap profile
// (costs CPU, so leave it off for frame-pacing numbers), SF_OUT=file.json saves the report.
import { launch, serve, checkAdapter } from './lib.mjs';
import fs from 'fs';
const [W = 2560, H = 1440, extra = ''] = process.argv.slice(2);
const dpr = +(process.env.SF_DPR || 1);
const s = serve();
// a visible window gives real vsync / presentation; &uncapped (off-screen, GPU-saturated cost runs) can stay headless
const b = await launch({ headless: /uncapped/.test(extra) });
const vw = +W ? Math.round(+W / dpr) : 1280, vh = +H ? Math.round(+H / dpr) : 720;
const p = await b.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
p.on('pageerror', e => console.log('pageerror:', e.message));
p.on('console', m => { if (m.type() === 'error' || m.text().startsWith('GPUERR') || m.text().startsWith('DEVICE')) console.log('console:', m.text()); });
await p.goto(s.url('?noop'));
await checkAdapter(p);
await p.goto(s.url(`?bench${+W ? `&w=${W}&h=${H}` : ''}${extra}`));
await p.waitForFunction('window.__m === 1', null, { timeout: 600000, polling: 200 });
let cdp;
if (process.env.SF_HEAP) {
  cdp = await p.context().newCDPSession(p);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
}
await p.waitForFunction('window.__bench', null, { timeout: 900000, polling: 1000 });
const rep = await p.evaluate(() => window.__bench);
const out = { bench: rep };
if (cdp) {
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const agg = {};
  const walk = n => { const fn = (n.callFrame.functionName || '(anon)') + ' ' + (n.callFrame.url.includes('localhost') ? 'page' : n.callFrame.url.slice(-30)); if (n.selfSize) agg[fn] = (agg[fn] || 0) + n.selfSize; n.children.forEach(walk); };
  walk(profile.head);
  out.allocBytesByFunction = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 15);
}
console.log(JSON.stringify(out, null, 1));
if (process.env.SF_OUT) fs.writeFileSync(process.env.SF_OUT, JSON.stringify(out, null, 1));
await b.close(); s.close();
