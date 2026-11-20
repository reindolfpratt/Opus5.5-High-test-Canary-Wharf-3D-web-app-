// Road network: carriageway ribbons, granite kerbs, raised footways, UK signal crossings, lane splines and a height field.
import * as THREE from 'three';
import { R1, MAIN_ROAD_W, WIA, MARSH, CROSSINGS, KERB_H, FOOTWAY_W, BRIDGES } from '../layout.js';
import { resample, offsetLine, projectS, distToSeg, clamp, circlePoly } from '../util.js';
import { M } from '../materials.js';

// ---------- geometry helpers ----------
// Ribbon along a polyline: u across (0 = left edge, 1 = right edge), v = arc length (m)
function ribbon(pts, closed, width, y = 0.02) {
  const L = offsetLine(pts, closed, width / 2), R = offsetLine(pts, closed, -width / 2);
  const n = pts.length, cnt = closed ? n + 1 : n;
  const pos = [], uv = [], idx = [];
  let s = 0;
  for (let i = 0; i < cnt; i++) {
    const k = i % n;
    if (i > 0) { const p = pts[(i - 1) % n], c = pts[k]; s += Math.hypot(c[0] - p[0], c[1] - p[1]); }
    pos.push(L[k][0], y, L[k][1], R[k][0], y, R[k][1]);
    uv.push(0, s, 1, s);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); fixUp(g); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
// Make sure triangles face up
function fixUp(g) {
  const p = g.attributes.position, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  a.fromBufferAttribute(p, ix[0]); b.fromBufferAttribute(p, ix[1]); c.fromBufferAttribute(p, ix[2]);
  const ny = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); // y of (b-a)x(c-a) is -(this)
  if (-ny < 0) { for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
}

// Sweep a 2D profile [[lateral, y], ...] along a polyline. lateral>0 = left of travel. u = along (m), v = across profile (m)
function sweep(pts, closed, profile) {
  const offs = profile.map(([d]) => offsetLine(pts, closed, d));
  const n = pts.length, cnt = closed ? n + 1 : n, P = profile.length;
  const pos = [], uv = [], idx = [];
  const across = [0]; for (let j = 1; j < P; j++) across.push(across[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  let s = 0;
  for (let i = 0; i < cnt; i++) {
    const k = i % n;
    if (i > 0) { const p = pts[(i - 1) % n], c = pts[k]; s += Math.hypot(c[0] - p[0], c[1] - p[1]); }
    for (let j = 0; j < P; j++) { pos.push(offs[j][k][0], profile[j][1], offs[j][k][1]); uv.push(s, across[j]); }
    if (i > 0) for (let j = 0; j < P - 1; j++) { const a = (i - 1) * P + j, b = i * P + j; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Chaikin corner cutting for smooth closed driving paths
function chaikin(pts, iters = 3) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const o = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = o;
  }
  return p;
}

function arc(cx, cz, r, a0, a1, step = 2) {
  const n = Math.max(4, Math.ceil((Math.abs(a1 - a0) * r) / step)); const o = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return o;
}

// Dumbbell lane loop: eastbound on the north lane, clockwise round the east circle, westbound south lane, clockwise round west circle.
function dumbbellLane(D, lane = 2.25) {
  const a1 = Math.asin(lane / D.r1), a2 = Math.asin(lane / D.r2);
  const pts = [];
  // circle 1 (west end): from a1 (east side, south lane) clockwise to 2PI - a1 (east side, north lane)
  pts.push(...arc(D.x1, D.z, D.r1, a1, Math.PI * 2 - a1));
  // straight eastbound (north lane)
  pts.push([D.x2 - Math.cos(a2) * D.r2, D.z - lane]);
  // circle 2 (east end): from PI + a2 clockwise to 3PI - a2
  pts.push(...arc(D.x2, D.z, D.r2, Math.PI + a2, 3 * Math.PI - a2));
  pts.push([D.x1 + Math.cos(a1) * D.r1, D.z + lane]);
  return resample(chaikin(dedupe(pts), 4), true, 1.0);
}
function dedupe(p) { const o = []; for (const q of p) { const l = o[o.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 0.2) o.push(q); } return o; }

// ---------- network ----------
export function buildRoadData() {
  const r1c = resample(R1, true, 2);
  const roads = [];
  roads.push({ name: 'R1', center: r1c, w: MAIN_ROAD_W, kind: 'main' });
  for (const D of [WIA, MARSH]) {
    const xa = D.x1 + Math.sqrt((D.r1 + D.w / 2) ** 2 - (D.w / 2) ** 2) - 1.0;
    const xb = D.x2 - Math.sqrt((D.r2 + D.w / 2) ** 2 - (D.w / 2) ** 2) + 1.0;
    roads.push({ name: D === WIA ? 'WIA' : 'MARSH', center: resample([[xa, D.z], [xb, D.z]], false, 2), w: D.w, kind: 'minor', D });
    roads.push({ name: (D === WIA ? 'WIA' : 'MARSH') + '_c1', center: resample(circlePoly(D.x1, D.z, D.r1, 96), true, 2), w: D.w, kind: 'ring', ring: { cx: D.x1, cz: D.z, r: D.r1, gapAngle: 0, D } });
    roads.push({ name: (D === WIA ? 'WIA' : 'MARSH') + '_c2', center: resample(circlePoly(D.x2, D.z, D.r2, 48), true, 2), w: D.w, kind: 'ring', ring: { cx: D.x2, cz: D.z, r: D.r2, gapAngle: Math.PI, D } });
  }

  // traffic lanes (closed loops, each a single direction stream)
  const lanes = [];
  const r1fine = resample(R1, true, 1);
  lanes.push({ name: 'R1-cw', line: resample(offsetLine(r1fine.pts, true, 2.25), true, 1), road: 'R1' });
  const rev = r1fine.pts.slice().reverse();
  lanes.push({ name: 'R1-ccw', line: resample(offsetLine(rev, true, 2.25), true, 1), road: 'R1' });
  lanes.push({ name: 'WIA', line: dumbbellLane(WIA), road: 'WIA' });
  lanes.push({ name: 'MARSH', line: dumbbellLane(MARSH), road: 'MARSH' });

  // crossings: position, road direction, stop positions per lane
  const crossings = CROSSINGS.map((c, i) => {
    const road = roads.find((r) => r.name === c.road);
    const s = projectS(road.center, c.x, c.z);
    const p = pointAt(road.center, s), p2 = pointAt(road.center, s + 1);
    const dir = [p2[0] - p[0], p2[1] - p[1]]; const dl = Math.hypot(dir[0], dir[1]); dir[0] /= dl; dir[1] /= dl;
    return { id: i, x: p[0], z: p[1], dir, w: road.w, road: c.road, phase: (i * 7.3) % 30 };
  });
  for (const ln of lanes) {
    ln.stops = [];
    for (const c of crossings) {
      if (c.road !== ln.road) continue;
      // lanes pass a crossing once (R1) — dumbbell lanes pass twice (once each lane); find all passes within 4 m
      const pts = ln.line.pts; let acc = 0; const L = ln.line.length; const hits = [];
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - c.x, pts[i][1] - c.z);
        if (d < 4.2) hits.push({ s: (i / pts.length) * L, d });
      }
      // cluster hits
      hits.sort((a, b) => a.s - b.s);
      const clusters = [];
      for (const h of hits) { const last = clusters[clusters.length - 1]; if (last && h.s - last[last.length - 1].s < 6) last.push(h); else clusters.push([h]); }
      for (const cl of clusters) { const best = cl.reduce((a, b) => (a.d < b.d ? a : b)); ln.stops.push({ s: best.s, crossing: c.id }); }
    }
  }
  // bus stops on the main loop
  lanes[0].busStops = [projectS(lanes[0].line, 100, -97), projectS(lanes[0].line, -120, 107)];
  lanes[1].busStops = [projectS(lanes[1].line, 300, -93), projectS(lanes[1].line, 432, -40)];

  // pedestrian footway centre lines (lateral w/2 + 1.9 m)
  const fwOff = MAIN_ROAD_W / 2 + 1.9;
  const footpaths = [
    { name: 'R1-inner', line: resample(offsetLine(r1fine.pts, true, -fwOff), true, 2) },
    { name: 'R1-outer', line: resample(offsetLine(r1fine.pts, true, fwOff), true, 2) },
  ];
  return { roads, lanes, crossings, footpaths };
}

export function pointAt(line, s) {
  const pts = line.pts, n = pts.length, L = line.length;
  if (line.closed) { s = ((s % L) + L) % L; const f = (s / L) * n; const i = Math.floor(f) % n, t = f - Math.floor(f); const a = pts[i], b = pts[(i + 1) % n]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  s = clamp(s, 0, L); const f = (s / L) * (n - 1); const i = Math.min(n - 2, Math.floor(f)), t = f - i; const a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ---------- meshes ----------
export function buildRoadMeshes(scene, net) {
  const group = new THREE.Group(); group.name = 'roads';
  const fwProfile = (w, side) => {
    const e = w / 2 * side, s = side;
    return {
      kerb: [[e, 0.0], [e, KERB_H], [e + s * 0.28, KERB_H]],
      foot: [[e + s * 0.28, KERB_H], [e + s * FOOTWAY_W, KERB_H], [e + s * (FOOTWAY_W + 0.6), 0.0]],
    };
  };
  for (const r of net.roads) {
    const mat = r.kind === 'main' ? M.roadMain : r.kind === 'ring' ? M.roadRing : M.roadMinor;
    const g = ribbon(r.center.pts, r.center.closed, r.w, r.kind === 'ring' ? 0.018 : 0.022);
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; group.add(mesh);
    if (!r.ring) {
      for (const side of [1, -1]) {
        const p = fwProfile(r.w, side);
        const k = new THREE.Mesh(sweep(r.center.pts, r.center.closed, p.kerb), M.kerb); k.receiveShadow = true; group.add(k);
        const f = new THREE.Mesh(sweep(r.center.pts, r.center.closed, p.foot), M.footway); f.receiveShadow = true; group.add(f);
      }
    } else {
      const { cx, cz, r: R, gapAngle, D } = r.ring;
      // outer footway: arc with a gap where the straight road joins
      const gap = Math.asin(Math.min(0.99, (D.w / 2 + 0.3) / (R + D.w / 2))) + 0.02;
      const a0 = gapAngle + gap, a1 = gapAngle + Math.PI * 2 - gap;
      const arcPts = arc(cx, cz, R, a0, a1, 1.5);
      // travelling with increasing angle (clockwise seen from above) => left of travel = away from the centre
      const p = fwProfile(D.w, 1);
      group.add(meshRS(sweep(arcPts, false, p.kerb), M.kerb));
      group.add(meshRS(sweep(arcPts, false, p.foot.map(([d, y]) => [d, y + 0.003])), M.footway));
      // inner island kerb
      const ring = resample(circlePoly(cx, cz, R, 96), true, 1.5).pts;
      group.add(meshRS(sweep(ring, true, [[-D.w / 2, 0], [-D.w / 2, KERB_H], [-D.w / 2 - 0.3, KERB_H]]), M.kerb));
      if (R < 20) {
        const isl = new THREE.Mesh(new THREE.CircleGeometry(R - D.w / 2 - 0.25, 32).rotateX(-Math.PI / 2), M.paving);
        isl.position.set(cx, KERB_H, cz); isl.receiveShadow = true; group.add(isl);
      }
    }
  }
  // crossing decals + tactile paving
  for (const c of net.crossings) {
    const L = 30, w = c.w, [dx, dz] = c.dir, rx = -dz, rz = dx;
    const pos = [], uv = [];
    for (const [X, m] of [[-w / 2, -L / 2], [w / 2, -L / 2], [-w / 2, L / 2], [w / 2, L / 2]]) {
      pos.push(c.x + rx * X + dx * m, 0.04, c.z + rz * X + dz * m); uv.push((X + w / 2) / w, 1 - (m + L / 2) / L);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 2, 1, 1, 2, 3]); fixUp(g); g.computeVertexNormals();
    const m = new THREE.Mesh(g, w > 10 ? M.crossing : M.crossing9); m.receiveShadow = true; group.add(m);
    for (const side of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2).rotateX(-Math.PI / 2), M.tactile);
      const nx = -c.dir[1], nz = c.dir[0]; // right normal
      t.position.set(c.x + nx * side * (w / 2 + 0.95), KERB_H + 0.006, c.z + nz * side * (w / 2 + 0.95));
      t.rotation.y = -Math.atan2(c.dir[1], c.dir[0]);
      t.receiveShadow = true; group.add(t);
    }
  }
  scene.add(group);
  return group;
}
function meshRS(g, m) { const x = new THREE.Mesh(g, m); x.receiveShadow = true; return x; }

// ---------- height field (footways / islands raised by a kerb) ----------
export class HeightField {
  constructor(net) {
    this.x0 = -650; this.z0 = -115; this.res = 0.5;
    this.nx = Math.ceil((730 - this.x0) / this.res); this.nz = Math.ceil((458 - this.z0) / this.res);
    const H = (this.h = new Uint8Array(this.nx * this.nz));
    const road0 = new Uint8Array(this.nx * this.nz);
    const stamp = (ax, az, bx, bz, w, ringIsland) => {
      const ext = w / 2 + FOOTWAY_W + 0.7;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - ext - this.x0) / this.res)), i1 = Math.min(this.nx - 1, Math.ceil((Math.max(ax, bx) + ext - this.x0) / this.res));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - ext - this.z0) / this.res)), j1 = Math.min(this.nz - 1, Math.ceil((Math.max(az, bz) + ext - this.z0) / this.res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * this.res, z = this.z0 + j * this.res;
        const d = distToSeg(x, z, ax, az, bx, bz);
        const k = j * this.nx + i;
        if (d < w / 2) { road0[k] = 1; continue; }
        const e = d - w / 2;
        let hh = 0;
        if (e < FOOTWAY_W) hh = KERB_H; else if (e < FOOTWAY_W + 0.6) hh = KERB_H * (1 - (e - FOOTWAY_W) / 0.6);
        const q = Math.round(hh * 1000);
        if (q > H[k]) H[k] = q;
      }
    };
    for (const r of net.roads) {
      const p = r.center.pts, n = p.length, segs = r.center.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) { const a = p[i], b = p[(i + 1) % n]; stamp(a[0], a[1], b[0], b[1], r.w); }
      if (r.ring) {
        // raised island inside ring
        const { cx, cz, r: R, D } = r.ring; const ri = R - D.w / 2;
        for (let j = 0; j < this.nz; j++) {
          const z = this.z0 + j * this.res; if (Math.abs(z - cz) > ri) continue;
          for (let i = 0; i < this.nx; i++) { const x = this.x0 + i * this.res; if (Math.abs(x - cx) > ri) continue; if (Math.hypot(x - cx, z - cz) < ri) H[j * this.nx + i] = Math.round(KERB_H * 1000); }
        }
      }
    }
    for (let k = 0; k < H.length; k++) if (road0[k]) H[k] = 0;
  }
  ground(x, z) {
    const fx = (x - this.x0) / this.res, fz = (z - this.z0) / this.res;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return 0;
    const tx = fx - i, tz = fz - j, k = j * this.nx + i, H = this.h;
    const a = H[k], b = H[k + 1], c = H[k + this.nx], d = H[k + this.nx + 1];
    return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) / 1000;
  }
  heightAt(x, z) {
    for (const b of BRIDGES) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b.h;
    return this.ground(x, z);
  }
}
