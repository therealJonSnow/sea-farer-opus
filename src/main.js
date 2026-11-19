import { COMMON, SCENE, OBJ, WATER, STREAK, POST } from './shaders.js';

const Q = new URLSearchParams(location.search);
const BENCH = Q.has('bench');
const SHOT = Q.has('shot') ? +Q.get('shot') : -1;
const CAPTURE = Q.has('capture') || SHOT >= 0;
const MSAA = 4;
const SHADOW = 2048;
const WORLD_R = 720;
const PITCH = 0.56, YAW = Math.PI / 4;

// ---------- deterministic rng ----------
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.03 + 1.7, y * 2.03 + 9.2) * 0.25 + vnoise(x * 4.1 + 3.3, y * 4.1 + 1.1) * 0.125;

// ---------- islands ----------
const ISL = [];
function addIsland(x, z, R, H, type) {
  ISL.push({ x, z, R, H, type, a1: 0.05 + rnd() * 0.07, p1: rnd() * 6.28, a2: 0.03 + rnd() * 0.05, p2: rnd() * 6.28, a3: 0.015 + rnd() * 0.03, p3: rnd() * 6.28, ce: rnd() * 6.28 });
}
addIsland(-30, 6, 13, 5, 1);
addIsland(14, 30, 6, 0, 0);
addIsland(40, -14, 19, 6.5, 2);
addIsland(-26, -40, 7, 0, 0);
addIsland(-10, 62, 15, 4.5, 1);
for (let tries = 0; ISL.length < 22 && tries < 4000; tries++) {
  const a = rnd() * 6.283, d = 95 + rnd() * 520, x = Math.cos(a) * d, z = Math.sin(a) * d;
  const type = rnd() < 0.3 ? 0 : rnd() < 0.6 ? 1 : 2;
  const R = type === 0 ? 7 + rnd() * 6 : 14 + rnd() * 26;
  if (ISL.some(i => Math.hypot(i.x - x, i.z - z) < (i.R + R) * 1.6 + 25)) continue;
  addIsland(x, z, R, type === 0 ? 0 : 4 + rnd() * 6, type);
}
const islR = (I, th) => I.R * (1 + I.a1 * Math.sin(2 * th + I.p1) + I.a2 * Math.sin(3 * th + I.p2) + I.a3 * Math.sin(5 * th + I.p3));
function islH(I, x, z) {
  const vx = x - I.x, vz = z - I.z, d = Math.hypot(vx, vz), th = Math.atan2(vz, vx);
  const r = islR(I, th), q = d / r;
  if (q >= 1) return Math.max(-5, -(q - 1) * I.R * 0.45);
  const n = fbm(x * 0.15, z * 0.15);
  if (I.type === 0) return 1.25 * smooth(1, 0.15, q) + 0.25 * (n - 0.5) * smooth(1, 0.6, q);
  const bw = 0.17;
  let h = 0.85 * smooth(1, 1 - bw, q);
  const ce = 1 - bw - 0.02 + 0.035 * (Math.sin(th * 4 + I.ce) * 0.6 + Math.sin(th * 9 + I.ce * 2) * 0.4);
  const cl = smooth(ce, ce - 0.08, q);
  h += (I.H - 0.85) * cl;
  h += cl * (I.H * 0.25 * smooth(ce, 0, q) + (n - 0.4) * 1.4);
  if (I.type === 2) h += I.H * 0.7 * smooth(0.5, 0.44, q + 0.04 * Math.sin(th * 5 + I.ce)) + I.H * 0.25 * smooth(0.4, 0, q);
  return h;
}
function shoreD(x, z) {
  let m = 1e9, mi = -1;
  for (let i = 0; i < ISL.length; i++) { const I = ISL[i], d = Math.hypot(x - I.x, z - I.z) - islR(I, Math.atan2(z - I.z, x - I.x)); if (d < m) { m = d; mi = i; } }
  _sdI = mi; return m;
}
let _sdI = -1;

// ---------- mesh builder ----------
const VB = [], IB = [];
let vcount = 0;
function vtx(p, n, c, kind, part, extra = 0) {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  VB.push(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, c[0], c[1], c[2], c[3] ?? 0, kind, part, extra);
  return vcount++;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// parametric surface grid with smooth normals
function surf(fn, nu, nv, col, kind, part, closeU = false) {
  const base = vcount, e = 1e-3;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, p = fn(u, v);
    const du = sub(fn(Math.min(u + e, 1), v), fn(Math.max(u - e, 0), v));
    const dv = sub(fn(u, Math.min(v + e, 1)), fn(u, Math.max(v - e, 0)));
    let n = cross(dv, du);
    if (!Math.hypot(...n)) n = [0, 1, 0];
    vtx(p, n, typeof col === 'function' ? col(u, v, p) : col, kind, part);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    IB.push(a, c, b, b, c, d);
  }
}
function ellipsoid(c, r, col, kind, part, nu = 12, nv = 8) {
  surf((u, v) => { const th = u * 6.2832, ph = v * Math.PI; return [c[0] + r[0] * Math.sin(ph) * Math.cos(th), c[1] - r[1] * Math.cos(ph), c[2] + r[2] * Math.sin(ph) * Math.sin(th)]; }, nu, nv, col, kind, part);
}
function tube(path, rad, sides, nseg, col, kind, part) {
  surf((u, v) => {
    const p = path(v), p2 = path(Math.min(v + 0.01, 1)), p0 = path(Math.max(v - 0.01, 0));
    let t = sub(p2, p0); const tl = Math.hypot(...t); t = t.map(x => x / tl);
    let a = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let s = cross(t, a); const sl = Math.hypot(...s); s = s.map(x => x / sl);
    const b = cross(s, t), th = u * 6.2832, r = typeof rad === 'function' ? rad(v) : rad;
    return [p[0] + (s[0] * Math.cos(th) + b[0] * Math.sin(th)) * r, p[1] + (s[1] * Math.cos(th) + b[1] * Math.sin(th)) * r, p[2] + (s[2] * Math.cos(th) + b[2] * Math.sin(th)) * r];
  }, sides, nseg, col, kind, part);
}
const C = (hex, a = 0) => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255, a];
const meshes = {};
function mesh(name, fn) { const i0 = IB.length, v0 = vcount; fn(); meshes[name] = { first: i0, count: IB.length - i0 }; }

// terrain
mesh('terrain', () => {
  for (const I of ISL) {
    const ext = I.R * 1.42, N = Math.round(clamp(I.R * 5.5, 60, 220));
    const H = (x, z) => islH(I, x, z);
    surf((u, v) => { const x = I.x - ext + u * 2 * ext, z = I.z - ext + v * 2 * ext; return [x, H(x, z), z]; }, N, N, [1, 1, 1, 0], 0, 0);
  }
});
// fix terrain normals analytically (surf uses param derivs; good enough) -- flip check
// palm tree (kind 1)
mesh('palm', () => {
  const bend = 1.3, h = 5.2;
  const path = v => [bend * v * v, h * v, 0];
  tube(path, v => 0.26 - 0.12 * v, 7, 9, (u, v) => C(((v * 9 | 0) & 1) ? 0xc09060 : 0xa87a4c), 1, 0);
  const top = path(1);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * 6.283 + 0.3, len = 2.7 + (k % 2) * 0.5;
    const dir = [Math.cos(a), 0, Math.sin(a)];
    surf((u, v) => {
      const s = v * len, w = (u - 0.5) * 0.9 * Math.sin(Math.PI * Math.min(1, v * 1.1 + 0.08));
      const droop = 0.45 * s - 0.22 * s * s;
      const side = [-dir[2], 0, dir[0]];
      const fold = -Math.abs(u - 0.5) * 0.35 * Math.sin(Math.PI * v);
      return [top[0] + dir[0] * s + side[0] * w, top[1] + droop + fold, top[2] + dir[2] * s + side[2] * w];
    }, 2, 6, (u, v) => C(k % 2 ? 0x3faa3c : 0x58c44a), 1, 1);
  }
  for (let k = 0; k < 3; k++) { const a = k * 2.1; ellipsoid([top[0] + Math.cos(a) * 0.22, top[1] - 0.22, Math.sin(a) * 0.22], [0.17, 0.17, 0.17], C(0x6b4a2b), 1, 0, 8, 5); }
});
// round tree (kind 2)
mesh('tree', () => {
  tube(v => [0.15 * Math.sin(v * 2), 2.3 * v, 0], v => 0.3 - 0.1 * v, 7, 4, C(0x8a5a36), 2, 0);
  const blobs = [[0, 3.2, 0, 1.6, 0x59bf45], [0.95, 2.7, 0.4, 1.05, 0x46a83f], [-0.8, 2.85, -0.5, 1.1, 0x6ccf52], [0.1, 4.1, -0.2, 1.0, 0x7ad65a], [-0.3, 2.6, 0.9, 0.95, 0x3e9c3c]];
  for (const b of blobs) ellipsoid([b[0], b[1], b[2]], [b[3], b[3] * 0.9, b[3]], C(b[4]), 2, 1, 12, 8);
});
mesh('tree2', () => { // blossom variant
  tube(v => [0.1 * Math.sin(v * 3), 2.0 * v, 0], v => 0.26 - 0.1 * v, 7, 4, C(0x7a4e30), 2, 0);
  const blobs = [[0, 2.9, 0, 1.4, 0xf27fa6], [0.85, 2.5, 0.3, 0.95, 0xe8689a], [-0.7, 2.6, -0.4, 1.0, 0xf79bbb], [0.1, 3.7, -0.1, 0.85, 0xfab0c8]];
  for (const b of blobs) ellipsoid([b[0], b[1], b[2]], [b[3], b[3] * 0.9, b[3]], C(b[4]), 2, 1, 12, 8);
});
// crab (kind 3) — faces +z, walks along local x
mesh('crab', () => {
  const red = C(0xff6a3d), dk = C(0xe8502e);
  ellipsoid([0, 0.22, 0], [0.42, 0.17, 0.3], red, 3, 0, 12, 7);
  for (const s of [-1, 1]) {
    ellipsoid([s * 0.14, 0.45, 0.2], [0.07, 0.07, 0.07], C(0xffffff), 3, 2, 6, 4);
    ellipsoid([s * 0.14, 0.47, 0.25], [0.035, 0.035, 0.035], C(0x111111), 3, 2, 6, 4);
    tube(v => [s * 0.14, 0.3 + v * 0.13, 0.17], 0.025, 4, 1, red, 3, 2);
    ellipsoid([s * 0.42, 0.3, 0.38], [0.17, 0.11, 0.13], red, 3, 2, 8, 5);
    tube(v => [s * (0.3 + 0.1 * v), 0.25 + 0.05 * v, 0.2 + 0.15 * v], 0.05, 5, 1, dk, 3, 2);
    for (let k = 0; k < 3; k++) {
      const z = -0.15 + k * 0.14;
      tube(v => [s * (0.3 + v * 0.38), 0.22 + 0.15 * Math.sin(v * 3) - 0.22 * v, z + (k - 1) * 0.08 * v], 0.035, 4, 3, dk, 3, 1);
    }
  }
});
// gull (kind 4) — faces +z
mesh('gull', () => {
  const w = C(0xffffff), g = C(0xb9c2cc), k = C(0x30343c), y = C(0xf5b331);
  ellipsoid([0, 0, 0], [0.16, 0.15, 0.46], w, 4, 0, 10, 7);
  ellipsoid([0, 0.08, 0.42], [0.12, 0.12, 0.13], w, 4, 0, 8, 6);
  tube(v => [0, 0.06 - 0.02 * v, 0.52 + 0.18 * v], v => 0.04 * (1 - v) + 0.005, 5, 1, y, 4, 0);
  for (const s of [-1, 1]) ellipsoid([s * 0.06, 0.13, 0.5], [0.022, 0.022, 0.022], k, 4, 0, 5, 3);
  surf((u, v) => [0, 0, -0.42 - v * 0.2 + 0, ].map((x, i) => i === 0 ? (u - 0.5) * 0.3 * (1 + v) : i === 1 ? 0.02 : x), 1, 1, w, 4, 0);
  for (const s of [-1, 1]) {
    surf((u, v) => {
      const x = v * 1.05, ch = 0.36 * (1 - v * 0.55);
      return [s * (0.1 + x), 0.05 + 0.12 * Math.sin(v * 2.4) - 0.03 * v * v, 0.15 - u * ch - v * 0.18];
    }, 2, 5, (u, v) => v > 0.75 ? k : v > 0.55 ? g : w, 4, s < 0 ? 1 : 2);
  }
  for (const s of [-1, 1]) tube(v => [s * 0.05, -0.12, -0.15 - v * 0.15], 0.018, 4, 1, y, 4, 0);
});
// boat (kind 5) — bow +z
mesh('boat', () => {
  const halfW = s => 0.82 * (1 - Math.pow(Math.max(0, (s - 0.42) / 0.58), 1.7)) * (0.74 + 0.26 * smooth(0, 0.35, s));
  const gunY = s => 0.6 + 0.38 * Math.pow(s, 3);
  const keelY = s => -0.38 + 0.25 * Math.pow(s, 4) + 0.12 * Math.pow(1 - s, 3);
  const Z = s => -2.05 + s * 4.3;
  const hullP = (u, s) => { const ph = u * Math.PI, d = Math.sin(ph), g = gunY(s), k = keelY(s); return [halfW(s) * Math.cos(ph), g - (g - k) * Math.pow(d, 0.55), Z(s)]; };
  surf(hullP, 14, 22, (u, v, p) => { const g = gunY(v); return p[1] > g - 0.13 ? C(0xf2c14e) : p[1] > g - 0.2 ? C(0xfaf2dc) : C(0xd9442e); }, 5, 0);
  // transom
  { const n = 14, c0 = vtx([0, 0.3, Z(0)], [0, 0, -1], C(0xd9442e), 5, 0); const b = vcount; for (let i = 0; i <= n; i++) vtx(hullP(i / n, 0), [0, 0, -1], C(0xd9442e), 5, 0); for (let i = 0; i < n; i++) IB.push(c0, b + i, b + i + 1); }
  // deck floor (planks)
  surf((u, v) => { const s = 0.06 + v * 0.8; return [(u - 0.5) * 2 * halfW(s) * 0.82, 0.05, Z(s)]; }, 4, 10, C(0xd6a26a, 0.6), 5, 0);
  // thwart / seat
  surf((u, v) => [(u - 0.5) * 1.5, 0.42 + 0.0 * v, -0.2 + v * 0.35], 1, 1, C(0xc28b55, 0.6), 5, 0);
  // gunwale rail
  for (const sd of [-1, 1]) tube(v => { const s = 0.0 + v * 0.995; return [sd * halfW(s), gunY(s) + 0.02, Z(s)]; }, 0.06, 5, 16, C(0xa86a3c), 5, 0);
  // mast + top cap
  tube(v => [0, 0.05 + v * 4.35, 0.55], v => 0.085 - 0.03 * v, 7, 3, C(0x2fa57a), 5, 0);
  ellipsoid([0, 4.42, 0.55], [0.11, 0.08, 0.11], C(0xf2c14e), 5, 0, 8, 5);
  // boom + sail (rotate about mast)
  tube(v => [0, 0.88, 0.55 - v * 2.45], 0.055, 6, 2, C(0x8a5a36), 5, 1);
  surf((u, v) => [u, v, 0], 14, 14, (u, v) => [u, v, 0, 0], 5, 2);
  // pennant
  surf((u, v) => [0, 4.47 + 0.24 * (1 - u) * (v - 0.5) * 2 * 0.5 + 0.12, 0.55 - u * 0.75], 6, 1, C(0xe8402e), 5, 6);
  // tiller + rudder
  surf((u, v) => [0, 0.55 - v * 1.05, -2.08 - u * (0.45 - 0.15 * v)], 2, 3, C(0x9a6538), 5, 3);
  tube(v => [0, 0.66 + 0.12 * v, -2.05 + v * 1.0], 0.04, 5, 2, C(0x7a4a2a), 5, 3);
  // anchor on bow
  tube(v => [0.0, 0.85 - 0.35 * v, 1.95], 0.04, 5, 1, C(0x3b3f4a), 5, 7);
  tube(v => { const a = (v - 0.5) * 2.4; return [Math.sin(a) * 0.2, 0.55 - Math.cos(a) * 0.12 + 0.12, 1.95]; }, 0.035, 5, 6, C(0x3b3f4a), 5, 7);
  // rope (kind 5 part 8)
  tube(v => [0, v, 0], 0.06, 4, 10, C(0xd8c49a), 5, 8);
  // little sailor (original: knit cap, striped jumper, scarf)
  const px = 0, pz = -1.15;
  ellipsoid([px, 0.62, pz], [0.28, 0.42, 0.24], (u, v, p) => (Math.floor((p[1] - 0.2) * 9) & 1) ? C(0xf7f3e8) : C(0x2f5fb3), 5, 4, 12, 10);
  ellipsoid([px, 0.24, pz], [0.24, 0.16, 0.2], C(0x354a7a), 5, 4, 10, 6);
  ellipsoid([px, 1.02, pz], [0.24, 0.07, 0.22], C(0xf28c28), 5, 4, 10, 5);
  for (const s of [-1, 1]) tube(v => [px + s * (0.27 + 0.05 * v), 0.88 - 0.38 * v, pz + (s > 0 ? -0.35 * v : 0.12 * v)], 0.075, 6, 2, C(0x2f5fb3), 5, 4);
  ellipsoid([px + 0.33, 0.48, pz - 0.38], [0.09, 0.09, 0.09], C(0xf5c9a0), 5, 4, 6, 4);
  ellipsoid([px, 1.38, pz], [0.34, 0.32, 0.32], C(0xf5c9a0), 5, 5, 12, 9);
  ellipsoid([px, 1.55, pz], [0.36, 0.22, 0.34], C(0xe23d3d), 5, 5, 12, 7);
  ellipsoid([px, 1.66, pz], [0.32, 0.13, 0.3], (u, v, p) => C(Math.floor(u * 12) & 1 ? 0xe23d3d : 0xc92f30), 5, 5, 12, 6);
  ellipsoid([px, 1.84, pz - 0.05], [0.12, 0.12, 0.12], C(0xfff6e0), 5, 5, 8, 6);
  for (const s of [-1, 1]) {
    ellipsoid([px + s * 0.12, 1.38, pz + 0.29], [0.05, 0.07, 0.03], C(0x1b1b24), 5, 5, 6, 4);
    ellipsoid([px + s * 0.21, 1.27, pz + 0.24], [0.06, 0.035, 0.02], C(0xf59a8a), 5, 5, 6, 4);
  }
  ellipsoid([px, 1.31, pz + 0.33], [0.06, 0.05, 0.05], C(0xf0b089), 5, 5, 6, 4);
});

// ---------- instances ----------
const inst = [];
const instRanges = {};
function instances(name, fn) { const i0 = inst.length / 8; fn(); instRanges[name] = { first: i0, count: inst.length / 8 - i0 }; }
instances('one', () => inst.push(0, 0, 0, 1, 0, 0, 0, 0));
const treeSpots = [];
for (const I of ISL) {
  const n = I.type === 0 ? 2 + (rnd() * 3 | 0) : Math.round(I.R * I.R * 0.05);
  for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
    const a = rnd() * 6.283, q = I.type === 0 ? 0.15 + rnd() * 0.55 : rnd() * 0.75, r = islR(I, a) * q;
    const x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r, y = islH(I, x, z);
    const gx = islH(I, x + 0.5, z) - islH(I, x - 0.5, z), gz = islH(I, x, z + 0.5) - islH(I, x, z - 0.5);
    if (Math.hypot(gx, gz) > 0.35 || y < 0.4) continue;
    if (treeSpots.some(t => Math.hypot(t[0] - x, t[2] - z) < 4.6)) continue;
    treeSpots.push([x, y - 0.1, z, I.type === 0 || y < 1.2 ? 0 : rnd() < 0.15 ? 2 : rnd() < 0.25 ? 0 : 1]);
    k++;
  }
}
for (const [kind, name] of [[0, 'palm'], [1, 'tree'], [2, 'tree2']]) instances(name, () => { for (const t of treeSpots) if (t[3] === kind) inst.push(t[0], t[1], t[2], 0.8 + rnd() * 0.45, rnd() * 6.28, rnd() * 6.28, 0, 0); });
instances('crab', () => {
  for (const I of ISL) {
    const n = Math.max(1, Math.round(I.R / 5));
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.283, q = I.type === 0 ? 0.7 + rnd() * 0.2 : 0.9 + rnd() * 0.04, r = islR(I, a) * q;
      const x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r;
      inst.push(x, Math.max(islH(I, x, z), 0.05), z, 0.75 + rnd() * 0.3, -a, rnd() * 6.28, 0.6 + rnd() * 0.8, 0.6 + rnd() * 0.9);
    }
  }
});
instances('gull', () => {
  inst.push(0, 0, 0, 1, 0, 0, 0, -1); // mast gull
  for (let k = 0; k < 3; k++) inst.push(0, 7 + k * 1.5, 0, 1, 0, rnd() * 6.28, 8 + k * 3, 1); // follow boat
  for (const I of ISL) if (rnd() < 0.7) for (let k = 0; k < 1 + (rnd() * 2 | 0); k++) inst.push(I.x, 9 + rnd() * 6, I.z, 1, 0, rnd() * 6.28, I.R * 0.6 + 5 + rnd() * 8, 0);
});

// creatures (whales / manta) circle paths
const CRE = [[12, 6, 22, 0], [-60, 70, 40, 2], [70, -10, 30, 4]];

// ---------- wave height (mirror of WGSL gerst) ----------
const WIND0 = 1.1; // base wind heading (radians, direction wind blows toward)
const WL = [24, 13, 8.5, 33], WA = [0.24, 0.12, 0.07, 0.2], WO = [0, 0.45, -0.55, 1.2];
function waveH(x, z, t) {
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const k = 6.2832 / WL[i], w = Math.sqrt(9.8 * k) * 0.55, a = WIND0 + WO[i];
    y += WA[i] * Math.sin(k * (Math.sin(a) * x + Math.cos(a) * z) - w * t);
  }
  return y;
}

// ---------- simulation state ----------
const S = { x: 0, z: 0, th: 2.3, u: 0, v: 0, w: 0, rud: 0, sheet: 0.55, boom: 0.6, boomV: 0, heel: 0, pitch: 0, y: 0, fill: 0, flap: 0, anch: 0, ax: 0, az: 0, adrop: 0, pen: 0, windA: WIND0, ws: 7, time: 0 };
const keys = { s: 0, d: 0, i: 0, o: 0 };
const wake = new Float32Array(48 * 4);
let wakeT = 0;
const streak = new Float32Array(24 * 4);
const gullS = { st: 0, t: 0, x: 0, y: 0, z: 0, yaw: 0, fold: 0, flap: 0, bank: 0, vis: 1, sx: 0, sy: 0, sz: 0 };
let auto = BENCH || CAPTURE;

function boatLocalToWorld(lx, ly, lz, out) {
  // rz(heel) -> rx(pitch) -> ry(heading), matching WGSL
  let c = Math.cos(S.heel), s = Math.sin(S.heel);
  let x = lx * c + ly * s, y = -lx * s + ly * c, z = lz;
  c = Math.cos(S.pitch); s = Math.sin(S.pitch);
  const y2 = y * c + z * s, z2 = -y * s + z * c; y = y2; z = z2;
  c = Math.cos(S.th); s = Math.sin(S.th);
  out[0] = x * c + z * s + S.x; out[1] = y + S.y; out[2] = -x * s + z * c + S.z;
}
const tmp3 = new Float32Array(3);
const WAY = [[40, 10], [70, 75], [10, 110], [-70, 80], [-95, 0], [-60, -75], [0, -90], [60, -80]];
let wayI = 0;

function step(dt) {
  S.time += dt;
  const t = S.time;
  S.windA = WIND0 + 0.12 * Math.sin(t * 0.05) + 0.05 * Math.sin(t * 0.17);
  S.ws = 7 + 1.2 * Math.sin(t * 0.13) + 0.6 * Math.sin(t * 0.41);
  const wx = Math.sin(S.windA) * S.ws, wz = Math.cos(S.windA) * S.ws;
  const fx = Math.sin(S.th), fz = Math.cos(S.th), rx = Math.cos(S.th), rz = -Math.sin(S.th);
  // autopilot (bench/capture)
  if (auto) {
    const W = WAY[wayI];
    let dx = W[0] - S.x, dz = W[1] - S.z;
    if (Math.hypot(dx, dz) < 14) wayI = (wayI + 1) % WAY.length;
    let want = Math.atan2(dx, dz);
    let rel = Math.atan2(Math.sin(want - S.windA - Math.PI), Math.cos(want - S.windA - Math.PI));
    if (Math.abs(rel) < 0.85) want = S.windA + Math.PI + (rel < 0 ? -0.85 : 0.85);
    // steer away from coasts
    const sd = shoreD(S.x + fx * 10, S.z + fz * 10);
    if (sd < 6) { const I = ISL[_sdI]; const ax = S.x - I.x, az = S.z - I.z; const cr = fx * az - fz * ax; want = S.th + (cr > 0 ? 0.9 : -0.9); }
    const err = Math.atan2(Math.sin(want - S.th), Math.cos(want - S.th));
    keys.s = err < -0.05 ? 1 : 0; keys.d = err > 0.05 ? 1 : 0;
    S.rud += (clamp(err * 2.5, -1, 1) - S.rud) * Math.min(1, dt * 3);
  } else {
    const tgt = keys.s && !keys.d ? -1 : keys.d && !keys.s ? 1 : 0;
    S.rud += (tgt - S.rud) * Math.min(1, dt * (tgt ? 2.4 : 1.6));
  }
  // apparent wind in boat frame
  const vx = fx * S.u + rx * S.v, vz = fz * S.u + rz * S.v;
  const ax = wx - vx, az = wz - vz, aw = Math.hypot(ax, az) + 1e-6;
  const af = ax * fx + az * fz, ar = ax * rx + az * rz;
  const free = Math.atan2(ar, -af); // boom angle the wind wants (0 = aft)
  if (auto) {
    const opt = clamp((Math.abs(free) - 0.35) / 1.48, 0.08, 1);
    S.sheet += (opt - S.sheet) * Math.min(1, dt * 1.5);
  } else {
    if (keys.i) S.sheet = Math.max(0.06, S.sheet - dt * 0.55);
    if (keys.o) S.sheet = Math.min(1, S.sheet + dt * 0.55);
  }
  const bmax = S.sheet * 1.48;
  let target, alpha = 0, luff;
  if (Math.abs(free) <= bmax) { target = free; luff = 1; } else { target = Math.sign(free) * bmax; alpha = Math.abs(free) - bmax; luff = smooth(0.12, 0.0, alpha); }
  // boom dynamics (swings across on a gybe)
  S.boomV += ((target - S.boom) * 18 - S.boomV * 5.5) * dt;
  S.boom += S.boomV * dt;
  if (Math.abs(S.boom) > bmax + 0.02) { S.boom = Math.sign(S.boom) * (bmax + 0.02); S.boomV *= -0.3; }
  // aero force: lift + drag
  const q = aw * aw;
  const al = Math.min(alpha, Math.PI);
  const CL = al < 0.45 ? 1.5 * Math.sin(al * 3.3) : 1.5 * Math.sin(0.45 * 3.3) * Math.max(0, 1 - (al - 0.45) * 0.9) + 0.3;
  const CD = 0.06 + 1.25 * Math.sin(al) * Math.sin(al);
  const ahx = ax / aw, ahz = az / aw;
  const bd = S.boom, cx = -fx * Math.cos(bd) + rx * Math.sin(bd), cz = -fz * Math.cos(bd) + rz * Math.sin(bd);
  let nx = -cz, nz = cx; if (nx * ax + nz * az < 0) { nx = -nx; nz = -nz; }
  let lx = -ahz, lz = ahx; if (lx * nx + lz * nz < 0) { lx = -lx; lz = -lz; }
  const pw = (1 - luff * 0.92) * 0.032 * q;
  const Fx = pw * (CL * lx + CD * ahx), Fz = pw * (CL * lz + CD * ahz);
  const thrust = Fx * fx + Fz * fz, side = Fx * rx + Fz * rz;
  S.fill += ((1 - luff) * clamp(q / 50, 0.3, 1.2) - S.fill) * Math.min(1, dt * 4);
  S.flap += (luff * clamp(aw / 7, 0.2, 1) - S.flap) * Math.min(1, dt * 3);
  // hull
  S.u += (thrust - 0.11 * S.u * Math.abs(S.u) - 0.05 * S.u) * dt;
  S.v += (side * 0.25 - 2.5 * S.v) * dt;
  const turn = S.rud * (0.18 + 0.32 * clamp(Math.abs(S.u) / 3, 0, 1.4)) * Math.sign(S.u + 0.3);
  S.w += (turn - S.w) * Math.min(1, dt * 3);
  if (S.anch) {
    // weathervane into wind, tethered
    const into = S.windA + Math.PI;
    S.w += Math.atan2(Math.sin(into - S.th), Math.cos(into - S.th)) * 0.4 * dt;
    S.u *= Math.exp(-dt * 1.5);
    S.adrop += dt;
  }
  S.th += S.w * dt;
  const nfx = Math.sin(S.th), nfz = Math.cos(S.th);
  S.x += (nfx * S.u + Math.cos(S.th) * S.v) * dt;
  S.z += (nfz * S.u - Math.sin(S.th) * S.v) * dt;
  if (S.anch) {
    const dx = S.x - S.ax, dz = S.z - S.az, d = Math.hypot(dx, dz), L = 9;
    if (d > L) { S.x = S.ax + dx / d * L; S.z = S.az + dz / d * L; S.u *= 0.97; }
    // drift downwind gently
    S.x += Math.sin(S.windA) * 0.4 * dt; S.z += Math.cos(S.windA) * 0.4 * dt;
  }
  // islands: soft collision
  const sd = shoreD(S.x, S.z);
  if (sd < 2.4) {
    const I = ISL[_sdI], dx = S.x - I.x, dz = S.z - I.z, d = Math.hypot(dx, dz);
    const push = (2.4 - sd);
    S.x += dx / d * push * Math.min(1, dt * 8); S.z += dz / d * push * Math.min(1, dt * 8);
    S.u *= Math.exp(-dt * 3);
  }
  // world bound: current pushes back far away
  const rd = Math.hypot(S.x, S.z);
  if (rd > WORLD_R * 0.82) { const k = (rd - WORLD_R * 0.82) * 0.05 * dt; S.x -= S.x / rd * k * 10; S.z -= S.z / rd * k * 10; }
  // heel / bob
  S.heel += (clamp(side * 0.09, -0.35, 0.35) + S.rud * S.u * -0.012 - S.heel) * Math.min(1, dt * 2.5);
  const h0 = waveH(S.x, S.z, t), hf = waveH(S.x + nfx * 1.8, S.z + nfz * 1.8, t), hb = waveH(S.x - nfx * 1.8, S.z - nfz * 1.8, t);
  const hr = waveH(S.x + Math.cos(S.th) * 0.8, S.z - Math.sin(S.th) * 0.8, t), hl = waveH(S.x - Math.cos(S.th) * 0.8, S.z + Math.sin(S.th) * 0.8, t);
  S.y += ((h0 + hf + hb) / 3 - 0.02 - S.y) * Math.min(1, dt * 6);
  S.pitch += (Math.atan2(hf - hb, 3.6) * 0.8 - 0.012 * S.u - S.pitch) * Math.min(1, dt * 4);
  S.heel += (Math.atan2(hl - hr, 1.6) * 0.3) * Math.min(1, dt * 4);
  // pennant points to apparent wind (local frame)
  const pa = Math.atan2(ar, -af);
  S.pen += Math.atan2(Math.sin(pa - S.pen), Math.cos(pa - S.pen)) * Math.min(1, dt * 6);
  // wake history
  wakeT += dt;
  for (let i = 0; i < 48; i++) wake[i * 4 + 2] += dt;
  const spd = Math.abs(S.u);
  if (wakeT > 0.22) {
    wakeT = 0;
    wake.copyWithin(4, 0, 47 * 4);
    wake[0] = S.x - nfx * 1.8; wake[1] = S.z - nfz * 1.8; wake[2] = 0; wake[3] = clamp(spd / 3.5, 0, 1);
  } else { wake[0] = S.x - nfx * 1.8; wake[1] = S.z - nfz * 1.8; wake[3] = clamp(spd / 3.5, 0, 1); }
  // wind streak spawns around camera target
  for (let i = 0; i < 24; i++) {
    const o = i * 4;
    if (t - streak[o + 2] > 4.2 + (i % 5) * 0.7 || streak[o + 2] === 0) {
      const sd2 = Math.sin(i * 91.7 + t * 13.1) * 43758.5; const r1 = sd2 - Math.floor(sd2);
      const sd3 = Math.sin(i * 37.3 + t * 7.7) * 24634.6; const r2 = sd3 - Math.floor(sd3);
      streak[o] = S.x + (r1 - 0.5) * 120 - Math.sin(S.windA) * 18; streak[o + 1] = S.z + (r2 - 0.5) * 120 - Math.cos(S.windA) * 18;
      streak[o + 2] = t + (i % 7) * 0.5; streak[o + 3] = r1 * 0.7 + r2 * 0.3;
    }
  }
  // seagull that lands on the mast top
  const G = gullS; G.t += dt;
  boatLocalToWorld(0, 4.62, 0.55, tmp3);
  if (G.st === 0) { // circling
    const a = G.t * 0.55, r = 14;
    G.x = S.x + Math.cos(a) * r; G.z = S.z + Math.sin(a) * r; G.y = 10 + Math.sin(G.t * 0.4);
    G.yaw = -a; G.bank = -0.4; G.flap = G.t * 9; G.fold = Math.max(0, G.fold - dt * 2);
    if (G.t > 9) { G.st = 1; G.t = 0; G.sx = G.x; G.sy = G.y; G.sz = G.z; }
  } else if (G.st === 1) { // approach
    const k = smooth(0, 3.2, G.t);
    const ex = tmp3[0], ey = tmp3[1], ez = tmp3[2];
    const nx2 = G.sx + (ex - G.sx) * k, nz2 = G.sz + (ez - G.sz) * k;
    G.yaw = Math.atan2(nx2 - G.x, nz2 - G.z) || G.yaw;
    G.x = nx2; G.z = nz2; G.y = G.sy + (ey - G.sy) * k + Math.sin(k * Math.PI) * 2;
    G.bank *= 0.95; G.flap = G.t * (6 + 10 * k); G.fold = 0;
    if (G.t > 3.2) { G.st = 2; G.t = 0; }
  } else if (G.st === 2) { // perched
    G.x = tmp3[0]; G.y = tmp3[1]; G.z = tmp3[2];
    G.yaw = S.th + 0.6 + 0.3 * Math.sin(G.t * 0.7); G.bank = S.heel; G.fold = Math.min(1, G.fold + dt * 3); G.flap = 0;
    if (G.t > 9) { G.st = 3; G.t = 0; G.sx = G.x; G.sy = G.y; G.sz = G.z; }
  } else { // take off
    G.fold = Math.max(0, G.fold - dt * 4); G.flap = G.t * 14;
    G.x = G.sx + G.t * 4 * Math.sin(G.yaw); G.z = G.sz + G.t * 4 * Math.cos(G.yaw); G.y = G.sy + G.t * 2.2;
    if (G.t > 3) { G.st = 0; G.t = 0; }
  }
}

// ---------- GPU ----------
const canvas = document.querySelector('canvas');
const err = m => { document.getElementById('msg').textContent = m; throw new Error(m); };
const adapter = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) err('WebGPU is not available in this browser.');
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
// OFF: render offscreen + read back into a 2D canvas (used for headless capture where presentation is unavailable)
const OFF = CAPTURE || Q.has('offscreen');
const ctx = canvas.getContext(OFF ? '2d' : 'webgpu');
const fmt = OFF ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
if (!OFF) ctx.configure({ device, format: fmt, alphaMode: 'opaque' });
let offTex, offView, offBuf;

const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
// pack vertices: pos f32x3, normal snorm8x4, color unorm8x4, meta uint8x4 (24 bytes)
const NV = VB.length / 13, vab = new ArrayBuffer(NV * 24), dv = new DataView(vab);
for (let i = 0; i < NV; i++) {
  const o = i * 13, b = i * 24;
  dv.setFloat32(b, VB[o], true); dv.setFloat32(b + 4, VB[o + 1], true); dv.setFloat32(b + 8, VB[o + 2], true);
  for (let k = 0; k < 3; k++) dv.setInt8(b + 12 + k, Math.round(clamp(VB[o + 3 + k], -1, 1) * 127));
  for (let k = 0; k < 4; k++) dv.setUint8(b + 16 + k, Math.round(clamp(VB[o + 6 + k], 0, 1) * 255));
  for (let k = 0; k < 3; k++) dv.setUint8(b + 20 + k, VB[o + 10 + k]);
}
const vbuf = buf(new Uint8Array(vab), GPUBufferUsage.VERTEX);
const ibuf = buf(new Uint32Array(IB), GPUBufferUsage.INDEX);
const instBuf = buf(new Float32Array(inst), GPUBufferUsage.VERTEX);
// water grid
const WG = 220, WS = 1.25;
const wv = new Float32Array((WG + 1) * (WG + 1) * 2);
for (let j = 0, k = 0; j <= WG; j++) for (let i = 0; i <= WG; i++) { wv[k++] = (i - WG / 2) * WS; wv[k++] = (j - WG / 2) * WS; }
const wi = new Uint32Array(WG * WG * 6);
for (let j = 0, k = 0; j < WG; j++) for (let i = 0; i < WG; i++) { const a = j * (WG + 1) + i; wi.set([a, a + WG + 1, a + 1, a + 1, a + WG + 1, a + WG + 2], k); k += 6; }
const wvBuf = buf(wv, GPUBufferUsage.VERTEX), wiBuf = buf(wi, GPUBufferUsage.INDEX);

// uniforms
const FU = new Float32Array(16 * 2 + 4 * 14 + 48 * 4 + 24 * 4);
const fBuf = device.createBuffer({ size: FU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const IU = new Float32Array(24 * 4 * 3 + 4 * 4 + 4);
ISL.forEach((I, i) => { IU.set([I.x, I.z, I.R, I.H], i * 4); IU.set([I.a1, I.p1, I.a2, I.p2], 96 + i * 4); IU.set([I.a3, I.p3, I.type, 0], 192 + i * 4); });
CRE.forEach((c, i) => IU.set(c, 288 + i * 4));
IU[304] = ISL.length;
const iBuf = buf(IU, GPUBufferUsage.UNIFORM);

const shTex = device.createTexture({ size: [SHADOW, SHADOW], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
const shView = shTex.createView();
const g0L = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: 3, buffer: {} }, { binding: 1, visibility: 3, buffer: {} }] });
const g1L = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: 2, texture: { sampleType: 'depth' } }, { binding: 1, visibility: 2, sampler: { type: 'comparison' } }] });
const gpL = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: 2, texture: { sampleType: 'float' } }, { binding: 1, visibility: 2, texture: { sampleType: 'float' } }, { binding: 2, visibility: 2, sampler: { type: 'filtering' } }, { binding: 3, visibility: 2, texture: { sampleType: 'depth', multisampled: true } }] });
const bg0 = device.createBindGroup({ layout: g0L, entries: [{ binding: 0, resource: { buffer: fBuf } }, { binding: 1, resource: { buffer: iBuf } }] });
const bg1 = device.createBindGroup({ layout: g1L, entries: [{ binding: 0, resource: shView }, { binding: 1, resource: device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' }) }] });
const layScene = device.createPipelineLayout({ bindGroupLayouts: [g0L, g1L] });
const layShadow = device.createPipelineLayout({ bindGroupLayouts: [g0L] });
const layPost = device.createPipelineLayout({ bindGroupLayouts: [g0L, gpL] });

const mod = code => device.createShaderModule({ code });
const LOG = (...a) => Q.has('dbg') && console.log(...a);
device.lost.then(i => console.log('DEVICE LOST', i.reason, i.message));
device.addEventListener('uncapturederror', e => console.log('GPUERR', e.error.message));
const mObj = mod(COMMON + SCENE + OBJ), mObjS = mod(COMMON + OBJ.replace(/@fragment[\s\S]*$/, '').replace(/fn terrainCol[\s\S]*$/, '')), mWat = mod(COMMON + SCENE + WATER), mStr = mod(COMMON + STREAK), mPost = mod(COMMON + POST);
for (const m of [mObj, mObjS, mWat, mStr, mPost]) { const info = await m.getCompilationInfo(); for (const e of info.messages) if (e.type === 'error') err('WGSL: ' + e.message + ' @' + e.lineNum); }

LOG('modules ok');
const objVB = [
  { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }, { shaderLocation: 2, offset: 16, format: 'unorm8x4' }, { shaderLocation: 3, offset: 20, format: 'uint8x4' }] },
  { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }, { shaderLocation: 5, offset: 16, format: 'float32x4' }] }];
const HDR = 'rgba16float';
const AUX = 'rgba8unorm';
const tgts = [{ format: HDR }, { format: AUX }];
const ms = { count: MSAA };
const ds = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
const [pObj, pWat, pStr, pSh, pPost] = await Promise.all([
  device.createRenderPipelineAsync({ layout: layScene, vertex: { module: mObj, entryPoint: 'vs', buffers: objVB }, fragment: { module: mObj, entryPoint: 'fs', targets: tgts }, primitive: { cullMode: 'none' }, depthStencil: ds, multisample: ms }),
  device.createRenderPipelineAsync({ layout: layScene, vertex: { module: mWat, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] }, fragment: { module: mWat, entryPoint: 'fs', targets: tgts }, primitive: { cullMode: 'none' }, depthStencil: ds, multisample: ms }),
  device.createRenderPipelineAsync({ layout: layShadow, vertex: { module: mStr, entryPoint: 'vs' }, fragment: { module: mStr, entryPoint: 'fs', targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }, { format: AUX, writeMask: 0 }] }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }, multisample: ms }),
  device.createRenderPipelineAsync({ layout: layShadow, vertex: { module: mObjS, entryPoint: 'vsShadow', buffers: objVB }, primitive: { cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 } }),
  device.createRenderPipelineAsync({ layout: layPost, vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: fmt }] } }),
]);

LOG('pipelines ok');
// render bundles: everything dynamic lives in uniforms, so command lists are static
function drawObjs(e, shadowPass) {
  e.setBindGroup(0, bg0);
  if (!shadowPass) e.setBindGroup(1, bg1);
  e.setVertexBuffer(0, vbuf); e.setVertexBuffer(1, instBuf); e.setIndexBuffer(ibuf, 'uint32');
  const d = (m, r) => { if (r.count) e.drawIndexed(meshes[m].count, r.count, meshes[m].first, 0, r.first); };
  d('terrain', instRanges.one); d('boat', instRanges.one);
  d('palm', instRanges.palm); d('tree', instRanges.tree); d('tree2', instRanges.tree2);
  d('gull', instRanges.gull);
  if (!shadowPass) d('crab', instRanges.crab);
}
const shBundleE = device.createRenderBundleEncoder({ colorFormats: [], depthStencilFormat: 'depth32float' });
shBundleE.setPipeline(pSh); drawObjs(shBundleE, true);
const shBundles = [shBundleE.finish()];
const mainE = device.createRenderBundleEncoder({ colorFormats: [HDR, AUX], depthStencilFormat: 'depth24plus', sampleCount: MSAA });
if (!Q.has('noobj')) { mainE.setPipeline(pObj); drawObjs(mainE, false); }
if (!Q.has('nowat')) { mainE.setPipeline(pWat); mainE.setBindGroup(0, bg0); mainE.setBindGroup(1, bg1); mainE.setVertexBuffer(0, wvBuf); mainE.setIndexBuffer(wiBuf, 'uint32'); mainE.drawIndexed(wi.length); }
if (!Q.has('nostr')) { mainE.setPipeline(pStr); mainE.setBindGroup(0, bg0); mainE.draw(48 * 6, 24); }
const mainBundles = [mainE.finish()];
LOG('bundles ok');

// size-dependent targets
let W = 0, H = 0, msC, msA, msD, rC, rA, postBundles;
const shPass = { colorAttachments: [], depthStencilAttachment: { view: shView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } };
const mainPass = { colorAttachments: [
  { view: null, resolveTarget: null, clearValue: [0.2, 0.5, 0.8, 1], loadOp: 'clear', storeOp: 'discard' },
  { view: null, resolveTarget: null, clearValue: [0, 0, 1, 0], loadOp: 'clear', storeOp: 'discard' }],
  depthStencilAttachment: { view: null, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } };
const postAtt = { view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] };
const postPass = { colorAttachments: [postAtt] };
const pointS = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
function resize() {
  const dpr = Q.has('w') ? 1 : devicePixelRatio || 1;
  const w = Q.has('w') ? +Q.get('w') : Math.round(canvas.clientWidth * dpr), h = Q.has('h') ? +Q.get('h') : Math.round(canvas.clientHeight * dpr);
  if (w === W && h === H) return;
  W = canvas.width = w; H = canvas.height = h;
  for (const t of [msC, msA, msD, rC, rA, offTex]) t && t.destroy();
  if (OFF) { offTex = device.createTexture({ size: [W, H], format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); offView = offTex.createView(); }
  const mk = (format, sc, extra = 0) => device.createTexture({ size: [W, H], format, sampleCount: sc, usage: GPUTextureUsage.RENDER_ATTACHMENT | extra });
  msC = mk(HDR, MSAA); msA = mk(AUX, MSAA); msD = mk('depth24plus', MSAA, GPUTextureUsage.TEXTURE_BINDING);
  rC = mk(HDR, 1, GPUTextureUsage.TEXTURE_BINDING); rA = mk(AUX, 1, GPUTextureUsage.TEXTURE_BINDING);
  mainPass.colorAttachments[0].view = msC.createView(); mainPass.colorAttachments[0].resolveTarget = rC.createView();
  mainPass.colorAttachments[1].view = msA.createView(); mainPass.colorAttachments[1].resolveTarget = rA.createView();
  mainPass.depthStencilAttachment.view = msD.createView();
  const bgp = device.createBindGroup({ layout: gpL, entries: [{ binding: 0, resource: rC.createView() }, { binding: 1, resource: rA.createView() }, { binding: 2, resource: pointS }, { binding: 3, resource: msD.createView() }] });
  const pe = device.createRenderBundleEncoder({ colorFormats: [fmt] });
  pe.setPipeline(pPost); pe.setBindGroup(0, bg0); pe.setBindGroup(1, bgp); pe.draw(3);
  postBundles = [pe.finish()];
}

// ---------- camera ----------
const cam = { x: 0, z: 0, vx: 0, vz: 0, zoom: 17 };
const M = new Float32Array(16), SM = new Float32Array(16);
function ortho(out, ex, ey, ez, rx, ry, rz, ux, uy, uz, fx, fy, fz, hw, hh, n, fr) {
  // view: right/up/forward basis, eye e; ortho projection to clip (z 0..1)
  const ix = 1 / hw, iy = 1 / hh, iz = 1 / (fr - n);
  out[0] = rx * ix; out[4] = ry * ix; out[8] = rz * ix; out[12] = -(rx * ex + ry * ey + rz * ez) * ix;
  out[1] = ux * iy; out[5] = uy * iy; out[9] = uz * iy; out[13] = -(ux * ex + uy * ey + uz * ez) * iy;
  out[2] = fx * iz; out[6] = fy * iz; out[10] = fz * iz; out[14] = (-(fx * ex + fy * ey + fz * ez) - n) * iz;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
}
let zoomT = 17;
let uo = 0;
function put(a, b, c, d) { FU[uo++] = a; FU[uo++] = b; FU[uo++] = c; FU[uo++] = d; }
function updateUniforms(dt) {
  const t = S.time;
  // critically damped follow (keeps boat centred, no jitter)
  const k = 1 - Math.exp(-dt * 6);
  cam.x += (S.x - cam.x) * k; cam.z += (S.z - cam.z) * k;
  cam.zoom += (zoomT - cam.zoom) * (1 - Math.exp(-dt * 3));
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH), cy = Math.cos(YAW), sy = Math.sin(YAW);
  const fx = -cp * sy, fy = -sp, fz = -cp * cy; // view direction
  const rx = cy, ry = 0, rz = -sy;               // right
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx; // up = right x fwd
  const hh = cam.zoom, hw = hh * W / H, D = 220;
  const ex = cam.x - fx * D, ey = 1.5 - fy * D, ez = cam.z - fz * D;
  ortho(M, ex, ey, ez, rx, ry, rz, ux, uy, uz, fx, fy, fz, hw, hh, 1, 450);
  // shadow camera along sun, snapped to texels
  const sx = -0.52, syy = 0.78, sz = 0.35, sl = Math.hypot(sx, syy, sz);
  const lx = sx / sl, ly = syy / sl, lz = sz / sl; // dir TO sun
  const sfx = -lx, sfy = -ly, sfz = -lz;
  let srx = sfz, sry = 0, srz = -sfx; const srl = Math.hypot(srx, srz); srx /= srl; srz /= srl;
  const sux = sry * sfz - srz * sfy, suy = srz * sfx - srx * sfz, suz = srx * sfy - sry * sfx;
  const ext = Math.max(90, hw * 1.25 + 10), tex = ext * 2 / SHADOW;
  let px = cam.x * srx + cam.z * srz, py = cam.x * sux + cam.z * suz, pz = cam.x * sfx + cam.z * sfz;
  px = Math.round(px / tex) * tex; py = Math.round(py / tex) * tex;
  const cxw = srx * px + sux * py + sfx * pz, cyw = sry * px + suy * py + sfy * pz, czw = srz * px + suz * py + sfz * pz;
  ortho(SM, cxw - sfx * 150, cyw - sfy * 150, czw - sfz * 150, srx, sry, srz, sux, suy, suz, sfx, sfy, sfz, ext, ext, 1, 300);
  // fill uniform block
  FU.set(M, 0); FU.set(SM, 16);
  uo = 32;
  put(rx, ry, rz, t);
  put(ux, uy, uz, hh * 2 / H);
  put(fx, fy, fz, WORLD_R);
  put(lx, ly, lz, S.ws);
  put(Math.sin(S.windA), Math.cos(S.windA), 0, WIND0);
  put(S.x, S.y, S.z, S.th);
  put(S.heel, S.pitch, S.rud, S.boom);
  put(S.fill, S.flap, Math.abs(S.u), S.anch);
  put(S.ax, S.az, S.adrop, S.pen);
  put(gullS.x, gullS.y, gullS.z, gullS.yaw);
  put(gullS.fold, gullS.flap, gullS.bank, 1);
  put(W, H, 1 / W, 1 / H);
  put(cam.x, cam.z, Math.round(cam.x / WS) * WS, Math.round(cam.z / WS) * WS);
  // HUD: screen-space angles (0 = up, clockwise)
  const wsx = Math.sin(S.windA) * rx + Math.cos(S.windA) * rz, wsy = Math.sin(S.windA) * ux + Math.cos(S.windA) * uz;
  const bsx = Math.sin(S.th) * rx + Math.cos(S.th) * rz, bsy = Math.sin(S.th) * ux + Math.cos(S.th) * uz;
  put(S.sheet, Math.atan2(wsx, -wsy), Math.atan2(bsx, -bsy), Math.abs(S.u));
  FU.set(wake, uo); uo += 192;
  FU.set(streak, uo);
  device.queue.writeBuffer(fBuf, 0, FU);
}

// ---------- timing / bench ----------
const MAXF = 16384;
const ft = new Float64Array(MAXF), gt = new Float64Array(MAXF);
let nf = 0;
let qs, qResolve, qAccum, qRead;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  qAccum = device.createBuffer({ size: MAXF * 16, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  shPass.timestampWrites = { querySet: qs, beginningOfPassWriteIndex: 0 };
  postPass.timestampWrites = { querySet: qs, endOfPassWriteIndex: 1 };
}
const cbs = [null];
let measuring = false;
function frame(dt) {
  updateUniforms(dt);
  const enc = device.createCommandEncoder();
  let p = enc.beginRenderPass(shPass); p.executeBundles(shBundles); p.end();
  p = enc.beginRenderPass(mainPass); p.executeBundles(mainBundles); p.end();
  postAtt.view = OFF ? offView : ctx.getCurrentTexture().createView();
  p = enc.beginRenderPass(postPass); p.executeBundles(postBundles); p.end();
  if (hasTS && measuring && nf < MAXF) { enc.resolveQuerySet(qs, 0, 2, qResolve, 0); enc.copyBufferToBuffer(qResolve, 0, qAccum, nf * 16, 16); }
  cbs[0] = enc.finish();
  device.queue.submit(cbs);
}

// ---------- input ----------
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k in keys) { keys[k] = 1; auto = false; }
  if (k === 'a' && !e.repeat) {
    auto = false;
    S.anch = S.anch ? 0 : 1;
    if (S.anch) { S.ax = S.x + Math.sin(S.th) * 2.6; S.az = S.z + Math.cos(S.th) * 2.6; S.adrop = 0; }
  }
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in keys) keys[k] = 0; });
addEventListener('wheel', e => { zoomT = clamp(zoomT * (1 + Math.sign(e.deltaY) * 0.1), 12, 40); }, { passive: true });
addEventListener('resize', resize);

function sim(dt) { let r = dt; while (r > 1e-6) { const h = Math.min(r, 1 / 120); step(h); r -= h; } }

// shot poses for the visual critic: [time, boat x, z, heading, zoom, sheet, anchored]
const SHOTS = [
  [6, 0, 0, 2.3, 17, 0.55, 0],
  [40, -6, 22, -0.2, 16, 0.7, 0],
  [80, 14, -2, 2.4, 13, 0.35, 0],
  [30, -12, -14, 1.5, 24, 0.9, 1],
  [120, 18, 14, -1.6, 22, 0.2, 0],
  [55, 2, 42, 3.6, 12, 0.8, 0]];

resize();
LOG('resize ok');
document.getElementById('msg').remove();
if (CAPTURE) {
  // deterministic stepping for screenshots / frame sequences
  const show = async () => {
    const bpr = W * 4, rb = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: offTex }, { buffer: rb, bytesPerRow: bpr }, [W, H]); device.queue.submit([e.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rb.getMappedRange().slice(0)), W, H), 0, 0); rb.destroy();
  };
  window.__frame = async (t, dtFrame = 1 / 30) => { while (S.time < t - 1e-6) { sim(Math.min(dtFrame, t - S.time)); updateUniforms(dtFrame); } frame(dtFrame); await show(); };
  if (SHOT >= 0) {
    const [t, x, z, th, zm, sh, an] = SHOTS[SHOT];
    S.x = x - Math.sin(th) * 30; S.z = z - Math.cos(th) * 30; S.th = th; S.sheet = sh; zoomT = cam.zoom = zm; auto = false;
    S.u = 3; S.time = t - 10; cam.x = S.x; cam.z = S.z;
    keys.s = 0; keys.d = 0;
    // sail in for the run-up then settle on the shot heading
    while (S.time < t - 1e-6) { sim(1 / 60); updateUniforms(1 / 60); S.th += Math.atan2(Math.sin(th - S.th), Math.cos(th - S.th)) * 0.05; if (an && !S.anch && S.time > t - 4) { S.anch = 1; S.ax = S.x + Math.sin(S.th) * 2.6; S.az = S.z + Math.cos(S.th) * 2.6; S.adrop = 0; } }
    gullS.st = SHOT === 5 ? 2 : gullS.st; gullS.t = 2; gullS.fold = 1; sim(1 / 60);
    cam.x = S.x; cam.z = S.z;
    LOG('sim ok');
    frame(1 / 60); LOG('frame submitted'); await show();
  }
  window.__ready = true;
} else {
  let last = performance.now(), t0 = last, warm = 0;
  const loop = now => {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    if (BENCH) {
      if (warm < 60) { warm++; if (warm === 60) { measuring = true; t0 = now; nf = 0; } }
      else if (nf < MAXF) { ft[nf++] = dt * 1000; }
      const el = (now - t0) / 1000;
      zoomT = 22 + 8 * Math.sin(el * 0.21);
      if (measuring && el >= 60) { measuring = false; finishBench(); }
    }
    sim(dt);
    frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function finishBench() {
  const n = nf;
  const st = a => { const s = Array.from(a).sort((x, y) => x - y); const avg = s.reduce((x, y) => x + y, 0) / s.length; return { avg: +avg.toFixed(3), p99: +s[Math.floor(s.length * 0.99)].toFixed(3), max: +s[s.length - 1].toFixed(3) }; };
  const rep = { frames: n, size: [W, H], adapter: adapter.info && adapter.info.description, frameMs: st(ft.subarray(1, n)) };
  if (hasTS) {
    await device.queue.onSubmittedWorkDone();
    const rb = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = device.createCommandEncoder(); e.copyBufferToBuffer(qAccum, 0, rb, 0, n * 16); device.queue.submit([e.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const v = new BigUint64Array(rb.getMappedRange());
    for (let i = 0; i < n; i++) gt[i] = Number(v[i * 2 + 1] - v[i * 2]) / 1e6;
    rep.gpuMs = st(gt.subarray(0, n).filter(x => x > 0 && x < 1000));
    rep.over16_7 = Array.from(gt.subarray(0, n)).filter(x => x > 16.7).length;
  }
  rep.framesOver16_7 = Array.from(ft.subarray(1, n)).filter(x => x > 16.7).length;
  window.__bench = rep;
  console.log('BENCH', JSON.stringify(rep));
  const d = document.createElement('pre'); d.id = 'bench'; d.textContent = JSON.stringify(rep, null, 2); document.body.appendChild(d);
}
