// node tools/dbg.mjs [waitMs] [query]  — prints console output of a page run (default ?dbg&shot=0 at 640x360)
import { launch, serve } from './lib.mjs';
const s = serve();
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('console', m => console.log('console:', m.type(), m.text().slice(0, 1500)));
p.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 1500), e.stack?.slice(0, 500)));
await p.goto(s.url(process.argv[3] || '?dbg&shot=0&w=640&h=360'));
await p.waitForTimeout(+process.argv[2] || 5000);
console.log(await p.evaluate(() => [window.__ready, document.body.innerText]));
await b.close(); s.close();
