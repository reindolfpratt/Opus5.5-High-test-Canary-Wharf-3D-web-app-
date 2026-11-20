// Small geometry / math helpers. Coordinates: x = east, z = south, y = up. 1 unit = 1 metre.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function rectPoly(cx, cz, w, d) {
  const hw = w / 2, hd = d / 2;
  // counter-clockwise when viewed from above with x right / z down (i.e. clockwise in maths coords) — winding is normalised later
  return [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]];
}

export function circlePoly(cx, cz, r, n = 32) {
  const p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return p;
}

// Square with notched (re-entrant) corners, like One Canada Square
export function notchedSquare(cx, cz, w, notch) {
  const h = w / 2, n = notch;
  return [
    [cx - h + n, cz - h], [cx + h - n, cz - h], [cx + h - n, cz - h + n], [cx + h, cz - h + n],
    [cx + h, cz + h - n], [cx + h - n, cz + h - n], [cx + h - n, cz + h], [cx - h + n, cz + h],
    [cx - h + n, cz + h - n], [cx - h, cz + h - n], [cx - h, cz - h + n], [cx - h + n, cz - h + n],
  ];
}

export function chamferRect(cx, cz, w, d, c) {
  const hw = w / 2, hd = d / 2;
  return [
    [cx - hw + c, cz - hd], [cx + hw - c, cz - hd], [cx + hw, cz - hd + c], [cx + hw, cz + hd - c],
    [cx + hw - c, cz + hd], [cx - hw + c, cz + hd], [cx - hw, cz + hd - c], [cx - hw, cz - hd + c],
  ];
}

export function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
}

// Ensure a consistent winding: positive signed area in (x,z) space.
export function normalizeWinding(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }

export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return [ax + dx * t, az + dz * t, t];
}

export function distToSeg(px, pz, ax, az, bx, bz) {
  const [cx, cz] = closestOnSeg(px, pz, ax, az, bx, bz);
  return Math.hypot(px - cx, pz - cz);
}

// Offset polygon edges by d (positive = inward for positive-area winding). Miter joins.
export function offsetPoly(p, d) {
  p = normalizeWinding(p);
  const n = p.length, out = [];
  // with positive area in (x,z) the interior is on the left of each edge when walking (x right, z "up" in maths terms)
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % n];
    const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
    // left normal in maths coords (x, z) -> (-dz, dx)
    const nx = -dz / l, nz = dx / l;
    lines.push([x1 + nx * d, z1 + nz * d, dx, dz]);
  }
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n], b = lines[i];
    const den = a[2] * b[3] - a[3] * b[2];
    if (Math.abs(den) < 1e-9) { out.push([b[0], b[1]]); continue; }
    const t = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / den;
    out.push([a[0] + a[2] * t, a[1] + a[3] * t]);
  }
  return out;
}

// Closed rounded polygon from corner points (each corner filleted with radius r)
export function roundedLoop(corners, r, seg = 10) {
  const out = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p0 = corners[(i - 1 + n) % n], p1 = corners[i], p2 = corners[(i + 1) % n];
    const d1x = p0[0] - p1[0], d1z = p0[1] - p1[1], l1 = Math.hypot(d1x, d1z);
    const d2x = p2[0] - p1[0], d2z = p2[1] - p1[1], l2 = Math.hypot(d2x, d2z);
    const u1 = [d1x / l1, d1z / l1], u2 = [d2x / l2, d2z / l2];
    const cosA = clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1);
    const ang = Math.acos(cosA);
    const t = r / Math.tan(ang / 2);
    const a = [p1[0] + u1[0] * t, p1[1] + u1[1] * t];
    const b = [p1[0] + u2[0] * t, p1[1] + u2[1] * t];
    // quadratic-ish arc via proper circle centre
    const bis = [u1[0] + u2[0], u1[1] + u2[1]]; const bl = Math.hypot(bis[0], bis[1]);
    const cd = r / Math.sin(ang / 2);
    const c = [p1[0] + (bis[0] / bl) * cd, p1[1] + (bis[1] / bl) * cd];
    let a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) { const aa = a0 + (da * k) / seg; out.push([c[0] + Math.cos(aa) * r, c[1] + Math.sin(aa) * r]); }
  }
  return out;
}

// Resample a polyline at a fixed spacing. Returns {pts, cum, length}
export function resample(pts, closed, step = 1) {
  const src = closed ? pts.concat([pts[0]]) : pts;
  const cum = [0];
  for (let i = 1; i < src.length; i++) cum.push(cum[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.round(L / step));
  const out = [];
  let j = 0;
  const cnt = closed ? n : n + 1;
  for (let i = 0; i < cnt; i++) {
    const s = (i / n) * L;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([lerp(src[j][0], src[j + 1][0], t), lerp(src[j][1], src[j + 1][1], t)]);
  }
  return { pts: out, length: L, closed };
}

// Offset a polyline sideways. side>0 = to the LEFT of the direction of travel (x right, z down => left of east is north (-z)).
export function offsetLine(pts, closed, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // left of (dx,dz) with z pointing south: (dz, -dx)
    out.push([pts[i][0] + dz * d, pts[i][1] - dx * d]);
  }
  return out;
}

export function polyLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}

// Project a point onto a resampled closed/open polyline -> arc length s
export function projectS(line, x, z) {
  const { pts } = line; let best = 1e18, bs = 0, acc = 0;
  const n = pts.length, segs = line.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const [cx, cz, t] = closestOnSeg(x, z, a[0], a[1], b[0], b[1]);
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < best) { best = d; bs = acc + t * sl; }
    acc += sl;
  }
  return bs;
}
