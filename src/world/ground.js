// Land, dock basins with quay walls, the Thames, water surface, lawns.
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { DOCKS, THAMES_EDGE_X, FAR_BANK_X, WATER_Y, PARKS, KERB_H } from '../layout.js';
import { M } from '../materials.js';
import { makeWaterNormals } from '../textures.js';
import { normalizeWinding } from '../util.js';

function shapeFrom(poly) {
  const s = new THREE.Shape(); poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s;
}
function pathFrom(poly) {
  const s = new THREE.Path(); poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s;
}
function flat(shape, y, mat, recv = true) {
  const g = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = recv; return m;
}
const R = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

// vertical wall quad strip along a polyline from y0 to y1
function wall(pts, y0, y1, mat, closed = false) {
  const pos = [], uv = [], idx = []; let s = 0; const n = pts.length, cnt = closed ? n + 1 : n;
  for (let i = 0; i < cnt; i++) {
    const p = pts[i % n]; if (i) { const q = pts[(i - 1) % n]; s += Math.hypot(p[0] - q[0], p[1] - q[1]); }
    pos.push(p[0], y0, p[1], p[0], y1, p[1]); uv.push(s, y0, s, y1);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}

export function buildGround(scene, q) {
  const group = new THREE.Group(); group.name = 'ground';
  // --- estate land (granite paving) with dock holes ---
  const near = R(THAMES_EDGE_X, 840, -440, 620);
  const sNear = shapeFrom(normalizeWinding(near));
  for (const d of DOCKS) sNear.holes.push(pathFrom(normalizeWinding(d.poly)));
  group.add(flat(sNear, 0, M.paving));
  // --- surrounding city ground ---
  const sOuter = shapeFrom(normalizeWinding(R(THAMES_EDGE_X, 5000, -5000, 5000)));
  sOuter.holes.push(pathFrom(normalizeWinding(near)));
  group.add(flat(sOuter, -0.02, M.urbanGround));
  // --- far bank of the Thames (Rotherhithe) ---
  group.add(flat(shapeFrom(normalizeWinding(R(-6000, FAR_BANK_X, -5000, 5000))), 0.5, M.urbanGround));

  // --- quay walls + granite coping ---
  const copeW = 0.7;
  for (const d of DOCKS) {
    const xs = d.poly.map((p) => p[0]), zs = d.poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    group.add(wall([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], -8, 0, M.quayWall, true));
    for (const [a, b, c, e] of [[x0 - copeW, x1 + copeW, z0 - copeW, z0], [x0 - copeW, x1 + copeW, z1, z1 + copeW], [x0 - copeW, x0, z0, z1], [x1, x1 + copeW, z0, z1]]) {
      const g = new THREE.PlaneGeometry(b - a, e - c).rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, M.coping); m.position.set((a + b) / 2, 0.012, (c + e) / 2); m.receiveShadow = true; group.add(m);
    }
  }
  group.add(wall([[THAMES_EDGE_X, 5000], [THAMES_EDGE_X, -5000]], -8, 0.0, M.quayWall));
  group.add(wall([[FAR_BANK_X, -5000], [FAR_BANK_X, 5000]], -8, 0.5, M.quayWall));
  { const g = new THREE.PlaneGeometry(1.0, 1600).rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, M.coping); m.position.set(THAMES_EDGE_X + 0.5, 0.012, 0); group.add(m); }

  // --- water (planar reflections) ---
  const normals = makeWaterNormals();
  const water = new Water(new THREE.PlaneGeometry(12000, 12000), {
    textureWidth: q.waterRes, textureHeight: q.waterRes, waterNormals: normals,
    sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x1d2b26, distortionScale: 2.2, fog: true,
  });
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.material.uniforms.size.value = 3.5;
  // richer dock water: depth-tinted body colour, sky-matched reflections and a softer fresnel
  water.material.fragmentShader = water.material.fragmentShader
    .replace('float rf0 = 0.02;', 'float rf0 = 0.025;')
    .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', 'vec3 scatter = (0.35 + 0.65 * max( 0.0, dot( surfaceNormal, eyeDirection ) )) * waterColor * (0.6 + 0.4 * sunColor);');
  water.receiveShadow = true;
  group.add(water);

  // --- lawns ---
  for (const p of PARKS) {
    const y = p.name === 'Westferry Circus' ? KERB_H + 0.02 : 0.035;
    const m = flat(shapeFrom(normalizeWinding(p.poly)), y, M.grass); group.add(m);
    // low granite edge
    if (p.name !== 'Westferry Circus') group.add(wallBand(normalizeWinding(p.poly), 0.0, 0.18, M.kerb));
  }
  scene.add(group);
  return { group, water };
}

function wallBand(poly, y0, y1, mat) { return wall(poly, y0, y1, mat, true); }
