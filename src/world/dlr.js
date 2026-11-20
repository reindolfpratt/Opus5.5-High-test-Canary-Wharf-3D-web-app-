// Docklands Light Railway: concrete viaduct, piers, track, stations with canopies, and animated driverless trains.
import * as THREE from 'three';
import { DLR, DOCKS, WATER_Y } from '../layout.js';
import { M, registerEmissive } from '../materials.js';
import { pointInPoly } from '../util.js';

// Box with UVs in metres (so tiling textures have the right scale)
export function boxM(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}

function liveryTexture() {
  const W = 2048, H = 256; const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = W; e.height = H; const xe = e.getContext('2d'); xe.fillStyle = '#000'; xe.fillRect(0, 0, W, H);
  const ppm = W / 28;
  x.fillStyle = '#e9ecef'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#c8102e'; x.fillRect(0, H * 0.72, W, H * 0.28); // red skirt
  x.fillStyle = '#0f1216'; x.fillRect(0, H * 0.22, W, H * 0.33); // window band
  xe.fillStyle = '#fff3dc'; xe.fillRect(0, H * 0.24, W, H * 0.29);
  for (let k = 0; k < 4; k++) { // doors
    const dx = (3 + k * 7.3) * ppm; x.fillStyle = '#1d3f8f'; x.fillRect(dx, H * 0.08, 1.6 * ppm, H * 0.9);
    x.fillStyle = '#0f1216'; x.fillRect(dx + 0.15 * ppm, H * 0.2, 0.6 * ppm, H * 0.38); x.fillRect(dx + 0.85 * ppm, H * 0.2, 0.6 * ppm, H * 0.38);
    xe.fillStyle = '#fff3dc'; xe.fillRect(dx + 0.15 * ppm, H * 0.22, 0.6 * ppm, H * 0.34); xe.fillRect(dx + 0.85 * ppm, H * 0.22, 0.6 * ppm, H * 0.34);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const te = new THREE.CanvasTexture(e); te.colorSpace = THREE.SRGBColorSpace;
  return { t, te };
}

export function buildDLR(scene) {
  const group = new THREE.Group(); group.name = 'dlr';
  const X = DLR.x, top = DLR.deck, W = DLR.width; const len = DLR.z1 - DLR.z0, cz = (DLR.z0 + DLR.z1) / 2;
  const colliders = [];
  const deck = new THREE.Mesh(boxM(W, 1.5, len), M.concrete); deck.position.set(X, top - 0.75, cz); deck.castShadow = deck.receiveShadow = true; group.add(deck);
  // soffit edge beams
  for (const s of [-1, 1]) {
    const par = new THREE.Mesh(boxM(0.3, 1.1, len), M.concrete); par.position.set(X + s * (W / 2 - 0.15), top + 0.55, cz); par.castShadow = true; par.receiveShadow = true; group.add(par);
  }
  // track: two tracks, ballastless slab, running rails + third rail
  const slab = new THREE.Mesh(boxM(W - 0.8, 0.12, len), M.darkMetal); slab.position.set(X, top + 0.06, cz); slab.receiveShadow = true; group.add(slab);
  const railGeo = new THREE.BoxGeometry(0.08, 0.16, len);
  for (const tx of [-1.9, 1.9]) for (const o of [-0.72, 0.72, 1.15]) { const r = new THREE.Mesh(railGeo, M.steel); r.position.set(X + tx + o, top + 0.2, cz); group.add(r); }
  // piers
  const roadZ = [-95, 105, 430];
  const pierGeo = new THREE.CylinderGeometry(1.0, 1.15, 1, 20);
  const capGeo = boxM(W - 1, 1.0, 2.2);
  for (let z = DLR.z0 + 15; z < DLR.z1; z += 32) {
    if (roadZ.some((rz) => Math.abs(z - rz) < 9)) continue;
    if (DLR.stations.some((s) => z > s.z0 && z < s.z1) && (z % 64) > 10) continue;
    const inDock = DOCKS.some((d) => pointInPoly(X, z, d.poly));
    const y0 = inDock ? WATER_Y - 3 : 0;
    const h = top - 1.5 - y0;
    const p = new THREE.Mesh(pierGeo, M.concrete); p.scale.y = h; p.position.set(X, y0 + h / 2, z); p.castShadow = true; p.receiveShadow = true; group.add(p);
    const c = new THREE.Mesh(capGeo, M.concrete); c.position.set(X, top - 2.0, z); c.castShadow = true; group.add(c);
    if (!inDock) colliders.push({ circle: [X, z, 1.25] });
  }
  // stations: wider platforms + canopy roofs
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide });
  const platLight = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf4f6ff, emissiveIntensity: 0 });
  registerEmissive(platLight, 0.0, 1.0, 3.0);
  for (const s of DLR.stations) {
    const L = s.z1 - s.z0, zc = (s.z0 + s.z1) / 2;
    for (const side of [-1, 1]) {
      const plat = new THREE.Mesh(boxM(3.2, 1.0, L), M.concrete); plat.position.set(X + side * (W / 2 + 1.6), top + 0.45 - 0.5, zc); plat.castShadow = plat.receiveShadow = true; group.add(plat);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, L), new THREE.MeshStandardMaterial({ color: 0xe8c22e, roughness: 0.6 })); edge.position.set(X + side * (W / 2 + 0.2), top + 0.96, zc); group.add(edge);
      for (let z = s.z0 + 4; z < s.z1; z += 8) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 8), M.whiteMetal); col.position.set(X + side * (W / 2 + 2.8), top + 3.0, z); group.add(col); }
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, L - 2), platLight); strip.position.set(X + side * (W / 2 + 1.6), top + 4.9, zc); group.add(strip);
    }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(W / 2 + 4, W / 2 + 4, L, 24, 1, true, -Math.PI / 2, Math.PI), canopyMat);
    roof.rotation.x = -Math.PI / 2; roof.scale.set(1, 1, 0.22); roof.position.set(X, top + 5.2, zc); roof.castShadow = true; group.add(roof);
  }
  // trains
  const { t, te } = liveryTexture();
  const side = new THREE.MeshStandardMaterial({ map: t, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.35, metalness: 0.2 });
  registerEmissive(side, 0.05, 0.6, 2.0);
  const roofM = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.4 });
  const endM = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.1, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
  registerEmissive(endM, 0, 0.0, 0.0);
  const carGeo = new THREE.BoxGeometry(2.65, 3.3, 27.6);
  const bogieGeo = new THREE.BoxGeometry(2.2, 0.7, 3);
  const trains = [];
  const mk = (dir, z) => {
    const g = new THREE.Group();
    for (let k = 0; k < 2; k++) {
      // material order: +x, -x, +y, -y, +z, -z
      const car = new THREE.Mesh(carGeo, [side, side, roofM, M.darkMetal, endM, endM]); car.position.set(0, 2.2, k * 28.2 - 14.1); car.castShadow = true; g.add(car);
      for (const b of [-10, 10]) { const bg = new THREE.Mesh(bogieGeo, M.darkMetal); bg.position.set(0, 0.55, car.position.z + b); g.add(bg); }
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 4) }));
    for (const hx of [-0.8, 0.8]) { const h = head.clone(); h.position.set(hx, 1.3, dir < 0 ? -28.25 : 28.25); g.add(h); }
    g.position.set(X + (dir < 0 ? -1.9 : 1.9), top + 0.25, z);
    g.rotation.y = 0;
    g.userData.noMerge = true;
    group.add(g);
    trains.push({ g, dir, z, v: 0, state: 'run', dwell: 0, lastStation: null });
  };
  mk(-1, 500); mk(1, -300); mk(-1, -900); mk(1, 1100);
  scene.add(group);
  return { group, colliders, trains, update: (dt) => updateTrains(trains, dt) };
}

function updateTrains(trains, dt) {
  const VMAX = 17, A = 1.0;
  for (const t of trains) {
    // next station ahead
    let next = null, best = 1e9;
    for (const s of DLR.stations) {
      const sz = (s.z0 + s.z1) / 2; const d = (sz - t.z) * t.dir;
      if (d > -0.5 && d < best && s.name !== t.lastStation) { best = d; next = s; }
    }
    if (t.state === 'dwell') {
      t.dwell -= dt; t.v = 0;
      if (t.dwell <= 0) { t.state = 'run'; }
    } else {
      const stopDist = next ? best : 1e9;
      const brake = (t.v * t.v) / (2 * A);
      if (stopDist < 0.6 && t.v < 1.0 && next) { t.state = 'dwell'; t.dwell = 18; t.lastStation = next.name; t.v = 0; }
      else if (stopDist <= brake + 1) t.v = Math.max(0.6, t.v - A * dt * 1.15);
      else t.v = Math.min(VMAX, t.v + A * dt);
    }
    t.z += t.v * t.dir * dt;
    if (t.dir > 0 && t.z > DLR.z1 - 60) { t.z = DLR.z0 + 60; t.lastStation = null; }
    if (t.dir < 0 && t.z < DLR.z0 + 60) { t.z = DLR.z1 - 60; t.lastStation = null; }
    t.g.position.z = t.z;
  }
}
