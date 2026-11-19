// usage: node tools/shoot.mjs outdir [shots=0,1,2,3,4,5] [w=2560] [h=1440] [extraQuery]
// Deterministic capture path (?shot renders off-screen and reads back), so output is identical run to run.
import { launch, serve, checkAdapter } from './lib.mjs';
import fs from 'fs'; import path from 'path';
const [out = 'shots', list = '0,1,2,3,4,5', W = 2560, H = 1440, extra = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const s = serve();
const b = await launch();
let first = true;
for (const k of list.split(',')) {
  const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || /GPUERR|DEVICE/.test(m.text())) console.log('console:', m.text().slice(0, 600)); });
  p.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 800)));
  if (first) { await p.goto(s.url('?noop')); await checkAdapter(p); first = false; }
  const t0 = Date.now();
  await p.goto(s.url(`?shot=${k}&w=${W}&h=${H}${extra}`));
  try { await p.waitForFunction('window.__ready === true', null, { timeout: 60000 }); } catch (e) { console.log('timeout', k, await p.evaluate(() => document.body.innerText)); }
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(out, `shot${k}.png`) });
  console.log('shot', k, (Date.now() - t0) / 1000 + 's');
  await p.close();
}
await b.close(); s.close();
