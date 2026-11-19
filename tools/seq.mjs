// node tools/seq.mjs outdir t0 seconds fps W H [extraQuery]
import { launch, serve, checkAdapter } from './lib.mjs';
import fs from 'fs';
const [out, t0 = 20, secs = 4, fps = 30, W = 2560, H = 1440, extra = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const s = serve();
const b = await launch();
const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto(s.url('?noop')); await checkAdapter(p);
await p.goto(s.url(`?capture&w=${W}&h=${H}${extra}`));
await p.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const n = Math.round(secs * fps);
for (let i = 0; i < n; i++) {
  await p.evaluate(([t, d]) => window.__frame(t, d), [+t0 + i / fps, 1 / fps]);
  await p.screenshot({ path: `${out}/f${String(i).padStart(4, '0')}.png` });
}
await b.close(); s.close(); console.log('frames', n);
