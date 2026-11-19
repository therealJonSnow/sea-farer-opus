// WGSL sources. Kept as JS template strings so the build can inline + strip them.
export const COMMON = /* wgsl */`
diagnostic(off, derivative_uniformity);
struct F {
  vp: mat4x4f, svp: mat4x4f,
  cr: vec4f,   // cam right, w=time
  cu: vec4f,   // cam up, w=world units per pixel
  cf: vec4f,   // cam forward (view dir), w=boundary radius
  sun: vec4f,  // sun dir, w=wind strength
  wind: vec4f, // wind dir xz, gust, base wind angle
  boat: vec4f, // x, y, z, heading
  boat2: vec4f,// heel, pitch, rudder, boom
  boat3: vec4f,// fill, flap, speed, anchored
  anc: vec4f,  // anchor x,z, time since drop, pennant angle
  gull: vec4f, // mast gull x,y,z,yaw
  gull2: vec4f,// fold, flap phase, bank, visible
  scr: vec4f,  // w,h,1/w,1/h
  tgt: vec4f,  // cam target xz, grid origin xz
  hud: vec4f,  // sheet, wind screen angle, heading screen angle, speed
  wake: array<vec4f, 48>,
  streak: array<vec4f, 24>,
};
struct I { a: array<vec4f,24>, b: array<vec4f,24>, c: array<vec4f,24>, cr: array<vec4f,4>, n: vec4f };
@group(0) @binding(0) var<uniform> f: F;
@group(0) @binding(1) var<uniform> isl: I;

const PI = 3.14159265;
fn T() -> f32 { return f.cr.w; }
fn h21(p: vec2f) -> f32 { var q = fract(p * vec2f(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
fn h22(p: vec2f) -> vec2f { let n = h21(p); return vec2f(n, h21(p + n * 17.17)); }
fn vn(p: vec2f) -> f32 {
  let i = floor(p); let u = fract(p); let w = u * u * (3.0 - 2.0 * u);
  return mix(mix(h21(i), h21(i + vec2f(1, 0)), w.x), mix(h21(i + vec2f(0, 1)), h21(i + vec2f(1, 1)), w.x), w.y);
}
fn fbm(p0: vec2f) -> f32 { var p = p0; var a = 0.5; var s = 0.0; for (var i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2f(1.7, 9.2); a *= 0.5; } return s; }
fn lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

// Gerstner waves, mirrored in JS (waveH)
fn waveDir(i: i32) -> vec2f { let a = f.wind.w + array<f32,4>(0.0, 0.45, -0.55, 1.2)[i]; return vec2f(sin(a), cos(a)); }
fn gerst(p: vec2f, damp: f32) -> vec3f {
  var o = vec3f(p.x, 0.0, p.y);
  for (var i = 0; i < 4; i++) {
    let L = array<f32,4>(24.0, 13.0, 8.5, 33.0)[i]; let A = array<f32,4>(0.24, 0.12, 0.07, 0.2)[i] * damp;
    let k = 2.0 * PI / L; let w = sqrt(9.8 * k) * 0.55; let d = waveDir(i);
    let th = k * dot(d, p) - w * T();
    o.x += 0.55 * A * d.x * cos(th); o.z += 0.55 * A * d.y * cos(th); o.y += A * sin(th);
  }
  return o;
}
fn islR(i: u32, th: f32) -> f32 {
  let a = isl.a[i]; let b = isl.b[i]; let c = isl.c[i];
  return a.z * (1.0 + b.x * sin(2.0 * th + b.y) + b.z * sin(3.0 * th + b.w) + c.x * sin(5.0 * th + c.y));
}
// signed distance-ish to nearest coastline (negative = inside island)
fn shoreD(p: vec2f) -> f32 {
  var m = 1e4;
  let n = u32(isl.n.x);
  for (var i = 0u; i < n; i++) {
    let a = isl.a[i]; let v = p - a.xy; let d = length(v);
    if (d - a.z * 1.3 > m) { continue; }
    m = min(m, d - islR(i, atan2(v.y, v.x)));
  }
  return m;
}
fn cloud(p: vec2f) -> f32 {
  let q = p * 0.011 - f.wind.xy * T() * 0.018;
  let c = fbm(q + vec2f(fbm(q * 1.7) * 0.6));
  return 1.0 - 0.16 * smoothstep(0.52, 0.66, c);
}
`;

export const SCENE = /* wgsl */`
@group(1) @binding(0) var shTex: texture_depth_2d;
@group(1) @binding(1) var shSmp: sampler_comparison;

fn shadow(wp: vec3f, n: vec3f) -> f32 {
  let s = f.svp * vec4f(wp + n * 0.08, 1.0);
  let uv = vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let z = s.z - 0.0015;
  let px = 1.0 / 2048.0;
  var a = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    a += textureSampleCompareLevel(shTex, shSmp, uv + vec2f(f32(i), f32(j)) * px * 1.25, z);
  } }
  return a / 9.0;
}
// painterly toon light
fn light(n: vec3f, sh: f32, wp: vec3f) -> vec3f {
  let ndl = dot(n, f.sun.xyz);
  let l = smoothstep(-0.02, 0.18, ndl) * sh * cloud(wp.xz);
  let hi = smoothstep(0.62, 0.8, ndl) * sh;
  let shade = vec3f(0.42, 0.47, 0.72);
  let warm = vec3f(1.06, 1.0, 0.92);
  return mix(shade, warm, l) + hi * vec3f(0.07, 0.06, 0.03) + max(n.y, 0.0) * vec3f(0.02, 0.04, 0.07);
}
struct GOut { @location(0) c: vec4f, @location(1) a: vec4f };
fn gout(col: vec3f, n: vec3f, z: f32, mat: f32) -> GOut {
  var o: GOut;
  o.c = vec4f(col, 1.0);
  o.a = vec4f(dot(n, f.cr.xyz) * 0.5 + 0.5, dot(n, f.cu.xyz) * 0.5 + 0.5, 0.0, mat / 8.0);
  return o;
}
`;

export const OBJ = /* wgsl */`
struct VIn {
  @location(0) p: vec3f, @location(1) n: vec4f, @location(2) c: vec4f, @location(3) m: vec4u,
  @location(4) ia: vec4f, @location(5) ib: vec4f,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) c: vec4f,
  @location(3) @interpolate(flat) m: vec4u, @location(4) lp: vec3f,
};
fn ry(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
fn rz(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.y * s, -v.x * s + v.y * c, v.z); }
fn rx(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x, v.y * c + v.z * s, -v.y * s + v.z * c); }
fn boatX(v: vec3f) -> vec3f { return ry(rx(rz(v, f.boat2.x), f.boat2.y), f.boat.w) + f.boat.xyz; }
fn boatN(v: vec3f) -> vec3f { return ry(rx(rz(v, f.boat2.x), f.boat2.y), f.boat.w); }

fn sailP(uv: vec2f) -> vec3f {
  let tack = vec3f(0.0, 0.92, 0.5); let head = vec3f(0.0, 4.25, 0.56); let clew = vec3f(0.0, 0.92, -1.85);
  var p = mix(mix(tack, clew, uv.x), head, uv.y);
  let u = uv.x; let v = uv.y;
  let bel = 4.0 * u * (1.0 - u) * (1.0 - 0.75 * v) * (0.55 + 0.45 * sin(PI * min(v * 1.4, 1.0)));
  let side = sign(f.boat2.w + 1e-4);
  var x = side * f.boat3.x * 0.62 * bel * (0.55 + 0.45 * (1.0 - v));
  let fl = f.boat3.y;
  x += fl * 0.32 * sin(9.0 * u - T() * 17.0 + v * 4.0) * u * (1.0 - v * 0.6);
  p.x += x;
  return p;
}
struct X { p: vec3f, n: vec3f };
fn xform(i: VIn) -> X {
  var p = i.p; var n = i.n.xyz;
  let kind = i.m.x; let part = i.m.y; let t = T();
  var o: X;
  if (kind == 0u) { o.p = p; o.n = n; return o; }
  if (kind == 1u || kind == 2u) { // trees
    let sc = i.ia.w; let h = max(p.y, 0.0) / 5.0;
    p = ry(p * sc, i.ib.x);
    let gust = 0.6 + 0.4 * sin(t * 0.9 + i.ia.x * 0.05 + i.ia.z * 0.04);
    let sway = f.sun.w * 0.012 * gust * (0.8 + 0.35 * sin(t * 2.1 + i.ib.y)) * h * h * sc;
    p += vec3f(f.wind.x, -0.15 * sway * h, f.wind.y) * sway * 2.2;
    if (part == 1u) { p += vec3f(f.wind.x, 0.0, f.wind.y) * 0.05 * sin(t * 6.0 + i.ib.y + p.y * 3.0) * sc + vec3f(0.0, 0.04 * sin(t * 5.0 + p.x * 2.0) * sc, 0.0); }
    o.p = p + i.ia.xyz; o.n = ry(n, i.ib.x); return o;
  }
  if (kind == 3u) { // crab: scuttle sideways along tangent
    let ph = t * i.ib.z + i.ib.y;
    let walk = sin(ph) + 0.3 * sin(ph * 2.3);
    let moving = abs(cos(ph));
    if (part == 1u) { p.y += 0.06 * sin(t * 22.0 + p.x * 9.0 + p.z * 5.0) * moving; p.z += 0.05 * sin(t * 22.0 + p.x * 7.0) * moving; }
    if (part == 2u) { p.y += 0.06 * max(sin(t * 3.0 + i.ib.y), 0.0); }
    p = ry(p * i.ia.w, i.ib.x);
    let tg = vec3f(cos(i.ib.x), 0.0, -sin(i.ib.x));
    o.p = p + i.ia.xyz + tg * walk * i.ib.w; o.n = ry(n, i.ib.x); return o;
  }
  if (kind == 4u) { // gull
    var c: vec3f; var yaw: f32; var bank: f32; var flap: f32; var fold = 0.0;
    if (i.ib.w < 0.0) {
      c = f.gull.xyz; yaw = f.gull.w; bank = f.gull2.z; fold = f.gull2.x; flap = f.gull2.y;
      if (f.gull2.w < 0.5) { c.y -= 1000.0; }
    } else {
      var ctr = i.ia.xz;
      if (i.ib.w > 0.5) { ctr += f.boat.xz; }
      let r = i.ib.z; let a = i.ib.y + t * 7.0 / r;
      c = vec3f(ctr.x + cos(a) * r, i.ia.y + 1.5 * sin(t * 0.5 + i.ib.y), ctr.y + sin(a) * r);
      yaw = -a; bank = -0.35;
      flap = t * 9.0 + i.ib.y * 7.0;
      fold = 0.0;
    }
    let ft = select(0.0, 1.0, i.ib.w >= 0.0);
    let glide = mix(1.0, smoothstep(-0.2, 0.6, sin(t * 0.7 + i.ib.y * 3.0)), ft);
    if (part == 1u || part == 2u) {
      let sd = select(-1.0, 1.0, part == 2u);
      let ax = abs(p.x);
      var ang = mix(0.55 * sin(flap) * glide + 0.12, -0.35, fold);
      let pc = vec2f(ax, p.y);
      let ca = cos(ang); let sa = sin(ang);
      let pr = vec2f(pc.x * ca - pc.y * sa, pc.x * sa + pc.y * ca);
      p = vec3f(sd * (pr.x * mix(1.0, 0.18, fold) + fold * 0.13), pr.y - fold * 0.04, p.z - fold * ax * 0.55);
      let nr = vec2f(abs(n.x) * ca - n.y * sa, abs(n.x) * sa + n.y * ca);
      n = vec3f(sd * nr.x, nr.y, n.z);
    }
    p = rz(p * 1.3, bank); n = rz(n, bank);
    o.p = ry(p, yaw) + c; o.n = ry(n, yaw); return o;
  }
  // kind 5: boat
  if (part == 1u || part == 2u) {
    if (part == 2u) {
      let uv = i.c.xy;
      p = sailP(uv);
      let e = 0.02;
      let du = sailP(uv + vec2f(e, 0.0)) - p; let dv = sailP(uv + vec2f(0.0, e)) - p;
      n = normalize(cross(dv, du));
    }
    let piv = vec3f(0.0, 0.0, 0.55);
    p = ry(p - piv, -f.boat2.w) + piv; n = ry(n, -f.boat2.w);
  } else if (part == 3u) {
    let piv = vec3f(0.0, 0.0, -2.02);
    p = ry(p - piv, f.boat2.z * 0.6) + piv; n = ry(n, f.boat2.z * 0.6);
  } else if (part == 4u || part == 5u) {
    p = vec3f(0.0, 0.05, -1.25) + (p - vec3f(0.0, 0.05, -1.15)) * 1.28;
    let piv = vec3f(0.0, 0.1, -1.25);
    p = rz(p - piv, -f.boat2.x * 0.6 + f.boat2.z * 0.06) + piv;
    if (part == 5u) { let hp = vec3f(0.0, 1.71, -1.25); p = ry(p - hp, 0.35 * sin(t * 0.4) + f.boat2.z * 0.3) + hp; p.y += 0.02 * sin(t * 3.0); }
  } else if (part == 6u) {
    let piv = vec3f(0.0, 0.0, 0.56); let d = p - piv; let fl = max(-d.z, 0.0);
    var q = d; q.x += 0.08 * sin(t * 13.0 - fl * 9.0) * fl;
    p = ry(q, -f.anc.w) + piv; n = ry(n, -f.anc.w);
  } else if (part == 7u) {
    if (f.boat3.w > 0.5) { p *= 0.0; }
  } else if (part == 8u) {
    let bow = boatX(vec3f(0.0, 0.62, 2.05));
    let an = vec3f(f.anc.x, -0.2, f.anc.y);
    let ax = normalize(an - bow); let sd = normalize(cross(ax, vec3f(0.0, 1.0, 0.0))); let up = cross(sd, ax);
    var q = mix(bow, an, p.y) + (sd * p.x + up * p.z) * 0.6;
    q.y -= sin(PI * p.y) * 0.4;
    if (f.boat3.w < 0.5) { q.y -= 1000.0; }
    o.p = q; o.n = normalize(sd * n.x + up * n.z); return o;
  }
  o.p = boatX(p); o.n = boatN(n); return o;
}

@vertex fn vs(i: VIn) -> VOut {
  let x = xform(i);
  var o: VOut;
  o.pos = f.vp * vec4f(x.p, 1.0); o.wp = x.p; o.n = x.n; o.c = i.c; o.m = i.m; o.lp = i.p;
  return o;
}
@vertex fn vsShadow(i: VIn) -> @builtin(position) vec4f { let x = xform(i); return f.svp * vec4f(x.p, 1.0); }

fn terrainCol(wp: vec3f, n: vec3f) -> vec3f {
  let nz = fbm(wp.xz * 0.35);
  let y = wp.y;
  let sand = mix(vec3f(0.98, 0.86, 0.55), vec3f(0.93, 0.76, 0.45), nz);
  let wet = vec3f(0.80, 0.66, 0.42);
  var grass = mix(vec3f(0.42, 0.78, 0.25), vec3f(0.24, 0.62, 0.22), smoothstep(0.35, 0.75, fbm(wp.xz * 0.12)));
  grass = mix(grass, vec3f(0.62, 0.84, 0.28), 0.35 * smoothstep(0.6, 0.85, nz));
  let strata = 0.5 + 0.5 * sin(y * 4.2 + nz * 2.5);
  let rock = mix(vec3f(0.74, 0.55, 0.42), vec3f(0.56, 0.40, 0.33), smoothstep(0.3, 0.8, strata));
  var c = mix(wet, sand, smoothstep(0.05, 0.35, y + nz * 0.1));
  let gh = select(1.15, 0.9, isl.n.y > 0.0);
  let tj = (fbm(wp.xz * 0.21 + vec2f(y * 0.3)) - 0.5) * 0.22;
  let isGrass = smoothstep(1.05, 1.25, y + nz * 0.5) * smoothstep(0.62 + tj, 0.72 + tj, n.y);
  c = mix(c, grass, isGrass);
  let isRock = smoothstep(0.62 + tj, 0.5 + tj, n.y) * smoothstep(0.2, 0.6, y);
  c = mix(c, rock, isRock);
  // flowers on grass
  let cell = floor(wp.xz * 1.4); let fp = h22(cell); let dd = length(fract(wp.xz * 1.4) - (0.2 + fp * 0.6));
  let fw = fwidth(dd) * 1.2;
  let fl = (1.0 - smoothstep(0.11 - fw, 0.11 + fw, dd)) * step(0.86, h21(cell + 3.1)) * isGrass * (1.0 - isRock);
  let fc = select(select(vec3f(1.0, 0.95, 0.9), vec3f(1.0, 0.85, 0.25), fp.x > 0.5), vec3f(1.0, 0.55, 0.7), fp.y > 0.66);
  c = mix(c, fc, fl);
  return c;
}

@fragment fn fs(v: VOut) -> GOut {
  var n = normalize(v.n);
  let ff = dot(n, f.cf.xyz) < 0.0;
  if (!ff) { n = -n; }
  let kind = v.m.x; let part = v.m.y;
  var c = v.c.rgb; var mat = 3.0;
  if (kind == 0u) { c = terrainCol(v.wp, n); mat = 1.0; }
  else if (kind == 5u) {
    mat = 3.0;
    if (part == 2u) {
      // sail cloth + original emblem: a sun over two waves
      let uv = v.c.xy; mat = 5.0;
      c = vec3f(0.97, 0.92, 0.80);
      let seam = abs(fract(uv.y * 6.0 + uv.x * 0.3) - 0.5); c *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.06, seam));
      let e = vec2f((uv.x - 0.3) * 1.15, uv.y - 0.38);
      let r = length(e);
      let aa = fwidth(r) * 1.5;
      let sunm = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, r);
      let ray = smoothstep(0.13, 0.135, r) * (1.0 - smoothstep(0.19 - aa, 0.19 + aa, r)) * smoothstep(0.3, 0.6, cos(atan2(e.y, e.x) * 8.0));
      c = mix(c, vec3f(0.95, 0.45, 0.12), max(sunm, ray));
      for (var k = 0; k < 2; k++) {
        let wy = e.y + 0.17 + f32(k) * 0.065 - 0.02 * sin(e.x * 40.0);
        let wa = fwidth(wy) * 1.2;
        let wm = (1.0 - smoothstep(0.013 - wa, 0.013 + wa, abs(wy))) * (1.0 - smoothstep(0.16, 0.18, abs(e.x)));
        c = mix(c, vec3f(0.12, 0.45, 0.78), wm);
      }
      if (!ff) { c *= 0.92; }
    } else if (part == 0u && v.c.a < 0.5) {
      // painted hull: outside paint, inside planks
      if (!ff) { c = vec3f(0.72, 0.5, 0.31) * (0.9 + 0.1 * step(0.5, fract(v.lp.y * 6.0))); }
    } else if (v.c.a > 0.5 && v.c.a < 0.75) {
      let pl = fract(v.lp.x * 3.2); c *= 0.88 + 0.12 * smoothstep(0.04, 0.1, pl) * smoothstep(0.96, 0.9, pl);
    }
    if (part == 4u || part == 5u) { mat = 4.0; }
  } else if (kind == 1u || kind == 2u) { mat = 6.0; }
  else { mat = 7.0; }
  let sh = shadow(v.wp, n);
  var col = lin(c) * light(n, sh, v.wp);
  // rim of warm light
  col += lin(c) * 0.12 * pow(1.0 - abs(dot(n, f.cf.xyz)), 3.0);
  let fog = smoothstep(f.cf.w * 0.8, f.cf.w, length(v.wp.xz));
  col = mix(col, vec3f(0.92, 0.95, 0.97), fog);
  return gout(col, n, v.pos.z, mat);
}
`;

export const WATER = /* wgsl */`
struct WOut { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) g: vec2f, @location(2) sd: f32 };
@vertex fn vs(@location(0) g: vec2f) -> WOut {
  let base = g + f.tgt.zw;
  let sd = shoreD(base);
  let damp = 0.35 + 0.65 * smoothstep(0.0, 14.0, sd);
  let p = gerst(base, damp);
  var o: WOut; o.pos = f.vp * vec4f(p, 1.0); o.wp = p; o.g = base; o.sd = sd;
  return o;
}
fn wnorm(p: vec2f) -> vec3f {
  let e = 0.25;
  let a = gerst(p, 1.0).y; let b = gerst(p + vec2f(e, 0.0), 1.0).y; let c = gerst(p + vec2f(0.0, e), 1.0).y;
  return normalize(vec3f(a - b, e, a - c));
}
// voronoi border distance (iq)
fn vor(x: vec2f) -> f32 {
  let n = floor(x); let fr = fract(x);
  var mg: vec2f; var mr: vec2f; var md = 8.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let g = vec2f(f32(i), f32(j));
    var o = h22(n + g); o = 0.5 + 0.38 * sin(T() * 0.35 + 6.2831 * o);
    let r = g + o - fr; let d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  } }
  md = 8.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let g = mg + vec2f(f32(i), f32(j));
    var o = h22(n + g); o = 0.5 + 0.38 * sin(T() * 0.35 + 6.2831 * o);
    let r = g + o - fr;
    if (dot(mr - r, mr - r) > 0.00001) { md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }
  } }
  return md;
}
fn segD(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
  let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return vec2f(length(pa - ba * h), h);
}
fn creature(p: vec2f, k: i32) -> f32 {
  let cr = isl.cr[k];
  let t = T();
  let a = cr.w + t * 0.045 * select(1.0, -1.0, k == 1);
  let ctr = cr.xy + vec2f(cos(a), sin(a)) * cr.z;
  let fw = normalize(vec2f(-sin(a), cos(a)) * select(1.0, -1.0, k == 1));
  let sc = select(1.0, 0.8, k == 2);
  var q = p - ctr; q = vec2f(dot(q, fw), dot(q, vec2f(-fw.y, fw.x))) / sc;
  if (dot(q, q) > 200.0) { return 0.0; }
  var d: f32;
  if (k == 2) { // manta
    let fl = 0.25 * sin(t * 1.3);
    let w = q.x + abs(q.y) * (0.55 + fl * 0.2);
    d = max(abs(q.y) - 5.0 * (1.0 + fl * 0.1) * clamp(1.0 - abs(q.x - 0.3 + abs(q.y) * 0.3) / 2.6, 0.0, 1.0), -999.0);
    d = max(d, -(3.0 - abs(w - 0.6)));
    let tail = segD(q, vec2f(-1.0, 0.0), vec2f(-7.0, 0.6 * sin(t * 0.9)));
    d = min(d, tail.x - 0.18);
  } else { // whale
    let sw = sin(t * 1.1 - q.x * 0.35) * 0.35 * smoothstep(1.0, -6.0, q.x);
    q.y -= sw;
    let body = length(q / vec2f(5.2, 1.5)) - 1.0;
    d = body * 1.4;
    let tail = segD(q, vec2f(-4.0, 0.0), vec2f(-7.0, 0.0)).x - 0.35;
    d = min(d, tail);
    let fl = vec2f(q.x + 7.4, abs(q.y)); let fluke = length((fl - vec2f(0.0, 1.0)) / vec2f(0.55, 1.15)) - 1.0;
    d = min(d, fluke * 0.6);
    let fin = length((vec2f(q.x - 1.6, abs(q.y) - 1.7)) / vec2f(0.9, 0.35)) - 1.0;
    d = min(d, fin * 0.5);
  }
  return 1.0 - smoothstep(-0.35, 0.45, d * sc);
}
@fragment fn fs(v: WOut) -> GOut {
  let p = v.wp.xz; let t = T();
  let sd = shoreD(v.g);
  let n = normalize(mix(wnorm(v.g), vec3f(0.0, 1.0, 0.0), 0.35));
  let wind = f.wind.xy;
  // base pigment: deep -> mid -> shallow lagoon
  let lf = fbm(p * 0.03 + vec2f(3.0, 1.0));
  var c = mix(vec3f(0.07, 0.42, 0.78), vec3f(0.12, 0.56, 0.86), smoothstep(0.3, 0.7, lf));
  let shallow = 1.0 - smoothstep(0.5, 11.0, sd);
  c = mix(c, vec3f(0.24, 0.80, 0.82), shallow * 0.9);
  c = mix(c, vec3f(0.55, 0.88, 0.80), (1.0 - smoothstep(0.0, 2.5, sd)) * 0.6);
  // creatures below
  var dark = 0.0;
  for (var k = 0; k < 3; k++) { dark = max(dark, creature(p + 0.12 * vec2f(sin(p.y * 0.8 + t), cos(p.x * 0.7 + t)), k)); }
  c = mix(c, vec3f(0.02, 0.22, 0.52), dark * 0.6 * smoothstep(1.0, 6.0, sd));
  // cat's paws: wind gust patches sliding downwind
  let wq = vec2f(dot(p, wind), dot(p, vec2f(-wind.y, wind.x)));
  let gust = smoothstep(0.55, 0.78, fbm(vec2f(wq.x * 0.05 - t * 0.33, wq.y * 0.11)));
  c *= 1.0 - 0.13 * gust;
  // toon wave shading
  let ndl = dot(n, f.sun.xyz);
  c *= 0.9 + 0.16 * smoothstep(0.55, 0.75, ndl);
  // cell foam lines (stillness patches fade them)
  let wp2 = p + wind * t * 0.35;
  let warp = vec2f(fbm(wp2 * 0.08), fbm(wp2 * 0.08 + 5.2)) * 3.0;
  let vd = vor((wp2 + warp) * 0.17) / 0.17;
  let still = smoothstep(0.36, 0.6, fbm(p * 0.03 + vec2f(t * 0.01, 3.0)));
  let lw = 0.085 + 0.06 * fbm(p * 0.5);
  let aa = fwidth(vd) * 1.0;
  let line = (1.0 - smoothstep(lw - aa, lw + aa, vd)) * mix(0.12, 1.0, still) * (0.45 + 0.55 * smoothstep(0.3, 0.6, vn(p * 0.25 + t * 0.15))) * smoothstep(1.5, 6.0, sd) * (1.0 + 0.3 * gust);
  var foam = line * 0.85;
  // cartoon crest crescents that come and go
  let cs = 14.0;
  let cid = floor(wq / cs); let ch = h22(cid);
  let ph = fract(t * 0.12 + ch.x);
  let life = smoothstep(0.0, 0.25, ph) * smoothstep(1.0, 0.6, ph);
  let cc = (cid + 0.25 + 0.5 * ch) * cs + vec2f(ph * 3.0, 0.0);
  let lq = (wq - cc) / vec2f(1.0, 2.2);
  let ra = length(lq);
  let arc = abs(ra - 1.6) - 0.09 * (0.6 + 0.4 * life);
  let arcm = smoothstep(-0.6, 0.4, lq.x) * smoothstep(0.0, 0.5, -lq.x + 1.6);
  let caa = fwidth(arc) * 1.0;
  foam = max(foam, (1.0 - smoothstep(-caa, caa, arc)) * arcm * life * step(0.45, ch.y) * smoothstep(1.0, 8.0, sd));
  // shoreline foam + lapping rings
  let sa = fwidth(sd) * 1.0;
  let lap = fract(t * 0.22 + fbm(p * 0.2) * 0.4);
  let ringD = 0.25 + lap * 3.2;
  let ring = (1.0 - smoothstep(0.14 - sa, 0.14 + sa, abs(sd - ringD))) * (1.0 - lap);
  let edge = 1.0 - smoothstep(0.35 - sa, 0.35 + sa, sd + 0.15 * sin(p.x * 1.3 + t * 1.5) * sin(p.y * 1.1));
  foam = max(foam, max(edge, ring * 0.9));
  // wake: V trail from the boat history
  let bp = f.boat.xz;
  var wk = 0.0;
  let bd = length(p - bp);
  if (bd < 70.0) {
    var bdist = 1e4; var bage = 0.0; var bstr = 0.0;
    for (var i = 0; i < 47; i++) {
      let a = f.wake[i]; let b = f.wake[i + 1];
      if (a.w <= 0.0 || b.w <= 0.0) { continue; }
      let ba = b.xy - a.xy; let hh = dot(p - a.xy, ba) / max(dot(ba, ba), 1e-5);
      if (hh < -0.02 || hh > 1.02) { continue; }
      let sg = vec2f(abs(dot(p - a.xy, normalize(vec2f(-ba.y, ba.x) + 1e-6))), clamp(hh, 0.0, 1.0));
      let age = mix(a.z, b.z, sg.y);
      // compare against the expanding V so older (wider) sections win where they should
      let score = sg.x - (0.7 + age * 0.55);
      if (abs(score) < abs(bdist)) { bdist = score; bage = age; bstr = mix(a.w, b.w, sg.y); }
    }
    if (bdist < 1e3) {
      let spread = 0.7 + bage * 0.55;
      let fade = exp(-bage * 0.62) * bstr;
      let wob = 0.12 * sin(dot(p, vec2f(1.7, 1.3)) + t * 2.0) + 0.08 * sin(dot(p, vec2f(-2.9, 2.3)) - t * 1.3);
      let wdth = 0.16 * (1.0 - smoothstep(0.0, 4.0, bage)) + 0.06;
      let edgeL = 1.0 - smoothstep(wdth, wdth + 0.12, abs(bdist + wob));
      let core = (1.0 - smoothstep(-spread, -spread * 0.3, bdist)) * 0.35 * (1.0 - smoothstep(0.0, 2.0, bage));
      wk = max(edgeL, core) * fade;
    }
    // hull foam ring
    let hd = vec2f(sin(f.boat.w), cos(f.boat.w));
    let lq2 = vec2f(dot(p - bp, vec2f(hd.y, -hd.x)), dot(p - bp, hd) - 0.1);
    let he = length(lq2 / vec2f(0.95, 2.35)) - 1.0;
    let spd = clamp(f.boat3.z / 4.0, 0.0, 1.0);
    let bow = smoothstep(0.0, 1.5, lq2.y) * spd;
    wk = max(wk, (1.0 - smoothstep(0.0, 0.18 + 0.3 * bow, he)) * smoothstep(-0.2, 0.0, he) * (0.6 + 0.4 * vn(p * 3.0 + t * 4.0)));
  }
  // anchor splash rings
  if (f.boat3.w > 0.5) {
    let at = f.anc.z; let ad = length(p - f.anc.xy);
    for (var r = 0; r < 2; r++) {
      let rt = at - f32(r) * 0.6;
      if (rt > 0.0 && rt < 4.0) { let rr = rt * 1.6; foam = max(foam, (1.0 - smoothstep(0.08, 0.2, abs(ad - rr))) * (1.0 - rt / 4.0)); }
    }
  }
  foam = max(foam, wk);
  let sh = shadow(v.wp, vec3f(0.0, 1.0, 0.0));
  let cl = cloud(p);
  var col = lin(c) * mix(vec3f(0.62, 0.7, 0.92), vec3f(1.0), sh) * mix(vec3f(0.82, 0.88, 1.0), vec3f(1.0), (cl - 0.84) / 0.16);
  col = mix(col, lin(vec3f(0.96, 0.99, 1.0)) * mix(0.85, 1.0, sh), foam);
  let fog = smoothstep(f.cf.w * 0.8, f.cf.w, length(p));
  col = mix(col, vec3f(0.92, 0.95, 0.97), fog);
  return gout(col, vec3f(0.0, 1.0, 0.0), v.pos.z, 2.0);
}
`;

export const STREAK = /* wgsl */`
struct SOut { @builtin(position) pos: vec4f, @location(0) a: f32 };
fn spath(s: f32, L: f32, R: f32, s0: f32) -> vec2f {
  let k = smoothstep(s0 - 0.12, s0 + 0.12, s);
  return vec2f(L * s - R * sin(6.2831 * k), R * (1.0 - cos(6.2831 * k)));
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  let st = f.streak[ii];
  let seg = vi / 6u; let c = vi % 6u;
  let sidev = select(-1.0, 1.0, c == 1u || c == 2u || c == 4u);
  let segf = f32(seg) + select(0.0, 1.0, c == 2u || c == 4u || c == 5u);
  let s = segf / 48.0;
  let age = (T() - st.z) / 4.0;
  let head = age * 1.4; let tail = head - 0.45;
  let ss = mix(max(tail, 0.0), min(head, 1.0), s);
  let L = 14.0 + 6.0 * fract(st.w * 7.0); let R = 0.55 + 0.3 * fract(st.w * 13.0); let s0 = 0.45 + 0.15 * fract(st.w * 3.0);
  let q = spath(ss, L, R, s0); let q2 = spath(ss + 0.01, L, R, s0);
  let w3 = vec3f(f.wind.x, 0.0, f.wind.y);
  let side3 = vec3f(-f.wind.y, 0.0, f.wind.x);
  let lat = sin(ss * 4.0 + st.w * 10.0) * 0.6;
  let base = vec3f(st.x, 2.0 + fract(st.w * 5.0) * 2.5, st.y);
  let p = base + w3 * (q.x + age * 4.0) + vec3f(0.0, q.y, 0.0) + side3 * lat;
  let p2 = base + w3 * (q2.x + age * 4.0) + vec3f(0.0, q2.y, 0.0) + side3 * lat;
  let tg = normalize(p2 - p + vec3f(1e-5));
  let sv = normalize(cross(tg, f.cf.xyz));
  let taper = sin(PI * clamp(s, 0.0, 1.0));
  let width = 0.07 * taper + 0.012;
  var o: SOut;
  o.pos = f.vp * vec4f(p + sv * sidev * width, 1.0);
  o.a = select(0.0, 0.85, head > 0.0 && tail < 1.0) * smoothstep(0.0, 0.1, taper);
  return o;
}
@fragment fn fs(v: SOut) -> @location(0) vec4f { return vec4f(vec3f(0.97, 0.99, 1.0) * v.a, v.a); }
`;

export const POST = /* wgsl */`
@group(1) @binding(0) var cTex: texture_2d<f32>;
@group(1) @binding(1) var aTex: texture_2d<f32>;
@group(1) @binding(2) var ls: sampler;
@group(1) @binding(3) var dTex: texture_depth_multisampled_2d;
fn D(p: vec2i) -> f32 { return textureLoad(dTex, clamp(p, vec2i(0), vec2i(f.scr.xy) - 1), 0) * 449.0; }
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
fn A(uv: vec2f) -> vec4f { return textureSampleLevel(aTex, ls, uv, 0.0); }
fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = f.scr.zw; let res = f.scr.xy;
  let s = res.y / 1440.0; // scale effects with resolution
  let fp = fc.xy / s;
  // hand-painted wobble
  let wob = vec2f(vn(fp * 0.018), vn(fp * 0.018 + 7.3)) - 0.5;
  let uv = (fc.xy + wob * 2.2 * s) * px;
  let c0 = textureSampleLevel(cTex, ls, uv, 0.0).rgb;
  let a0 = A(uv);
  // ink lines: depth laplacian (exact MSAA depth) + normal + material discontinuities
  let ip = vec2i(floor(fc.xy + wob * 2.2 * s));
  let ir = max(1, i32(round(1.25 * s)));
  let d0 = D(ip);
  let r = (1.1 + 0.5 * vn(fp * 0.05)) * s;
  var e = 0.0;
  let dsc = 1.0 / (f.cu.w * 12.0);
  for (var k = 0; k < 4; k++) {
    let o = array<vec2i, 4>(vec2i(1, 0), vec2i(0, 1), vec2i(1, 1), vec2i(1, -1))[k];
    let dA = D(ip + o * ir); let dB = D(ip - o * ir);
    let lap = abs(dA + dB - 2.0 * d0) * dsc / (1.0 + abs(dA - dB) * dsc * 0.25);
    let ed = smoothstep(0.35, 0.9, lap);
    let d = vec2f(o) * select(1.0, 0.7071, k > 1) * r * px;
    let aa = A(uv + d); let bb = A(uv - d);
    let isW = step(abs(a0.w - 0.25), 0.02) * step(abs(aa.w - 0.25), 0.02) * step(abs(bb.w - 0.25), 0.02);
    let nd = length(aa.xy - bb.xy) * 2.0;
    let en = smoothstep(0.35, 0.75, nd) * (1.0 - isW);
    let em = smoothstep(0.04, 0.1, abs(aa.w - bb.w));
    e = max(e, max(ed, max(en, em)));
  }
  e *= step(0.01, a0.w + 0.02);
  // watercolor: local mean for edge darkening / pigment pooling
  var m = vec3f(0.0);
  for (var k = 0; k < 6; k++) {
    let an = f32(k) * 1.0472 + 0.5;
    m += textureSampleLevel(cTex, ls, uv + vec2f(cos(an), sin(an)) * 3.5 * s * px, 0.0).rgb;
  }
  m /= 6.0;
  var c = c0;
  let pool = clamp(length(c - m) * 2.2, 0.0, 1.0);
  // paper + pigment density
  let paper = vn(fp * 0.9) * 0.45 + vn(fp * 2.3) * 0.3 + vn(vec2f(fp.x * 0.22, fp.y * 2.6)) * 0.25;
  let gran = vn(fp * 0.45 + vec2f(13.0)) ;
  let turb = fbm(fp * 0.006);
  let dens = 1.0 + 0.34 * (paper - 0.5) + 0.42 * (turb - 0.5) + 0.18 * (gran - 0.5) + 0.7 * pool;
  // darken toward denser pigment (Bousseau-style)
  c = c - (c - c * c) * (dens - 1.0) * 1.4;
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  var g = pow(c, vec3f(1.0 / 2.2));
  // a touch more saturation pop
  let lum = dot(g, vec3f(0.299, 0.587, 0.114));
  g = mix(vec3f(lum), g, 1.12);
  let ink = vec3f(0.13, 0.13, 0.22);
  g = mix(g, ink, e * 0.85);
  // paper tint in highlights + grain
  let paperCol = vec3f(1.0, 0.985, 0.95);
  g *= mix(vec3f(1.0), paperCol, 0.6) * (0.965 + 0.05 * paper);
  // vignette
  let q = fc.xy * px - 0.5;
  g *= 1.0 - 0.22 * dot(q, q);
  // HUD: painted compass with wind arrow + sheet gauge (bottom-left)
  let hc = vec2f(92.0, res.y / s - 92.0);
  let hp = (fp - hc);
  let hr = length(hp);
  let ha = fwidth(hr) * 1.2;
  g *= 1.0 - 0.25 * (1.0 - smoothstep(56.0, 72.0, length(hp - vec2f(3.0, 4.0))));
  let disc = 1.0 - smoothstep(58.0 - ha, 58.0 + ha, hr);
  g = mix(g, vec3f(0.98, 0.95, 0.87), disc * 0.85);
  let ring = 1.0 - smoothstep(1.8 - ha, 1.8 + ha, abs(hr - 58.0));
  g = mix(g, ink, ring * 0.9);
  // sheet gauge arc
  let ang = atan2(hp.x, -hp.y);
  let sheetA = mix(-2.4, 2.4, f.hud.x);
  let arcm = (1.0 - smoothstep(3.0 - ha, 3.0 + ha, abs(hr - 51.0))) * step(-2.4, ang) * step(ang, 2.4);
  g = mix(g, select(vec3f(0.75, 0.72, 0.66), vec3f(0.9, 0.4, 0.15), ang < sheetA), arcm);
  let wa = f.hud.y; let wd = vec2f(sin(wa), -cos(wa));
  let wdn = vec2f(-wd.y, wd.x);
  let ar = sdSeg(hp, -wd * 34.0, wd * 30.0);
  let hd = min(sdSeg(hp, wd * 34.0, wd * 18.0 + wdn * 11.0), sdSeg(hp, wd * 34.0, wd * 18.0 - wdn * 11.0));
  let arw = 1.0 - smoothstep(3.0 - ha, 3.0 + ha, min(ar, hd));
  g = mix(g, vec3f(0.15, 0.45, 0.78), arw);
  let ba = f.hud.z; let bd = vec2f(sin(ba), -cos(ba));
  let bn = 1.0 - smoothstep(2.0 - ha, 2.0 + ha, sdSeg(hp, vec2f(0.0), bd * 24.0));
  let bdot = 1.0 - smoothstep(4.5 - ha, 4.5 + ha, length(hp - bd * 24.0));
  g = mix(g, vec3f(0.85, 0.27, 0.17), max(bn, bdot));
  // dither
  let dn = h21(fc.xy) + h21(fc.xy + 0.37) - 1.0;
  g += dn / 255.0;
  return vec4f(g, 1.0);
}
`;
