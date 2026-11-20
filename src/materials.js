// Shared PBR materials built from the procedural textures.
import * as THREE from 'three';
import * as T from './textures.js';

export const M = {};
export const FACADES = {};
let NIGHT_EMISSIVE = []; // materials whose emissive intensity follows time of day

function std(o) { return new THREE.MeshStandardMaterial(o); }

export function buildMaterials(q) {
  const hi = q.texHi;
  // ---- facades ----
  for (const s of T.STYLE_NAMES) {
    const t = T.makeFacade(s, hi);
    for (const k of ['map', 'rm', 'normal', 'emissive']) t[k].repeat.set(1 / T.FACADE_TILE.w, 1 / T.FACADE_TILE.h);
    const m = std({
      map: t.map, roughnessMap: t.rm, metalnessMap: t.rm, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1),
      emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 1, metalness: 1,
    });
    m.userData.emissiveDay = 0.1; m.userData.emissiveGolden = 0.45; m.userData.emissiveNight = 1.5;
    m.name = 'facade_' + s;
    FACADES[s] = m; NIGHT_EMISSIVE.push(m);
  }
  {
    const t = T.makeLobby(hi);
    for (const k of ['map', 'rm', 'normal', 'emissive']) t[k].repeat.set(1 / T.LOBBY_TILE.w, 1 / T.LOBBY_TILE.h);
    M.lobby = std({ map: t.map, roughnessMap: t.rm, metalnessMap: t.rm, normalMap: t.normal, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 1, metalness: 1 });
    M.lobby.userData.emissiveDay = 0.3; M.lobby.userData.emissiveGolden = 0.8; M.lobby.userData.emissiveNight = 1.0; NIGHT_EMISSIVE.push(M.lobby);
  }
  const roof = T.makeRoof(); roof.repeat.set(1 / 16, 1 / 16);
  M.roof = std({ map: roof, roughness: 0.92, metalness: 0.0 });
  M.plant = std({ color: 0x8a8d90, roughness: 0.55, metalness: 0.6 });
  M.steelPanel = std({ color: 0xb8bcc2, roughness: 0.28, metalness: 1.0 });
  M.darkMetal = std({ color: 0x2a2c30, roughness: 0.45, metalness: 0.9 });
  M.whiteMetal = std({ color: 0xdedede, roughness: 0.4, metalness: 0.3 });

  // ---- ground ----
  const pav = T.makePaving(hi);
  for (const k of ['map', 'rm', 'normal']) pav[k].repeat.set(1 / pav.size, 1 / pav.size);
  M.paving = std({ map: pav.map, roughnessMap: pav.rm, normalMap: pav.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, metalness: 0 });
  M.paving.userData.wet = true;
  const flags = T.makeFlags();
  for (const k of ['map', 'normal']) flags[k].repeat.set(1 / flags.size, 1 / flags.size);
  M.footway = std({ map: flags.map, normalMap: flags.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  M.kerb = std({ map: T.makeKerb(), roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  M.kerb.map.repeat.set(1 / 3.6, 1 / 0.4);
  const mkRoad = (kind, w) => {
    const r = T.makeRoad(kind, w);
    for (const k of ['map', 'rm', 'normal']) r[k].repeat.set(1, 1 / r.length);
    const m = std({ map: r.map, roughnessMap: r.rm, normalMap: r.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return m;
  };
  M.roadMain = mkRoad('main', 12); M.roadMinor = mkRoad('minor', 9); M.roadRing = mkRoad('ring', 9);
  M.crossing = new THREE.MeshStandardMaterial({ map: T.makeCrossingDecal(12), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  M.crossing9 = new THREE.MeshStandardMaterial({ map: T.makeCrossingDecal(9), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  M.tactile = std({ color: 0xc9a46a, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const grass = T.makeGrass(); grass.map.repeat.set(1 / grass.size, 1 / grass.size);
  M.grass = std({ map: grass.map, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const quay = T.makeQuayWall(); quay.repeat.set(1 / 4, 1 / 6);
  M.quayWall = std({ map: quay, roughness: 0.9, metalness: 0 });
  M.coping = std({ color: 0xa8a49c, roughness: 0.65, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const conc = T.makeConcrete(91, 0.62); conc.repeat.set(1 / 6, 1 / 6);
  M.concrete = std({ map: conc, roughness: 0.85, metalness: 0 });
  const conc2 = T.makeConcrete(95, 0.26); conc2.repeat.set(1 / 40, 1 / 40);
  M.urbanGround = std({ map: conc2, roughness: 0.9, metalness: 0 });
  M.farLand = std({ color: 0x3d3a36, roughness: 0.95 });
  const lat = T.makeLattice(); lat.repeat.set(1 / 6, 1 / 6);
  M.lattice = std({ map: lat, alphaTest: 0.5, roughness: 0.7, side: THREE.DoubleSide });
  M.glassClear = new THREE.MeshPhysicalMaterial({ color: 0xbfd2dc, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.28, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false });
  M.railGlass = new THREE.MeshPhysicalMaterial({ color: 0xcfe0e4, metalness: 0.0, roughness: 0.08, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  M.steel = std({ color: 0x9a9da2, roughness: 0.35, metalness: 1.0 });
  M.blackPaint = std({ color: 0x151617, roughness: 0.45, metalness: 0.3 });
  M.redPaint = new THREE.MeshPhysicalMaterial({ color: 0xb01010, roughness: 0.32, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  M.timber = std({ color: 0x8a6440, roughness: 0.75 });
  M.deck = std({ color: 0x6d6a66, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 });
  M.waterFeature = std({ color: 0x223038, roughness: 0.02, metalness: 0.2 });
  const bark = T.makeBark(); bark.repeat.set(1, 2);
  M.bark = std({ map: bark, roughness: 0.9 });
  M.leaves = std({ map: T.makeLeafCluster(), alphaTest: 0.45, roughness: 0.8, side: THREE.DoubleSide });
  if (q.msaa > 0) M.leaves.alphaToCoverage = true;
  M.leavesDepth = new THREE.MeshDepthMaterial({ map: M.leaves.map, alphaTest: 0.45 });
  M.hedge = std({ color: 0x2f4a22, roughness: 0.9 });
  return M;
}

export function setMaterialsTime(p) {
  const key = p.night >= 1 ? 'emissiveNight' : p.night > 0 ? 'emissiveGolden' : 'emissiveDay';
  for (const m of NIGHT_EMISSIVE) m.emissiveIntensity = m.userData[key];
}
export function registerEmissive(m, day, golden, night) {
  m.userData.emissiveDay = day; m.userData.emissiveGolden = golden; m.userData.emissiveNight = night; NIGHT_EMISSIVE.push(m);
}
