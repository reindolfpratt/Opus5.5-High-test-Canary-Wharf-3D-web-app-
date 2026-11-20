// Traffic: Intelligent Driver Model car-following on closed lane loops (UK left-hand running), signal-controlled
// pedestrian crossings, bus stops, curvature speed limits. Collision-free by construction (single-file lanes + IDM).
import * as THREE from 'three';
import { vehicleTypes, CAR_COLOURS } from './vehicles.js';
import { pointAt } from './world/roads.js';
import { mulberry32 } from './util.js';
import { makeHeadlightPool } from './textures.js';

export const SIGNAL_CYCLE = 34;
// per crossing local time -> car signal & pedestrian signal
export function signalState(c, T) {
  const t = (T + c.phase) % SIGNAL_CYCLE;
  if (t < 21) return { car: 'G', ped: 'stop', t };
  if (t < 24) return { car: 'A', ped: 'stop', t };
  if (t < 25) return { car: 'R', ped: 'stop', t };
  if (t < 31) return { car: 'R', ped: 'walk', t };
  if (t < 33) return { car: 'R', ped: 'flash', t };
  return { car: 'RA', ped: 'stop', t };
}

function laneSpeedLimits(line) {
  const p = line.pts, n = p.length; const vmax = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = p[(i - 3 + n) % n], b = p[i], c = p[(i + 3) % n];
    const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
    let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = Math.abs(dh) / Math.max(ds, 1e-3);
    vmax[i] = Math.sqrt(2.2 / Math.max(k, 1e-4));
  }
  // anticipate curves (comfortable deceleration 1.5 m/s^2)
  const look = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 1e9; for (let j = 0; j < 40; j++) { const v = Math.sqrt(vmax[(i + j) % n] ** 2 + 2 * 1.5 * j); if (v < m) m = v; } look[i] = m; }
  return look;
}

export class Traffic {
  constructor(scene, net, q) {
    this.net = net; this.T = 0;
    const types = vehicleTypes(); this.types = types; this.mats = types.mats;
    const r = mulberry32(555);
    const plan = {
      'R1-cw': { n: Math.round(16 * q.traffic), mix: ['bus', 'police', 'bus'] },
      'R1-ccw': { n: Math.round(16 * q.traffic), mix: ['bus', 'bus'] },
      'WIA': { n: Math.round(7 * q.traffic), mix: [] },
      'MARSH': { n: Math.round(18 * q.traffic), mix: ['bus'] },
    };
    this.vehicles = [];
    for (const ln of net.lanes) {
      ln.vlim = laneSpeedLimits(ln.line);
      const P = plan[ln.name]; const n = Math.max(2, P.n);
      const L = ln.line.length; const spacing = L / n;
      for (let i = 0; i < n; i++) {
        let type = P.mix[i] || (r() < 0.42 ? 'cab' : r() < 0.7 ? 'car' : r() < 0.6 ? 'suv' : 'van');
        if (ln.name === 'WIA' && type !== 'cab' && r() < 0.6) type = 'cab';
        const T = types[type];
        this.vehicles.push({ lane: ln, type, s: i * spacing + r() * spacing * 0.3, v: 6 + r() * 3, a: 0, len: T.len, v0: type === 'bus' ? 8.0 : 9 + r() * 2.2, dwell: 0, served: -1, idx: 0 });
      }
    }
    // instanced meshes per type
    this.meshes = {};
    const counts = {}; for (const v of this.vehicles) { v.idx = counts[v.type] = (counts[v.type] || 0); counts[v.type]++; }
    const group = new THREE.Group(); group.name = 'traffic';
    const mk = (geo, mat, n, cast = true) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = false; m.layers.set(1); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); return m; };
    for (const t in counts) {
      const T = types[t]; const n = counts[t];
      const paint = mk(T.paint, T.paintMat || this.mats.paint, n);
      if (!T.paintMat) for (let i = 0; i < n; i++) paint.setColorAt(i, new THREE.Color(t === 'cab' ? (r() < 0.88 ? 0x0a0a0b : 0x24324a) : t === 'police' ? 0xf2f3f5 : t === 'van' ? (r() < 0.7 ? 0xf0f0f0 : 0x9aa0a6) : CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]));
      const rest = mk(T.rest, T.restMats, n);
      const heads = mk(T.heads, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), n, false);
      const tails = mk(T.tails, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), n, false);
      heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      tails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.meshes[t] = { paint, rest, heads, tails };
    }
    // police beacons
    this.beacon = mk(new THREE.BoxGeometry(0.28, 0.09, 0.22), new THREE.MeshBasicMaterial({ color: 0xffffff }), 2 * (counts.police || 0), false);
    this.beacon.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.beacon.count * 3), 3);
    // headlight pools on the road (night)
    this.poolMat = new THREE.MeshBasicMaterial({ map: makeHeadlightPool(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.pools = mk(new THREE.PlaneGeometry(5, 16).rotateX(-Math.PI / 2).translate(0, 0, 8), this.poolMat, this.vehicles.length, false);
    this.pools.receiveShadow = false; this.pools.renderOrder = 2;
    scene.add(group); this.group = group;
    this.night = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
  }

  setNight(n) { this.night = n; this.poolMat.opacity = n >= 1 ? 0.55 : n > 0 ? 0.15 : 0; }

  update(dt) {
    this.T += dt;
    const steps = Math.ceil(dt / 0.034); const h = dt / steps;
    for (let k = 0; k < steps; k++) this.step(h);
    this.writeInstances();
  }

  step(dt) {
    const byLane = new Map();
    for (const v of this.vehicles) { if (!byLane.has(v.lane)) byLane.set(v.lane, []); byLane.get(v.lane).push(v); }
    const crossings = this.net.crossings;
    for (const [ln, list] of byLane) {
      const L = ln.line.length;
      for (const v of list) v.s = ((v.s % L) + L) % L;
      list.sort((a, b) => a.s - b.s);
      for (let i = 0; i < list.length; i++) {
        const v = list[i], lead = list[(i + 1) % list.length];
        let gap = 1e9, vLead = 0;
        if (lead !== v) { gap = ((lead.s - lead.len / 2) - (v.s + v.len / 2) + L) % L; vLead = lead.v; }
        const front = v.s + v.len / 2;
        // red signals ahead
        for (const st of ln.stops) {
          const sig = signalState(crossings[st.crossing], this.T);
          if (sig.car === 'G') continue;
          const d = ((st.s - 4.6) - front + L) % L;
          if (d > 90 || d > L - 12) continue;
          if (sig.car === 'A' && d < (v.v * v.v) / (2 * 3.0)) continue; // too close to stop safely on amber
          if (d < gap) { gap = d; vLead = 0; }
        }
        // bus stops
        if (v.type === 'bus' && ln.busStops) {
          ln.busStops.forEach((bs, j) => {
            if (v.served === j) return;
            const d = ((bs - 0.5) - front + L) % L;
            if (d < 60 && d < gap) { gap = Math.max(0.01, d); vLead = 0; if (d < 1.2 && v.v < 0.4) { v.dwell += dt; if (v.dwell > 9) { v.served = j; v.dwell = 0; } } }
          });
        }
        // IDM
        const idx = Math.floor((v.s / L) * ln.vlim.length) % ln.vlim.length;
        const v0 = Math.max(2.5, Math.min(v.v0, ln.vlim[idx]));
        const A = v.type === 'bus' ? 0.9 : 1.5, B = 2.6, s0 = 2.2, T = 1.25;
        const sStar = s0 + Math.max(0, v.v * T + (v.v * (v.v - vLead)) / (2 * Math.sqrt(A * B)));
        let acc = A * (1 - Math.pow(v.v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
        acc = Math.max(-7, acc);
        v.a = acc;
        v.v = Math.max(0, v.v + acc * dt);
        if (gap < 0.4) v.v = 0;
        v.s += v.v * dt;
      }
    }
  }

  writeInstances() {
    const m = this._m, q = this._q, p = this._p, s = this._s, c = this._c;
    const night = this.night;
    let bi = 0;
    const flash = Math.floor(this.T * 6) % 2;
    this.vehicles.forEach((v, vi) => {
      const ln = v.lane.line;
      const f = pointAt(ln, v.s + v.len * 0.32), b = pointAt(ln, v.s - v.len * 0.32);
      const yaw = Math.atan2(f[0] - b[0], f[1] - b[1]);
      p.set((f[0] + b[0]) / 2, 0.025, (f[1] + b[1]) / 2); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      m.compose(p, q, s);
      const M = this.meshes[v.type];
      M.paint.setMatrixAt(v.idx, m); M.rest.setMatrixAt(v.idx, m); M.heads.setMatrixAt(v.idx, m); M.tails.setMatrixAt(v.idx, m);
      const hk = night >= 1 ? 14 : night > 0 ? 6 : 1.8;
      M.heads.setColorAt(v.idx, c.setRGB(hk, hk * 0.96, hk * 0.88));
      const braking = v.a < -0.8 || v.v < 0.2;
      const tk = braking ? (night ? 9 : 5) : night ? 2.6 : 0.5;
      M.tails.setColorAt(v.idx, c.setRGB(tk, tk * 0.04, tk * 0.03));
      // headlight pool
      p.y = 0.06; m.compose(p, q, s); this.pools.setMatrixAt(vi, m);
      if (v.type === 'police') {
        const T = this.types.police;
        for (const sx of [-0.35, 0.35]) {
          const lp = new THREE.Vector3(T.beacon[0] + sx, T.beacon[1], T.beacon[2]).applyQuaternion(q).add(new THREE.Vector3(p.x, 0.025, p.z));
          m.compose(lp, q, s); this.beacon.setMatrixAt(bi, m);
          const on = (sx < 0) === (flash === 0);
          this.beacon.setColorAt(bi, c.setRGB(on ? 0.2 : 0.01, on ? 0.5 : 0.01, on ? 14 : 0.05)); bi++;
        }
      }
    });
    for (const t in this.meshes) { const M = this.meshes[t]; for (const k of ['paint', 'rest', 'heads', 'tails']) M[k].instanceMatrix.needsUpdate = true; M.heads.instanceColor.needsUpdate = true; M.tails.instanceColor.needsUpdate = true; }
    this.pools.instanceMatrix.needsUpdate = true; this.beacon.instanceMatrix.needsUpdate = true; if (this.beacon.instanceColor) this.beacon.instanceColor.needsUpdate = true;
  }
}
