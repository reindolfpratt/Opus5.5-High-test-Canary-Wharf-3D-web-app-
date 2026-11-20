// Street furniture & vegetation — all instanced.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARKS, PLAZAS, BRIDGES, DOCKS, THAMES_EDGE_X, MAIN_ROAD_W, KERB_H, WATER_Y } from '../layout.js';
import { mulberry32, pointInPoly, offsetLine, resample } from '../util.js';
import { M, registerEmissive } from '../materials.js';
import { makeRadial, makeSignText } from '../textures.js';
import { pointAt } from './roads.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function mat4(x, y, z, ry = 0, s = 1, sy = s) { _p.set(x, y, z); _q.setFromEuler(_e.set(0, ry, 0)); _s.set(s, sy, s); return new THREE.Matrix4().compose(_p, _q, _s); }

export function instanced(geo, mat, list, { cast = true, recv = true, layer = 1, depthMat = null } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((m, i) => im.setMatrixAt(i, m)); im.count = list.length;
  im.castShadow = cast; im.receiveShadow = recv; if (depthMat) im.customDepthMaterial = depthMat;
  im.computeBoundingSphere();
  if (layer === 1) { im.layers.set(1); }
  return im;
}

// --------- trees: trunk + branches + leaf cards with radial normals (soft canopy shading) ---------
function treeGeometries(seed) {
  const r = mulberry32(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, 4.4, 8, 1).translate(0, 2.2, 0); parts.push(trunk);
  for (let i = 0; i < 6; i++) {
    const L = 2.6 + r() * 1.8; const b = new THREE.CylinderGeometry(0.06, 0.12, L, 5).translate(0, L / 2, 0);
    b.rotateZ(0.5 + r() * 0.5); b.rotateY(r() * Math.PI * 2); b.translate(0, 3.6 + r() * 1.0, 0); parts.push(b);
  }
  const wood = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const cards = []; const C = new THREE.Vector3(0, 7.0, 0);
  const n = 110;
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3((r() - 0.5) * 2, (r() - 0.5) * 2, (r() - 0.5) * 2); if (p.length() > 1) p.normalize();
    p.multiply(new THREE.Vector3(4.3, 3.4, 4.3)).add(C);
    const sz = 2.0 + r() * 1.4; const g = new THREE.PlaneGeometry(sz, sz);
    g.rotateX((r() - 0.5) * Math.PI); g.rotateY(r() * Math.PI * 2); g.rotateZ((r() - 0.5) * 0.8); g.translate(p.x, p.y, p.z);
    // radial normals from canopy centre
    const pos = g.attributes.position, nr = g.attributes.normal;
    for (let k = 0; k < pos.count; k++) { const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(C).normalize(); v.y = v.y * 0.7 + 0.3; v.normalize(); nr.setXYZ(k, v.x, v.y, v.z); }
    cards.push(g);
  }
  return { wood, leaves: mergeGeometries(cards) };
}

export function buildFurniture(scene, q, net, buildingColliders) {
  const group = new THREE.Group(); group.name = 'furniture';
  const r = mulberry32(31);
  const colliders = [];
  const nearCrossing = (x, z, d) => net.crossings.some((c) => Math.hypot(c.x - x, c.z - z) < d);
  const inBuilding = (x, z, pad = 1.5) => buildingColliders.some((b) => b.poly ? (x > b.bb.x0 - pad && x < b.bb.x1 + pad && z > b.bb.z0 - pad && z < b.bb.z1 + pad) : Math.hypot(x - b.circle[0], z - b.circle[1]) < b.circle[2] + pad);

  // ---- tree placements ----
  const trees = [];
  const addTree = (x, z, y = 0, s = 0.8 + r() * 0.5) => { if (inBuilding(x, z, 2.5)) return; trees.push(mat4(x, y, z, r() * Math.PI * 2, s, s * (0.9 + r() * 0.25))); };
  for (const p of PARKS) {
    const xs = p.poly.map((v) => v[0]), zs = p.poly.map((v) => v[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    let placed = 0, tries = 0;
    const pts = [];
    while (placed < p.trees * q.treeDensity && tries++ < 3000) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!pointInPoly(x, z, p.poly)) continue;
      if (p.kind === 'lawn') { // ring of trees around the lawn edge, keep the centre open
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const e = Math.max(Math.abs(x - cx) / ((x1 - x0) / 2), Math.abs(z - cz) / ((z1 - z0) / 2)); if (e < 0.72) continue;
      }
      if (pts.some(([a, b]) => Math.hypot(a - x, b - z) < 6)) continue;
      pts.push([x, z]); addTree(x, z, p.name === 'Westferry Circus' ? KERB_H : 0); placed++;
    }
  }
  // street trees on the estate loop footways
  for (const fp of net.footpaths) {
    const L = fp.line.length;
    for (let s = 5; s < L; s += 17) {
      const [x, z] = pointAt(fp.line, s); if (nearCrossing(x, z, 9)) continue;
      // push towards back of footway
      addTree(x, z, KERB_H, 0.7 + r() * 0.3);
    }
  }
  // Cabot Square perimeter + quaysides
  for (const pl of PLAZAS.filter((p) => p.name === 'Cabot Square')) for (let x = pl.x0 + 4; x <= pl.x1 - 4; x += 10) { addTree(x, pl.z0 + 3); addTree(x, pl.z1 - 3); }
  for (let x = -480; x < 680; x += 16) { addTree(x + r() * 3, -144 + (r() - 0.5)); }
  for (let x = -330; x < 320; x += 18) { addTree(x + r() * 3, 177 + (r() - 0.5)); }
  for (let z = -640; z < 640; z += 14) { if (Math.abs(z) < 70) continue; addTree(THAMES_EDGE_X + 6 + r(), z + r() * 3); }
  const tg = [treeGeometries(1), treeGeometries(2)];
  const half = Math.ceil(trees.length / 2);
  [trees.slice(0, half), trees.slice(half)].forEach((list, i) => {
    group.add(instanced(tg[i].wood, M.bark, list, { layer: 0 }));
    group.add(instanced(tg[i].leaves, M.leaves, list, { layer: 0, depthMat: M.leavesDepth }));
  });

  // ---- street lamps along roads ----
  const lampPos = [];
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, 8, 8).translate(0, 4, 0),
    new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(0, 7.95, 0.65),
    new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8).translate(0, 0.25, 0),
  ].map((g) => g.toNonIndexed()));
  const headGeo = new THREE.BoxGeometry(0.34, 0.12, 0.7).translate(0, 7.9, 1.3);
  const lampM = []; const poolM = [];
  const addLamp = (x, z, y, ry) => { lampM.push(mat4(x, y, z, ry)); const fx = x + Math.sin(ry) * 1.3, fz = z + Math.cos(ry) * 1.3; lampPos.push([fx, 7.8 + y, fz]); poolM.push(mat4(fx, 0.06 + y * 0.0 + 0.0, fz, 0, 1)); colliders.push({ circle: [x, z, 0.25] }); };
  for (const road of net.roads) {
    if (road.ring) continue;
    const c = road.center; const L = c.length;
    for (const side of [1, -1]) {
      const edge = { pts: offsetLine(c.pts, c.closed, side * (road.w / 2 + 0.55)), closed: c.closed, length: L };
      for (let s = side > 0 ? 6 : 21; s < L; s += 30) {
        const [x, z] = pointAt(edge, s); const [x2, z2] = pointAt(edge, s + 1);
        if (nearCrossing(x, z, 6)) continue;
        // arm points towards road centre: road dir rotated
        const dx = x2 - x, dz = z2 - z; const ry = Math.atan2(dx, dz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        addLamp(x, z, KERB_H, ry);
      }
    }
  }
  // plaza / quay lamps (shorter, but share mesh for simplicity)
  for (let x = -470; x < 680; x += 36) addLamp(x, -137.5, 0, Math.PI);
  for (let x = -330; x < 320; x += 36) addLamp(x, 179, 0, 0);
  for (let z = -620; z < 620; z += 34) addLamp(THAMES_EDGE_X + 2.5, z, 0, -Math.PI / 2);
  group.add(instanced(lampGeo, M.darkMetal, lampM));
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe4c4, emissiveIntensity: 0, roughness: 0.4 });
  registerEmissive(headMat, 0, 3, 12);
  group.add(instanced(headGeo, headMat, lampM, { cast: false }));
  // ground light pools (additive decals, night only)
  const poolMat = new THREE.MeshBasicMaterial({ map: makeRadial([1.0, 0.82, 0.62]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const pools = instanced(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), poolMat, poolM.map((m) => { const p = new THREE.Vector3().setFromMatrixPosition(m); return mat4(p.x, 0.07, p.z); }), { cast: false, recv: false });
  pools.renderOrder = 2; group.add(pools);

  // ---- traffic & pedestrian signals ----
  const sigPole = [], sigHeads = [], lamps = []; // lamps: {x,y,z, crossing, kind: 'R','A','G','man','wait'}
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8).translate(0, 1.7, 0);
  const headGeoS = new THREE.BoxGeometry(0.32, 0.95, 0.24).translate(0, 2.95, 0);
  for (const c of net.crossings) {
    const [dx, dz] = c.dir, rx = -dz, rz = dx;
    // 4 poles: each approach has a primary on its nearside (left) before the crossing, and a secondary across
    const cfg = [[-1, -1], [1, 1], [1, -1], [-1, 1]]; // [lateral sign (right=+), along sign]
    cfg.forEach(([ls, as], k) => {
      const x = c.x + rx * ls * (c.w / 2 + 0.6) + dx * as * 2.4, z = c.z + rz * ls * (c.w / 2 + 0.6) + dz * as * 2.4;
      sigPole.push(mat4(x, KERB_H, z));
      colliders.push({ circle: [x, z, 0.15] });
      // primary faces approaching traffic: traffic on left (ls<0) travels +dir and approaches from -along
      const facing = ls < 0 ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
      sigHeads.push(mat4(x, KERB_H, z, facing));
      const fx = Math.sin(facing) * 0.13, fz = Math.cos(facing) * 0.13;
      for (const [kind, h] of [['R', 3.27], ['A', 2.97], ['G', 2.67]]) lamps.push({ x: x + fx, y: KERB_H + h, z: z + fz, c: c.id, kind, ry: facing });
      // pedestrian signal (red/green man) facing across the road
      const pf = Math.atan2(rx * -ls, rz * -ls);
      lamps.push({ x: x + Math.sin(pf) * 0.1, y: KERB_H + 2.25, z: z + Math.cos(pf) * 0.1, c: c.id, kind: 'man', ry: pf });
      lamps.push({ x: x + Math.sin(pf) * 0.1, y: KERB_H + 2.05, z: z + Math.cos(pf) * 0.1, c: c.id, kind: 'stop', ry: pf });
      sigHeads.push(new THREE.Matrix4().compose(new THREE.Vector3(x, KERB_H - 0.75, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pf, 0)), new THREE.Vector3(0.7, 0.45, 0.7)));
    });
  }
  group.add(instanced(poleGeo, M.darkMetal, sigPole));
  group.add(instanced(headGeoS, M.blackPaint, sigHeads));
  const lampMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), lamps.length);
  lamps.forEach((l, i) => lampMesh.setMatrixAt(i, mat4(l.x, l.y, l.z, l.ry))); lampMesh.layers.set(1);
  lampMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lamps.length * 3), 3);
  group.add(lampMesh);

  // ---- bollards (at crossings & building frontages) ----
  const boll = [];
  for (const c of net.crossings) {
    const [dx, dz] = c.dir, rx = -dz, rz = dx;
    for (const ls of [-1, 1]) for (const along of [-6, -4.5, -3, 3, 4.5, 6]) boll.push([c.x + rx * ls * (c.w / 2 + 0.45) + dx * along, c.z + rz * ls * (c.w / 2 + 0.45) + dz * along, KERB_H]);
  }
  for (let x = -22; x <= 22; x += 2.2) { boll.push([x, -30, 0], [x, 30, 0]); }
  for (let z = -22; z <= 22; z += 2.2) boll.push([30, z, 0]);
  const bollGeo = mergeGeometries([new THREE.CylinderGeometry(0.1, 0.1, 0.9, 10).translate(0, 0.45, 0), new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.9, 0)].map((g) => g.toNonIndexed()));
  group.add(instanced(bollGeo, M.steel, boll.map(([x, z, y]) => mat4(x, y, z))));

  // ---- benches, bins, planters ----
  const benchGeo = mergeGeometries([
    ...[0, 1, 2, 3].map((i) => new THREE.BoxGeometry(1.8, 0.04, 0.09).translate(0, 0.45, -0.2 + i * 0.13)),
    new THREE.BoxGeometry(1.8, 0.35, 0.04).translate(0, 0.72, -0.28),
    new THREE.BoxGeometry(0.06, 0.45, 0.5).translate(-0.8, 0.22, 0), new THREE.BoxGeometry(0.06, 0.45, 0.5).translate(0.8, 0.22, 0),
  ].map((g) => g.toNonIndexed()));
  const benches = [], bins = [];
  for (let x = -460; x < 660; x += 28) { benches.push(mat4(x + 7, 0, -141.5, Math.PI)); }
  for (let x = -320; x < 320; x += 30) benches.push(mat4(x + 9, 0, 182.5, 0));
  for (const pl of PLAZAS) for (let i = 0; i < 8; i++) { const x = pl.x0 + 6 + r() * (pl.x1 - pl.x0 - 12), z = pl.z0 + 6 + r() * (pl.z1 - pl.z0 - 12); if (!inBuilding(x, z, 2)) benches.push(mat4(x, 0, z, Math.floor(r() * 4) * Math.PI / 2)); }
  for (let z = -600; z < 600; z += 40) benches.push(mat4(THAMES_EDGE_X + 4.5, 0, z + 12, Math.PI / 2));
  group.add(instanced(benchGeo, M.timber, benches));
  for (const b of benches) { const p = new THREE.Vector3().setFromMatrixPosition(b); if (r() < 0.45) bins.push(mat4(p.x + 1.4, 0, p.z)); }
  for (const c of net.crossings) bins.push(mat4(c.x + c.dir[0] * 7 - c.dir[1] * (c.w / 2 + 1.2), KERB_H, c.z + c.dir[1] * 7 + c.dir[0] * (c.w / 2 + 1.2)));
  const binGeo = mergeGeometries([new THREE.CylinderGeometry(0.28, 0.25, 0.95, 14).translate(0, 0.475, 0), new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14).translate(0, 0.98, 0)].map((g) => g.toNonIndexed()));
  group.add(instanced(binGeo, M.darkMetal, bins));
  const planters = [];
  for (const pl of PLAZAS.filter((p) => p.name !== 'Canada Square')) {
    for (let x = pl.x0 + 8; x < pl.x1 - 8; x += 14) { planters.push(mat4(x, 0, pl.z0 + 10), mat4(x, 0, pl.z1 - 10)); }
  }
  group.add(instanced(new THREE.BoxGeometry(3, 0.6, 1.4).translate(0, 0.3, 0), M.kerb, planters));
  group.add(instanced(new THREE.BoxGeometry(2.8, 0.5, 1.2).translate(0, 0.85, 0), M.hedge, planters));
  for (const pm of planters) { const p = new THREE.Vector3().setFromMatrixPosition(pm); colliders.push({ rect: [p.x - 1.5, p.x + 1.5, p.z - 0.7, p.z + 0.7] }); }

  // ---- K6 red telephone boxes ----
  const k6 = buildK6();
  for (const [x, z, ry] of [[-268, -36, 0.0], [-266.5, -36, 0.0], [-540, 58, Math.PI / 2], [348, 28, Math.PI]]) { const b = k6.clone(); b.position.set(x, 0, z); b.rotation.y = ry; group.add(b); colliders.push({ rect: [x - 0.6, x + 0.6, z - 0.6, z + 0.6] }); }

  // ---- bus shelters ----
  for (const ln of net.lanes.slice(0, 2)) for (const s of ln.busStops) {
    const [x, z] = pointAt(ln.line, s), [x2, z2] = pointAt(ln.line, s + 1);
    const dx = x2 - x, dz = z2 - z, l = Math.hypot(dx, dz);
    // shelter on the left kerb of the lane
    const lx = dz / l, lz = -dx / l; const off = 2.25 + 0.25 + 2.2; // to footway
    const sh = buildShelter(); sh.position.set(x + lx * off, KERB_H, z + lz * off); sh.rotation.y = Math.atan2(dx, dz) + Math.PI / 2; group.add(sh);
  }

  // ---- Cabot Square fountain ----
  {
    const fx = -230, fz = 0;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(11, 11.2, 0.55, 64, 1, true), M.kerb); rim.position.set(fx, 0.27, fz); rim.castShadow = true; group.add(rim);
    const top = new THREE.Mesh(new THREE.RingGeometry(10.5, 11.2, 64).rotateX(-Math.PI / 2), M.kerb); top.position.set(fx, 0.55, fz); group.add(top);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(10.6, 64).rotateX(-Math.PI / 2), M.waterFeature); pool.position.set(fx, 0.35, fz); pool.receiveShadow = true; group.add(pool);
    const jetMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.1, emissive: 0xcfe8ff, emissiveIntensity: 0.15, depthWrite: false });
    registerEmissive(jetMat, 0.15, 0.4, 2.5);
    const jets = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; jets.push(mat4(fx + Math.cos(a) * 6, 0.35, fz + Math.sin(a) * 6, 0, 1, 1)); }
    jets.push(mat4(fx, 0.35, fz, 0, 2.2, 2.2));
    const jm = instanced(new THREE.CylinderGeometry(0.03, 0.12, 3, 8, 1, true).translate(0, 1.5, 0), jetMat, jets, { cast: false });
    jm.userData.fountain = true; group.add(jm);
    colliders.push({ circle: [fx, fz, 11.3] });
  }

  // ---- railings: Thames path + bridges, mooring bollards ----
  const posts = [], rails = [];
  for (let z = -700; z < 700; z += 2) posts.push(mat4(THAMES_EDGE_X + 0.35, 0, z));
  rails.push(new THREE.Matrix4().compose(new THREE.Vector3(THAMES_EDGE_X + 0.35, 1.1, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1400)));
  rails.push(new THREE.Matrix4().compose(new THREE.Vector3(THAMES_EDGE_X + 0.35, 0.6, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1400)));
  const glass = [];
  for (const b of BRIDGES) {
    const len = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, w = b.x1 - b.x0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, len), M.concrete); deck.position.set(cx, b.h - 0.45, cz); deck.castShadow = deck.receiveShadow = true; group.add(deck);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, len).rotateX(-Math.PI / 2), M.deck); top.position.set(cx, b.h + 0.005, cz); top.receiveShadow = true; group.add(top);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.2, len), M.whiteMetal); beam.position.set(cx, b.h - 1.4, cz); beam.castShadow = true; group.add(beam);
    for (const sx of [b.x0 + 0.1, b.x1 - 0.1]) {
      for (let z = b.z0; z <= b.z1; z += 2) posts.push(mat4(sx, b.h, z));
      rails.push(new THREE.Matrix4().compose(new THREE.Vector3(sx, b.h + 1.1, cz), new THREE.Quaternion(), new THREE.Vector3(1, 1, len)));
      glass.push(new THREE.Matrix4().compose(new THREE.Vector3(sx, b.h + 0.55, cz), new THREE.Quaternion(), new THREE.Vector3(1, 1, len)));
    }
  }
  group.add(instanced(new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(0, 0.55, 0), M.steel, posts));
  group.add(instanced(new THREE.BoxGeometry(0.07, 0.07, 1), M.steel, rails));
  group.add(instanced(new THREE.BoxGeometry(0.02, 1.0, 1), M.railGlass, glass, { cast: false }));
  const moor = [];
  for (const d of DOCKS) {
    const xs = d.poly.map((p) => p[0]), zs = d.poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    for (let x = x0 + 6; x < x1; x += 18) { moor.push(mat4(x, 0, z0 - 0.5), mat4(x, 0, z1 + 0.5)); }
  }
  const moorGeo = mergeGeometries([new THREE.CylinderGeometry(0.18, 0.22, 0.55, 12).translate(0, 0.275, 0), new THREE.CylinderGeometry(0.26, 0.2, 0.12, 12).translate(0, 0.6, 0)].map((g) => g.toNonIndexed()));
  group.add(instanced(moorGeo, M.blackPaint, moor));

  // ---- Underground roundel signs near station entrances ----
  for (const [x, z, ry] of [[200, 18, 0], [340, -18, Math.PI], [20, -146, 0], [-128, 58, Math.PI / 2]]) group.add(roundel(x, z, ry));

  scene.add(group);
  return { group, lamps, lampMesh, lampPos, poolMat, headMat, colliders, fountain: group.children.find((c) => c.userData.fountain) };
}

function buildK6() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.3, 0.9).translate(0, 1.15, 0), M.redPaint); body.castShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.95, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.35, 1).translate(0, 2.3, 0), M.redPaint); roof.castShadow = true; g.add(roof);
  const roof2 = roof.clone(); roof2.rotation.y = Math.PI / 2; g.add(roof2);
  const sign = new THREE.MeshBasicMaterial({ map: makeSignText('TELEPHONE', '#111', '#f4f1e6', 512, 96) });
  registerEmissive(sign, 0, 0, 0);
  const winMat = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.08, metalness: 0.8, emissive: 0xffd9a0, emissiveIntensity: 0 });
  registerEmissive(winMat, 0.0, 0.3, 1.4);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2; const f = new THREE.Group(); f.rotation.y = a;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.55), winMat); w.position.set(0, 1.2, 0.452); f.add(w);
    for (let k = 1; k < 3; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.55, 0.02), M.redPaint); bar.position.set(-0.31 + k * 0.207, 1.2, 0.46); f.add(bar); }
    for (let k = 1; k < 8; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.02), M.redPaint); bar.position.set(0, 0.425 + k * 0.194, 0.46); f.add(bar); }
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.11), sign); s.position.set(0, 2.15, 0.455); f.add(s);
    g.add(f);
  }
  g.traverse((o) => { if (o.isMesh) o.layers.set(1); });
  return g;
}

function buildShelter() {
  const g = new THREE.Group();
  const frame = M.darkMetal;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 1.5), frame); roof.position.set(0, 2.5, 0); roof.castShadow = true; g.add(roof);
  for (const x of [-2, 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.5, 0.06), frame); p.position.set(x, 1.25, -0.65); g.add(p); }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.1), M.railGlass); back.position.set(0, 1.2, -0.68); g.add(back);
  const ad = new THREE.MeshBasicMaterial({ map: adPoster() });
  const adPanel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.75, 1.2), [frame, frame, frame, frame, ad, ad]); adPanel.position.set(2.05, 1.1, -0.05); adPanel.rotation.y = Math.PI / 2; g.add(adPanel);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.3), M.steel); seat.position.set(-0.6, 0.55, -0.5); g.add(seat);
  // bus stop flag
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8), frame); pole.position.set(-2.6, 1.45, 0.4); g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshBasicMaterial({ map: makeSignText('BUS', '#fff', '#c8102e', 256, 256), side: THREE.DoubleSide })); flag.position.set(-2.6, 2.7, 0.4); g.add(flag);
  g.traverse((o) => { if (o.isMesh) o.layers.set(1); });
  return g;
}

function adPoster() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 384; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 384); gr.addColorStop(0, '#0e2b4a'); gr.addColorStop(1, '#2b8aa8'); x.fillStyle = gr; x.fillRect(0, 0, 256, 384);
  x.fillStyle = '#f5c542'; x.beginPath(); x.arc(128, 150, 70, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.fillText('DOCKLANDS', 128, 280); x.font = '22px sans-serif'; x.fillText('Autumn Festival', 128, 315);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function roundel(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8).translate(0, 1.6, 0), M.darkMetal); g.add(pole);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.05, 0.08), side: THREE.DoubleSide });
  const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.0, 0.1, 0.9), side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 40), ringMat); ring.position.y = 3.3; g.add(ring);
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.2), barMat); bar.position.set(0, 3.3, 0.01); g.add(bar);
  g.traverse((o) => { if (o.isMesh) o.layers.set(1); });
  return g;
}
