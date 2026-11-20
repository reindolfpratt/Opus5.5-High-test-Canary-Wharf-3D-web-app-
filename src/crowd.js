// Crowds: instanced humanoids with a procedural walk cycle evaluated on the GPU (hip/knee/shoulder rotations),
// following footway loops, crossing at signals, wandering plazas and quaysides.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLAZAS, BRIDGES, THAMES_EDGE_X, MAIN_ROAD_W, MARSH } from './layout.js';
import { mulberry32, pointInPoly } from './util.js';
import { signalState } from './traffic.js';

// ---------- geometry ----------
function part(g, partId, bone) {
  g = g.toNonIndexed(); const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(partId), 1));
  g.setAttribute('aBone', new THREE.Float32BufferAttribute(new Float32Array(n).fill(bone), 1));
  g.deleteAttribute('uv');
  return g;
}
function humanGeometry() {
  const P = [];
  // torso (jacket), slightly tapered and flattened front-to-back
  P.push(part(new THREE.CylinderGeometry(0.2, 0.16, 0.56, 8, 1).scale(1, 1, 0.62).translate(0, 1.16, 0), 1, 0));
  P.push(part(new THREE.SphereGeometry(0.2, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 0.62).translate(0, 1.44, 0), 1, 0)); // shoulders
  P.push(part(new THREE.BoxGeometry(0.33, 0.2, 0.21).translate(0, 0.9, 0), 2, 0)); // pelvis
  P.push(part(new THREE.BoxGeometry(0.1, 0.26, 0.02).translate(0, 1.3, 0.125), 5, 0)); // shirt front
  P.push(part(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 6, 1, true).translate(0, 1.52, 0), 0, 0)); // neck
  P.push(part(new THREE.SphereGeometry(0.105, 9, 7).scale(0.9, 1.12, 1.0).translate(0, 1.645, 0.0), 0, 0)); // head
  P.push(part(new THREE.SphereGeometry(0.11, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.4).scale(0.92, 1.0, 1.0).rotateX(-0.35).translate(0, 1.665, -0.012), 4, 0)); // hair
  for (const s of [1, -1]) {
    const x = 0.095 * s;
    const L = s > 0 ? 1 : 2, S = s > 0 ? 3 : 4, A = s > 0 ? 5 : 6;
    P.push(part(new THREE.CylinderGeometry(0.088, 0.07, 0.44, 6, 1, true).translate(x, 0.71, 0), 2, L)); // thigh
    P.push(part(new THREE.CylinderGeometry(0.066, 0.05, 0.43, 6, 1, true).translate(x, 0.285, 0), 2, S)); // shin
    P.push(part(new THREE.BoxGeometry(0.1, 0.075, 0.27).translate(x, 0.04, 0.04), 3, S)); // shoe
    P.push(part(new THREE.CylinderGeometry(0.058, 0.045, 0.6, 6, 1, true).translate(0.235 * s, 1.12, 0), 1, A)); // arm (sleeve)
    P.push(part(new THREE.SphereGeometry(0.045, 5, 4).translate(0.235 * s, 0.8, 0), 0, A)); // hand
  }
  return mergeGeometries(P);
}

const ANIM_GLSL = /* glsl */`
attribute float aPart; attribute float aBone;
attribute float aPhase; attribute float aAmp;
attribute vec3 aJacket; attribute vec3 aTrousers; attribute vec3 aSkin; attribute vec3 aHair;
varying vec3 vPartColor;
vec3 pedRotX(vec3 p, vec3 pv, float a){ p -= pv; float c = cos(a), s = sin(a); return vec3(p.x, p.y*c - p.z*s, p.y*s + p.z*c) + pv; }
vec3 pedRotN(vec3 n, float a){ float c = cos(a), s = sin(a); return vec3(n.x, n.y*c - n.z*s, n.y*s + n.z*c); }
void pedAnim(inout vec3 p, inout vec3 n){
  float b = aBone;
  float side = (b == 1.0 || b == 3.0 || b == 5.0) ? 1.0 : -1.0;
  float sw = sin(aPhase) * 0.48 * aAmp;
  if (b >= 1.0 && b <= 4.0) {
    float hx = 0.095 * side;
    float legA = sw * side;
    if (b >= 3.0) {
      float knee = max(0.0, -side * cos(aPhase)) * 0.95 * aAmp + 0.05 * aAmp;
      p = pedRotX(p, vec3(hx, 0.5, 0.0), knee); n = pedRotN(n, knee);
    }
    p = pedRotX(p, vec3(hx, 0.93, 0.0), legA); n = pedRotN(n, legA);
  } else if (b >= 5.0) {
    float armA = -sw * side * 0.75;
    p = pedRotX(p, vec3(0.235 * side, 1.42, 0.0), armA); n = pedRotN(n, armA);
  }
  p.y += (abs(cos(aPhase)) - 0.6) * 0.035 * aAmp;
}
`;

function patchVertex(shader, isDepth) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + ANIM_GLSL);
  if (!isDepth) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 _pedP = position; pedAnim(_pedP, objectNormal);\n')
      .replace('#include <begin_vertex>', 'vec3 transformed = _pedP;\n' +
        'vPartColor = aPart < 0.5 ? aSkin : aPart < 1.5 ? aJacket : aPart < 2.5 ? aTrousers : aPart < 3.5 ? vec3(0.02) : aPart < 4.5 ? aHair : vec3(0.75);\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPartColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPartColor;');
  } else {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 _pedP = position; vec3 _pedN = vec3(0.0, 1.0, 0.0); pedAnim(_pedP, _pedN); vec3 transformed = _pedP; vPartColor = vec3(0.0);');
  }
}

// ---------- palette ----------
const sRGB = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const JACKETS = [[0.09, 0.12, 0.22], [0.13, 0.13, 0.15], [0.05, 0.05, 0.06], [0.33, 0.34, 0.36], [0.55, 0.43, 0.3], [0.3, 0.08, 0.1], [0.24, 0.27, 0.18], [0.62, 0.7, 0.82], [0.85, 0.85, 0.82], [0.18, 0.2, 0.28], [0.42, 0.18, 0.12]];
const TROUSERS = [[0.08, 0.1, 0.18], [0.12, 0.12, 0.13], [0.05, 0.05, 0.05], [0.5, 0.44, 0.32], [0.16, 0.22, 0.38], [0.25, 0.25, 0.27]];
const SKIN = [[0.96, 0.8, 0.68], [0.9, 0.7, 0.56], [0.8, 0.6, 0.45], [0.65, 0.45, 0.32], [0.48, 0.32, 0.22], [0.34, 0.22, 0.15]];
const HAIR = [[0.05, 0.04, 0.035], [0.15, 0.1, 0.06], [0.3, 0.2, 0.12], [0.62, 0.5, 0.3], [0.55, 0.55, 0.55], [0.08, 0.06, 0.05]];

export class Crowd {
  constructor(scene, net, heightField, colliders, q) {
    this.net = net; this.hf = heightField;
    const r = (this.r = mulberry32(909));
    const N = q.peds; this.N = N;
    const geo = humanGeometry();
    const ig = new THREE.BufferGeometry();
    for (const k in geo.attributes) ig.setAttribute(k, geo.attributes[k]);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); phase.setUsage(THREE.DynamicDrawUsage);
    const amp = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); amp.setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('aPhase', phase); ig.setAttribute('aAmp', amp);
    const cols = { aJacket: JACKETS, aTrousers: TROUSERS, aSkin: SKIN, aHair: HAIR };
    for (const k in cols) {
      const a = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const c = sRGB(...cols[k][Math.floor(r() * cols[k].length)]); const j = 0.92 + r() * 0.16; a[i * 3] = c.r * j; a[i * 3 + 1] = c.g * j; a[i * 3 + 2] = c.b * j; }
      ig.setAttribute(k, new THREE.InstancedBufferAttribute(a, 3));
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.0 });
    mat.onBeforeCompile = (s) => patchVertex(s, false);
    mat.customProgramCacheKey = () => 'ped';
    const depth = new THREE.MeshDepthMaterial();
    depth.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n'); patchVertex(s, true); };
    depth.customProgramCacheKey = () => 'peddepth';
    this.mesh = new THREE.InstancedMesh(ig, mat, N);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = q.pedShadows; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.layers.set(1);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.phase = phase; this.amp = amp;
    this.colliders = colliders;
    this.routes = this.buildRoutes();
    this.peds = [];
    for (let i = 0; i < N; i++) {
      const route = this.pickRoute(i);
      const seg = Math.floor(r() * route.pts.length);
      this.peds.push({ route, seg, t: r() * route.lens[seg], speed: 1.15 + r() * 0.45, off: (r() - 0.5) * route.width, ph: r() * 6.28, amp: 1, scale: 0.92 + r() * 0.14, waiting: false, crossed: false });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  blocked(x, z) {
    for (const c of this.colliders) {
      if (c.poly) { if (x > c.bb.x0 - 1 && x < c.bb.x1 + 1 && z > c.bb.z0 - 1 && z < c.bb.z1 + 1) return true; }
      else if (c.circle) { if (Math.hypot(x - c.circle[0], z - c.circle[1]) < c.circle[2] + 1) return true; }
      else if (c.rect) { if (x > c.rect[0] - 0.8 && x < c.rect[1] + 0.8 && z > c.rect[2] - 0.8 && z < c.rect[3] + 0.8) return true; }
    }
    return false;
  }

  buildRoutes() {
    const r = this.r; const R = [];
    const mk = (pts, kind, width, flags = null) => {
      const lens = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.max(0.01, Math.hypot(q[0] - p[0], q[1] - p[1])); });
      R.push({ pts, lens, kind, width, flags: flags || pts.map(() => null) });
    };
    // footway loops (both directions)
    for (const fp of this.net.footpaths) { const p = fp.line.pts.filter((_, i) => i % 2 === 0); mk(p, 'loop', 2.6); mk(p.slice().reverse(), 'loop', 2.6); }
    // crossing shuttles
    for (const c of this.net.crossings) {
      const [dx, dz] = c.dir; const lx = dz, lz = -dx; const o = c.w / 2 + 1.9;
      const PL = [c.x + lx * o, c.z + lz * o], PR = [c.x - lx * o, c.z - lz * o];
      for (let k = 0; k < 2; k++) {
        const L1 = (r() < 0.5 ? -1 : 1) * (20 + r() * 40), L2 = (r() < 0.5 ? -1 : 1) * (20 + r() * 40);
        const QR = [PR[0] + dx * L1, PR[1] + dz * L1], QL = [PL[0] + dx * L2, PL[1] + dz * L2];
        const jitter = (k - 0.5) * 1.2;
        const A = [PL[0] + dx * jitter, PL[1] + dz * jitter], B = [PR[0] + dx * jitter, PR[1] + dz * jitter];
        mk([A, B, QR, B, A, QL], 'cross', 1.2, [c.id, null, null, c.id, null, null]);
      }
    }
    // plaza wanderers
    for (const pl of PLAZAS) for (let k = 0; k < 6; k++) {
      const pts = []; let tries = 0;
      while (pts.length < 5 && tries++ < 200) {
        const x = pl.x0 + r() * (pl.x1 - pl.x0), z = pl.z0 + r() * (pl.z1 - pl.z0);
        if (this.blocked(x, z)) continue;
        const prev = pts[pts.length - 1];
        if (prev) { let ok = true; for (let t = 0.2; t < 1; t += 0.2) if (this.blocked(prev[0] + (x - prev[0]) * t, prev[1] + (z - prev[1]) * t)) ok = false; if (!ok) continue; }
        pts.push([x, z]);
      }
      if (pts.length >= 3) mk(pts, 'plaza', 1.5);
    }
    // quaysides and Thames path (there and back)
    const line = (x1, z1, x2, z2, w = 3) => mk([[x1, z1], [x2, z2]], 'quay', w);
    for (let k = 0; k < 6; k++) { const a = -470 + r() * 500, b = a + 150 + r() * 400; line(a, -143 + r() * 2, Math.min(660, b), -143 + r() * 2, 4); }
    for (let k = 0; k < 4; k++) { const a = -330 + r() * 300, b = a + 120 + r() * 300; line(a, 179 + r() * 2, Math.min(320, b), 179 + r() * 2, 3); }
    for (let k = 0; k < 4; k++) { const a = -300 + r() * 300, b = a + 150 + r() * 300; line(a, 262 + r() * 2, Math.min(320, b), 262 + r() * 2, 3); }
    for (let k = 0; k < 3; k++) { const a = -500 + r() * 400, b = a + 150 + r() * 400; line(a, MARSH.z - 7, Math.min(660, b), MARSH.z - 7, 2); line(a, MARSH.z + 7, Math.min(660, b), MARSH.z + 7, 2); }
    for (let k = 0; k < 3; k++) { const a = -600 + r() * 400; line(THAMES_EDGE_X + 4, a, THAMES_EDGE_X + 4, a + 300 + r() * 300, 3); }
    // footbridges
    for (const b of BRIDGES) { const x = (b.x0 + b.x1) / 2; mk([[x, b.z0 - 6], [x, b.z1 + 6]], 'quay', (b.x1 - b.x0) - 1.6); }
    return R;
  }

  pickRoute(i) {
    const r = this.r(); const R = this.routes;
    const byKind = (k) => R.filter((x) => x.kind === k);
    const kinds = r < 0.34 ? 'loop' : r < 0.52 ? 'cross' : r < 0.78 ? 'plaza' : 'quay';
    const list = byKind(kinds); return list[Math.floor(this.r() * list.length)];
  }

  update(dt, T, camPos) {
    const crossings = this.net.crossings;
    const m = this._m, q = this._q, p = this._p, s = this._s;
    const ph = this.phase.array, am = this.amp.array;
    for (let i = 0; i < this.N; i++) {
      const P = this.peds[i]; const R = P.route; const n = R.pts.length;
      let d = P.speed * dt; let walking = true;
      let guard = 0;
      while (d > 0 && guard++ < 8) {
        const flag = R.flags[P.seg];
        if (flag !== null && P.t <= 0.001 && !P.crossed) {
          const st = signalState(crossings[flag], T);
          if (st.ped !== 'walk') { walking = false; break; }
          P.crossed = true;
        }
        const L = R.lens[P.seg]; const rem = L - P.t;
        if (d < rem) { P.t += d; d = 0; }
        else { d -= rem; P.t = 0; P.seg = (P.seg + 1) % n; P.crossed = false; }
      }
      // smooth start/stop
      P.amp += ((walking ? 1 : 0) - P.amp) * Math.min(1, dt * 4);
      if (walking) P.ph += (dt * P.speed / 1.42) * Math.PI * 2;
      const a = R.pts[P.seg], b = R.pts[(P.seg + 1) % n];
      const L = R.lens[P.seg]; const t = P.t / L;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const x = a[0] + (b[0] - a[0]) * t + dz * P.off, z = a[1] + (b[1] - a[1]) * t - dx * P.off;
      const y = this.hf.heightAt(x, z);
      // waiting pedestrians face the road; walkers face their direction (slightly smoothed)
      const yaw = Math.atan2(dx, dz);
      // distance culling (cheap LOD): pedestrians beyond 450 m collapse to zero size
      const far = (x - camPos.x) ** 2 + (z - camPos.z) ** 2 > 450 * 450 && camPos.y < 60;
      p.set(x, y, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw); s.setScalar(far ? 0 : P.scale);
      m.compose(p, q, s); this.mesh.setMatrixAt(i, m);
      ph[i] = P.ph; am[i] = P.amp;
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.phase.needsUpdate = true; this.amp.needsUpdate = true;
  }
}
