// Robust GPU cost per pose: node tools/gpubench.mjs [W=2560] [H=1440] [poses=0,1,2,3,4,5] [extraQuery]
// Each pose is rendered ~600 times back to back (GPU saturated, so clocks stay up); reports median ms per pass.
import { launch, serve, checkAdapter } from './lib.mjs';
const [W = 2560, H = 1440, list = '0,1,2,3,4,5', extra = ''] = process.argv.slice(2);
const s = serve();
const b = await launch();
const rows = [];
for (const k of list.split(',')) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  if (!rows.length) { await p.goto(s.url('?noop')); await checkAdapter(p); }
  await p.goto(s.url(`?shot=${k}&gpubench&split&w=${W}&h=${H}${extra}`));
  await p.waitForFunction('window.__bench', null, { timeout: 300000, polling: 200 });
  const r = await p.evaluate(() => window.__bench);
  const row = { pose: +k, total: r.gpuMs.p50 }; for (const [n, v] of Object.entries(r.passMs)) row[n] = v.p50;
  rows.push(row); await p.close();
}
const mean = {}; for (const key of Object.keys(rows[0])) if (key !== 'pose') mean[key] = +(rows.reduce((a, r) => a + r[key], 0) / rows.length).toFixed(3);
console.table(rows); console.log('MEAN', JSON.stringify(mean));
await b.close(); s.close();
