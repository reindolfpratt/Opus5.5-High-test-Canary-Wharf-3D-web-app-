// Procedural vehicle models (London black cab, cars, vans, double-decker bus, Met Police car).
// Each type: paint geometry (instance-coloured clearcoat) + "rest" multi-material geometry + head/tail light quads.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeLivery } from './textures.js';

function extrudeProfile(pts, width, bevel = 0.05) {
  const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath();
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // shape x (length) -> local +z forward
  return g.index ? g.toNonIndexed() : g;
}
// profile with wheel arches cut into the sill line
function bodyProfile(o) {
  const { L, sill, wr, wb, belt, hoodF, hoodR, noseY, tailY, bumperF, bumperR } = o;
  const pts = []; const fx = L / 2, rx = -L / 2;
  pts.push([rx + 0.05, sill]);
  for (const ax of [-wb / 2, wb / 2]) {
    const R = wr + 0.06; const n = 10;
    pts.push([ax - R, sill]);
    for (let i = 1; i < n; i++) { const a = Math.PI - (i / n) * Math.PI; pts.push([ax + Math.cos(a) * R, wr + Math.sin(a) * R * 0.92]); }
    pts.push([ax + R, sill]);
  }
  pts.push([fx - 0.05, sill], [fx, bumperF], [fx - 0.06, noseY], [fx - 0.35, hoodF], [hoodR, belt + 0.02], [o.deckR, belt], [rx + 0.18, tailY], [rx, bumperR]);
  return pts;
}

const COMMON = {};
function commonMats() {
  if (COMMON.glass) return COMMON;
  COMMON.glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e11, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
  COMMON.trim = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.55, metalness: 0.1 });
  COMMON.tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92, metalness: 0 });
  COMMON.rim = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 1 });
  COMMON.chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 });
  COMMON.paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.2 });
  COMMON.light = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  COMMON.taxiSign = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.7, 0.2) });
  COMMON.police = new THREE.MeshStandardMaterial({ map: makeLivery('police'), roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 });
  COMMON.busRed = new THREE.MeshPhysicalMaterial({ color: 0xc8102e, roughness: 0.3, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.08 });
  return COMMON;
}

function wheels(wb, track, wr, ww = 0.22) {
  const tyre = [], rim = [];
  for (const z of [-wb / 2, wb / 2]) for (const sx of [-1, 1]) {
    tyre.push(new THREE.CylinderGeometry(wr, wr, ww, 14).rotateZ(Math.PI / 2).translate(sx * track / 2, wr, z).toNonIndexed());
    rim.push(new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, 0.02, 16).rotateZ(Math.PI / 2).translate(sx * (track / 2 + ww / 2 + 0.005), wr, z).toNonIndexed());
  }
  return { tyre: mergeGeometries(tyre), rim: mergeGeometries(rim) };
}
function lightQuads(list) { return mergeGeometries(list.map(([x, y, z, w, h, back]) => { const g = new THREE.PlaneGeometry(w, h); if (back) g.rotateY(Math.PI); return g.translate(x, y, z).toNonIndexed(); })); }

// returns { paint, rest, restMats, heads, tails, len, width, extra }
function carType(kind) {
  const C = commonMats();
  const spec = {
    car:   { L: 4.5, W: 1.8, H: 1.45, sill: 0.28, wr: 0.32, wb: 2.7, belt: 0.95, hoodF: 0.86, hoodR: 1.0, noseY: 0.72, tailY: 0.93, bumperF: 0.45, bumperR: 0.5, deckR: -1.6, gF: 0.95, gRoofF: 0.05, gRoofR: -1.15, gR: -1.75, roofY: 1.43 },
    suv:   { L: 4.7, W: 1.9, H: 1.7, sill: 0.36, wr: 0.36, wb: 2.8, belt: 1.08, hoodF: 1.0, hoodR: 1.25, noseY: 0.85, tailY: 1.06, bumperF: 0.55, bumperR: 0.55, deckR: -2.1, gF: 1.2, gRoofF: 0.35, gRoofR: -2.0, gR: -2.25, roofY: 1.68 },
    cab:   { L: 4.85, W: 1.94, H: 1.84, sill: 0.3, wr: 0.34, wb: 2.9, belt: 1.05, hoodF: 0.98, hoodR: 1.3, noseY: 0.82, tailY: 1.04, bumperF: 0.5, bumperR: 0.52, deckR: -2.1, gF: 1.32, gRoofF: 0.65, gRoofR: -2.05, gR: -2.3, roofY: 1.8 },
    van:   { L: 5.4, W: 2.0, H: 2.45, sill: 0.4, wr: 0.36, wb: 3.4, belt: 1.15, hoodF: 1.05, hoodR: 1.85, noseY: 0.9, tailY: 2.3, bumperF: 0.55, bumperR: 0.55, deckR: -2.69, gF: 1.85, gRoofF: 1.25, gRoofR: 0.7, gR: 0.68, roofY: 2.42 },
    police:{ L: 4.9, W: 1.86, H: 1.5, sill: 0.3, wr: 0.33, wb: 2.95, belt: 0.98, hoodF: 0.9, hoodR: 1.1, noseY: 0.74, tailY: 0.98, bumperF: 0.46, bumperR: 0.5, deckR: -2.2, gF: 1.05, gRoofF: 0.15, gRoofR: -2.15, gR: -2.38, roofY: 1.47 },
  }[kind];
  const s = spec;
  const body = extrudeProfile(bodyProfile(s), s.W, 0.07);
  // greenhouse (glass) and roof skin
  const gpts = [[s.gF, s.belt - 0.02], [s.gRoofF, s.roofY], [s.gRoofR, s.roofY], [s.gR, s.belt - 0.02]];
  if (kind === 'van') { gpts.length = 0; gpts.push([s.gF + 0.75, s.belt - 0.02], [s.gF - 0.05, s.roofY - 0.25], [s.gRoofR, s.roofY - 0.25], [s.gRoofR, s.belt - 0.02]); }
  const glass = extrudeProfile(gpts, s.W - 0.12, 0.04);
  const roofT = 0.05; const rf = s.gRoofF - 0.05, rr = s.gRoofR + 0.05;
  const roof = kind === 'van'
    ? extrudeProfile([[s.gF - 0.05, s.roofY - 0.27], [-s.L / 2 + 0.02, s.roofY - 0.27], [-s.L / 2 + 0.02, s.roofY], [s.gF - 0.3, s.roofY]], s.W - 0.04, 0.04)
    : extrudeProfile([[rf, s.roofY - 0.04], [rr, s.roofY - 0.04], [rr + 0.05, s.roofY + roofT], [rf - 0.05, s.roofY + roofT]], s.W - 0.16, 0.03);
  // pillars (paint) — B pillar
  const bp = new THREE.BoxGeometry(s.W - 0.06, s.roofY - s.belt, 0.12).translate(0, (s.roofY + s.belt) / 2, (s.gRoofF + s.gRoofR) / 2 + 0.2).toNonIndexed();
  const paintParts = [body, roof, bp];
  const W = wheels(s.wb, s.W - 0.2, s.wr);
  // trim: bumpers, mirrors, grille, sill
  const trimParts = [
    new THREE.BoxGeometry(s.W + 0.02, 0.18, 0.22).translate(0, s.bumperF - 0.08, s.L / 2 - 0.08).toNonIndexed(),
    new THREE.BoxGeometry(s.W + 0.02, 0.18, 0.22).translate(0, s.bumperR - 0.1, -s.L / 2 + 0.08).toNonIndexed(),
    new THREE.BoxGeometry(0.22, 0.12, 0.08).translate(s.W / 2 + 0.06, s.belt + 0.1, s.gF - 0.15).toNonIndexed(),
    new THREE.BoxGeometry(0.22, 0.12, 0.08).translate(-s.W / 2 - 0.06, s.belt + 0.1, s.gF - 0.15).toNonIndexed(),
    new THREE.BoxGeometry(s.W * 0.55, 0.16, 0.04).translate(0, s.noseY - 0.12, s.L / 2 + 0.005).toNonIndexed(),
  ];
  const rest = [glass, mergeGeometries(trimParts), W.tyre, W.rim];
  const restMats = [C.glass, C.trim, C.tyre, C.rim];
  if (kind === 'cab') {
    rest.push(new THREE.BoxGeometry(0.42, 0.12, 0.16).translate(0, s.roofY + 0.1, s.gRoofF - 0.15).toNonIndexed()); restMats.push(C.taxiSign);
    rest.push(new THREE.BoxGeometry(s.W * 0.5, 0.3, 0.05).translate(0, s.noseY - 0.1, s.L / 2 + 0.01).toNonIndexed()); restMats.push(C.chrome);
  }
  if (kind === 'police') {
    // Battenburg livery side panels
    const lv = [];
    for (const sx of [-1, 1]) { const g = new THREE.PlaneGeometry(s.L * 0.82, 0.42); g.rotateY(sx * Math.PI / 2); g.translate(sx * (s.W / 2 + 0.012), s.belt - 0.33, 0); lv.push(g.toNonIndexed()); }
    rest.push(mergeGeometries(lv)); restMats.push(C.police);
    rest.push(new THREE.BoxGeometry(1.2, 0.1, 0.3).translate(0, s.roofY + 0.1, s.gRoofF - 0.5).toNonIndexed()); restMats.push(C.trim);
  }
  const hy = s.noseY - 0.02, ty = s.tailY - 0.12;
  const heads = lightQuads([[-s.W / 2 + 0.28, hy, s.L / 2 - 0.02, 0.32, 0.12], [s.W / 2 - 0.28, hy, s.L / 2 - 0.02, 0.32, 0.12]]);
  const tails = lightQuads([[-s.W / 2 + 0.2, ty, -s.L / 2 - 0.01, 0.26, 0.16, true], [s.W / 2 - 0.2, ty, -s.L / 2 - 0.01, 0.26, 0.16, true]]);
  return { paint: mergeGeometries(paintParts), rest: mergeGeometries(rest, true), restMats, heads, tails, len: s.L, width: s.W, beacon: kind === 'police' ? [0, s.roofY + 0.2, s.gRoofF - 0.5] : null };
}

function busType() {
  const C = commonMats();
  const L = 10.6, W = 2.52, H = 4.35;
  const lower = new RoundedBoxGeometry(W, 1.1, L, 3, 0.12).translate(0, 0.25 + 0.55, 0).toNonIndexed();
  const mid = new RoundedBoxGeometry(W, 0.45, L, 2, 0.1).translate(0, 2.35, 0).toNonIndexed();
  const top = new RoundedBoxGeometry(W, 0.32, L, 3, 0.15).translate(0, 4.15, 0).toNonIndexed();
  const pillars = [];
  for (let z = -L / 2 + 0.5; z <= L / 2 - 0.4; z += 1.45) { pillars.push(new THREE.BoxGeometry(W + 0.01, 0.95, 0.09).translate(0, 1.85, z).toNonIndexed(), new THREE.BoxGeometry(W + 0.01, 1.0, 0.09).translate(0, 3.5, z).toNonIndexed()); }
  const paint = mergeGeometries([lower, mid, top, ...pillars]);
  const glass = mergeGeometries([new THREE.BoxGeometry(W - 0.04, 0.95, L - 0.1).translate(0, 1.85, 0).toNonIndexed(), new THREE.BoxGeometry(W - 0.04, 1.08, L - 0.1).translate(0, 3.5, 0).toNonIndexed()]);
  const Wh = wheels(5.9, W - 0.25, 0.5, 0.3);
  const dest = new THREE.BoxGeometry(1.7, 0.32, 0.04).translate(0, 2.9, L / 2 + 0.02).toNonIndexed();
  const destMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.05) });
  const rest = mergeGeometries([glass, Wh.tyre, Wh.rim, dest, new THREE.BoxGeometry(W + 0.02, 0.25, 0.2).translate(0, 0.35, L / 2).toNonIndexed()], true);
  const heads = lightQuads([[-0.9, 0.7, L / 2 + 0.03, 0.3, 0.14], [0.9, 0.7, L / 2 + 0.03, 0.3, 0.14]]);
  const tails = lightQuads([[-1.1, 1.0, -L / 2 - 0.03, 0.2, 0.4, true], [1.1, 1.0, -L / 2 - 0.03, 0.2, 0.4, true]]);
  return { paint, paintMat: C.busRed, rest, restMats: [C.glass, C.tyre, C.rim, destMat, C.trim], heads, tails, len: L, width: W, beacon: null };
}

export function vehicleTypes() {
  return { car: carType('car'), suv: carType('suv'), cab: carType('cab'), van: carType('van'), police: carType('police'), bus: busType(), mats: commonMats() };
}

export const CAR_COLOURS = [0x111111, 0x1a1a1c, 0xe8e8e8, 0xf4f4f2, 0x9ea3a8, 0x6e7378, 0x3a3f45, 0x0f2244, 0x5c0d12, 0x1f3b2a, 0x2a5a8c, 0x8a1c1c, 0xb7b29e, 0x3d2b1f];
