// Buildings: footprint prisms with continuous metre-scaled facade UVs, recessed glazed lobbies, crowns, roof plant.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS, CROSSRAIL, WATER_Y, THAMES_EDGE_X, FAR_BANK_X } from '../layout.js';
import { normalizeWinding, offsetPoly, mulberry32, rectPoly, pointInPoly } from '../util.js';
import { M, FACADES, registerEmissive } from '../materials.js';
import { STYLE_NAMES } from '../textures.js';

// subdivide polygon edges so per-vertex height functions (sloped crowns) look right
function subdivide(poly, maxLen) {
  const o = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / maxLen));
    for (let k = 0; k < n; k++) o.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return o;
}

// Side walls of a prism. topFn(x,z) gives the top height per vertex.
export function prismSides(poly, y0, topFn, uOff = 0, vOff = 0) {
  poly = normalizeWinding(poly);
  const n = poly.length; const smooth = n > 20;
  const pos = [], nrm = [], uv = [], idx = [];
  let s = uOff;
  const vn = []; // smooth vertex normals
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    let nx = (b[1] - a[1]) + (c[1] - b[1]), nz = -(b[0] - a[0]) - (c[0] - b[0]); const l = Math.hypot(nx, nz) || 1; vn.push([nx / l, nz / l]);
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue;
    const fn = [dz / L, -dx / L];
    const na = smooth ? vn[i] : fn, nb = smooth ? vn[(i + 1) % n] : fn;
    const ta = topFn(a[0], a[1]), tb = topFn(b[0], b[1]);
    const base = pos.length / 3;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], a[0], ta, a[1], b[0], tb, b[1]);
    nrm.push(na[0], 0, na[1], nb[0], 0, nb[1], na[0], 0, na[1], nb[0], 0, nb[1]);
    uv.push(s, y0 + vOff, s + L, y0 + vOff, s, ta + vOff, s + L, tb + vOff);
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    s += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // make sure faces point outward (normal vs winding)
  ensureOutward(g);
  return g;
}
function ensureOutward(g) {
  const p = g.attributes.position, n = g.attributes.normal, ix = g.index.array;
  if (ix.length < 3) return;
  const a = new THREE.Vector3().fromBufferAttribute(p, ix[0]), b = new THREE.Vector3().fromBufferAttribute(p, ix[1]), c = new THREE.Vector3().fromBufferAttribute(p, ix[2]);
  const fnrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const vn = new THREE.Vector3().fromBufferAttribute(n, ix[0]);
  if (fnrm.dot(vn) < 0) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
}

// Horizontal cap (roof / soffit). holes optional. faceUp: normal direction.
export function cap(poly, yFn, faceUp = true, holes = []) {
  poly = normalizeWinding(poly);
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const hv = holes.map((h) => normalizeWinding(h).reverse().map(([x, z]) => new THREE.Vector2(x, z)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hv);
  const all = contour.concat(...hv);
  const pos = [], uv = [], idx = [];
  for (const v of all) { pos.push(v.x, typeof yFn === 'function' ? yFn(v.x, v.y) : yFn, v.y); uv.push(v.x, v.y); }
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const ny = g.attributes.normal.getY(idx[0]);
  if ((ny > 0) !== faceUp) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}

function bbox(poly) { const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; }
function mesh(g, m, cast = true, recv = true) { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = recv; return x; }

export function buildBuildings(scene, q) {
  const group = new THREE.Group(); group.name = 'buildings';
  const colliders = []; const beacons = []; const r = mulberry32(2024);
  const signMats = {};
  for (const b of BUILDINGS) {
    const P = normalizeWinding(b.poly); const bb = bbox(P);
    const fac = FACADES[b.style] || FACADES.glassGrey;
    const uOff = Math.floor(r() * 16) * 1.5, vOff = Math.floor(r() * 12) * 4;
    const lobby = b.lobby || 0;
    const H = b.h;
    let topFn = () => H;
    let poly = P;
    if (b.crown === 'slope') { poly = subdivide(P, 6); const ch = b.crownH || 14; topFn = (x) => H + ch * (x - bb.x0) / (bb.x1 - bb.x0); }
    if (b.crown === 'diamond') { poly = subdivide(P, 4); const ch = 16, zc = (bb.z0 + bb.z1) / 2, hz = (bb.z1 - bb.z0) / 2; topFn = (x, z) => H + ch * (1 - Math.abs(z - zc) / hz) * 0.9; }
    // ground floor: recessed lobby glazing + soffit
    let collide = P;
    if (lobby > 0) {
      const inset = offsetPoly(P, 1.4);
      group.add(mesh(prismSides(inset, 0, () => lobby, uOff, 0), M.lobby, false, true));
      group.add(mesh(cap(P, lobby, false, [inset]), M.whiteMetal, false, true));
      collide = inset;
      // columns at the corners of the recess (structure reads as real)
      for (const [x, z] of P) {
        const c = mesh(new THREE.BoxGeometry(0.9, lobby, 0.9), M.darkMetal); c.position.set(x + Math.sign(((bb.x0 + bb.x1) / 2) - x) * 0.7, lobby / 2, z + Math.sign(((bb.z0 + bb.z1) / 2) - z) * 0.7); group.add(c);
      }
    }
    const shaft = mesh(prismSides(poly, lobby, topFn, uOff, vOff), fac);
    shaft.name = b.name; group.add(shaft);
    // roof
    if (b.crown === 'slope' || b.crown === 'diamond') {
      // flat cap would be wrong for the diamond; approximate with two sloped planes via fine grid triangulation of subdivided outline
      group.add(mesh(cap(poly, topFn, true), M.steelPanel));
    } else group.add(mesh(cap(P, H, true), M.roof, false, true));
    // parapet
    if (!['slope', 'diamond', 'pyramid'].includes(b.crown)) {
      const outer = P, inner = offsetPoly(P, 0.4);
      group.add(mesh(prismSides(outer, H, () => H + 1.1, uOff, vOff), M.darkMetal, true, false));
      group.add(mesh(cap(outer, H + 1.1, true, [inner]), M.darkMetal, false, false));
    }
    // crowns
    if (b.crown === 'pyramid') {
      // One Canada Square: steel pyramid (with notched corners following the plan)
      const base = offsetPoly(P, 1.0); const apexY = H + b.crownH; const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
      const pos = [];
      for (let i = 0; i < base.length; i++) { const a = base[i], c = base[(i + 1) % base.length]; pos.push(a[0], H, a[1], c[0], H, c[1], cx, apexY, cz); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      // ensure outward
      const nrm = g.attributes.normal; if (nrm.getY(0) < 0) { for (let i = 0; i < pos.length; i += 9) { for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; } } g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); }
      group.add(mesh(g, M.steelPanel));
      // the pyramid's gentle glow vents at night
      const vent = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2dd, emissiveIntensity: 0.0, roughness: 0.4, metalness: 0.6 });
      registerEmissive(vent, 0, 0.2, 1.6);
      const vring = mesh(prismSides(offsetPoly(P, 0.6), H - 3, () => H, 0, 0), vent, false, false); group.add(vring);
      beacons.push([cx, apexY + 1.2, cz, 'white']);
    }
    if (b.crown === 'signBand' || b.crown === 'setback') {
      const band = offsetPoly(P, b.crown === 'setback' ? 4 : 0.6);
      const bandH = b.crown === 'setback' ? 12 : 9;
      group.add(mesh(prismSides(band, H, () => H + bandH, uOff, vOff), b.crown === 'setback' ? FACADES.glassDark : M.darkMetal));
      group.add(mesh(cap(band, H + bandH, true), M.roof, false, false));
      // illuminated corporate crown sign panels (generic, unbranded) on the two long faces
      if (b.signColor) {
      const key = b.signColor.join(',');
      if (!signMats[key]) { signMats[key] = new THREE.MeshBasicMaterial({ color: new THREE.Color(...b.signColor) }); signMats[key].userData.sign = true; }
      const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
      const w = (bb.x1 - bb.x0) * 0.32;
      for (const side of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(w, bandH * 0.55), signMats[key]);
        const zEdge = side < 0 ? bb.z0 : bb.z1; const inset = b.crown === 'setback' ? 4 : 0.6;
        s.position.set(cx, H + bandH * 0.5, zEdge - side * (inset - 0.08)); s.rotation.y = side < 0 ? Math.PI : 0;
        group.add(s);
      }
      }
      beacons.push([bb.x0 + 2, H + bandH + 0.6, bb.z0 + 2, 'red'], [bb.x1 - 2, H + bandH + 0.6, bb.z1 - 2, 'red']);
    }
    if (b.crown === 'plant' || (!b.crown && H > 30)) {
      // rooftop plant rooms, louvres, maintenance cradle track
      const inset = offsetPoly(P, Math.min(6, (bb.x1 - bb.x0) * 0.18));
      const ph = H > 100 ? 7 : 4;
      group.add(mesh(prismSides(inset, H, () => H + ph, 0, 0), M.plant));
      group.add(mesh(cap(inset, H + ph, true), M.roof, false, false));
      const n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const bw = 2 + r() * 5, bd = 2 + r() * 5, bh = 1.5 + r() * 3;
        const x = bb.x0 + 4 + r() * (bb.x1 - bb.x0 - 8), z = bb.z0 + 4 + r() * (bb.z1 - bb.z0 - 8);
        if (!pointInPoly(x, z, P)) continue;
        const c = mesh(new THREE.BoxGeometry(bw, bh, bd), r() < 0.5 ? M.plant : M.whiteMetal); c.position.set(x, H + ph + bh / 2, z); group.add(c);
      }
      if (H > 140) beacons.push([bb.x0 + 1.5, H + ph + 1, bb.z0 + 1.5, 'red'], [bb.x1 - 1.5, H + ph + 1, bb.z1 - 1.5, 'red']);
    }
    if ((b.crown === 'slope' || b.crown === 'diamond') && H > 140) beacons.push([(bb.x0 + bb.x1) / 2, topFn((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2) + 1, (bb.z0 + bb.z1) / 2, 'red']);
    colliders.push({ poly: normalizeWinding(collide), bb: bbox(collide), name: b.name });
  }

  // ---- Crossrail Place (Elizabeth line) in North Dock: podium + timber lattice shell + roof garden ----
  {
    const c = CROSSRAIL; const P = rectPoly((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, c.x1 - c.x0, c.z1 - c.z0);
    group.add(mesh(prismSides(P, WATER_Y, () => c.h - 6, 0, 0), FACADES.podium));
    group.add(mesh(cap(P, c.h - 6, true), M.grass, false, true));
    const L = c.x1 - c.x0 + 10, rad = (c.z1 - c.z0) / 2 + 1.5;
    const g = new THREE.CylinderGeometry(rad, rad, L, 28, 8, true, 0, Math.PI);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * rad, uv.getY(i) * L);
    const shell = mesh(g, M.lattice); shell.rotation.z = Math.PI / 2; shell.rotation.y = 0; shell.scale.set(0.75, 1, 1);
    shell.position.set((c.x0 + c.x1) / 2, c.h - 6, (c.z0 + c.z1) / 2);
    // orient half-cylinder upward: rotate so the open side faces down
    shell.rotation.set(0, 0, Math.PI / 2);
    group.add(shell);
    colliders.push({ poly: normalizeWinding(P), bb: bbox(P), name: 'Crossrail Place' });
  }

  // ---- Jubilee line station canopies (glass clamshells) in Jubilee Park ----
  for (const [x, z, rot] of [[214, 0, 0], [326, 0, Math.PI]]) {
    const g = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    const shell = new THREE.Mesh(g, M.glassClear); shell.scale.set(13, 7.5, 17); shell.position.set(x, 0, z); shell.rotation.y = rot;
    const ribs = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.35, wireframe: true }));
    ribs.scale.copy(shell.scale).multiplyScalar(1.005); ribs.position.copy(shell.position);
    group.add(shell, ribs);
    colliders.push({ circle: [x, z, 12.5], bb: { x0: x - 13, x1: x + 13, z0: z - 17, z1: z + 17 }, name: 'Jubilee canopy' });
  }

  scene.add(group);
  group.add(buildSkyline(q));
  return { group, colliders, beacons };
}

// ---- distant city (jittered block grid, merged per facade style, no shadows) ----
function buildSkyline(q) {
  const r = mulberry32(77); const geos = {}; for (const s of STYLE_NAMES) geos[s] = [];
  const styles = ['stone', 'stoneWarm', 'brick', 'brick', 'brickModern', 'brickModern', 'glassGrey', 'glassBlue', 'resiGrey', 'resiWhite', 'glassDark'];
  const inCore = (x, z) => x > THAMES_EDGE_X - 10 && x < 830 && z > -430 && z < 610;
  const add = (x, z, w, d, h, style) => {
    const P = rectPoly(x, z, w, d);
    const g1 = prismSides(P, -0.5, () => h, Math.floor(r() * 16) * 1.5, Math.floor(r() * 12) * 4);
    g1.deleteAttribute('normal'); g1.computeVertexNormals();
    geos[style].push(g1);
    const roof = cap(P, h, true); roof.computeVertexNormals(); geos.__roof = geos.__roof || []; geos.__roof.push(roof);
  };
  const cell = 64, ext = 3600, dens = q.skyline / 750;
  for (let gx = -ext; gx < ext; gx += cell) for (let gz = -ext; gz < ext; gz += cell) {
    const cx = gx + cell / 2 + 150, cz = gz + cell / 2 + 80;
    const d = Math.hypot(cx - 150, cz - 80);
    if (d > ext) continue;
    const pBuild = (d < 1500 ? 0.9 : d < 2600 ? 0.65 : 0.4) * Math.min(1, dens);
    for (let k = 0; k < 2; k++) {
      if (r() > pBuild) continue;
      const w = 16 + r() * 26, dd = 14 + r() * 22;
      const x = cx + (r() - 0.5) * (cell - w - 10), z = cz + (r() - 0.5) * (cell - dd - 10);
      if (inCore(x, z)) continue;
      if (x > FAR_BANK_X - 40 && x < THAMES_EDGE_X + 30) continue; // river
      const tall = r() < 0.025; const h = tall ? 55 + r() * 100 : 8 + r() * r() * r() * 50 + r() * 6;
      add(x, z, w, dd, h, tall ? (r() < 0.6 ? 'glassBlue' : 'resiWhite') : styles[Math.floor(r() * styles.length)]);
    }
  }
  // City of London cluster to the west-north-west and a few landmark-scale silhouettes (very distant, in haze)
  const city = [[-4300, -900, 40, 40, 278], [-4250, -960, 35, 35, 230], [-4380, -840, 45, 30, 180], [-4200, -820, 30, 30, 200], [-4460, -980, 40, 40, 160], [-4100, -1020, 30, 30, 150], [-4550, -700, 50, 50, 120],
    [-4700, 900, 30, 30, 300], [-3000, 1500, 40, 40, 110], [2500, -1400, 40, 40, 90], [1500, 2400, 45, 45, 130], [-2600, -2600, 50, 40, 120]];
  for (const [x, z, w, d, h] of city) add(x, z, w, d, h, h > 250 ? 'glassGrey' : 'glassBlue');
  const g = new THREE.Group(); g.name = 'skyline';
  for (const s in geos) if (geos[s].length) { const m = new THREE.Mesh(mergeGeometries(geos[s]), s === '__roof' ? M.roof : FACADES[s]); m.castShadow = false; m.receiveShadow = false; g.add(m); }
  return g;
}
