// Shared launcher for the tools: static server + Playwright browser with a real GPU.
// Env:
//   SF_BROWSER   chrome (default, installed Google Chrome) | chrome-canary | msedge | chromium (Playwright's) | /path/to/binary
//   SF_HEADLESS  1 / 0 to force headless on or off (default depends on the tool; frame-pacing runs use a visible window)
//   SF_HTML      serve this file instead of ./index.html (A/B comparisons)
//   SF_FLAGS     extra Chrome flags, space separated (e.g. "--enable-unsafe-webgpu" on Linux,
//                "--enable-unsafe-webgpu --enable-features=Vulkan" for the old GPU-less cloud container)
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs';
const { chromium } = createRequire(import.meta.url)('playwright');
export const root = new URL('..', import.meta.url).pathname;

export function serve() {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); r.end(fs.readFileSync(process.env.SF_HTML || root + 'index.html')); }).listen(0);
  return { url: path => `http://localhost:${srv.address().port}/${path}`, close: () => srv.close() };
}

export async function launch({ headless = true, args = [] } = {}) {
  const B = process.env.SF_BROWSER || 'chrome';
  const o = { headless: process.env.SF_HEADLESS ? process.env.SF_HEADLESS !== '0' : headless, args: [...args, ...(process.env.SF_FLAGS || '').split(' ').filter(Boolean)] };
  if (B.includes('/')) o.executablePath = B; else if (B !== 'chromium') o.channel = B;
  return chromium.launch(o);
}

// Logs the WebGPU adapter and refuses to continue on a software rasterizer unless SF_ALLOW_SW=1.
export async function checkAdapter(page) {
  const info = await page.evaluate(async () => {
    if (!navigator.gpu) return null;
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return null;
    const i = a.info || {};
    return { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, fallback: !!(i.isFallbackAdapter || a.isFallbackAdapter), ua: navigator.userAgent, dpr: devicePixelRatio };
  });
  console.log('adapter:', JSON.stringify(info));
  const sw = !info || info.fallback || /swiftshader|llvmpipe|software/i.test(JSON.stringify(info));
  if (sw && !process.env.SF_ALLOW_SW) throw new Error('No hardware WebGPU adapter (software rasterizer). Set SF_ALLOW_SW=1 to run anyway.');
  return info;
}
