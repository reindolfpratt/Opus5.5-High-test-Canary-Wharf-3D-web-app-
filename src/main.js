import * as THREE from 'three';
import { pickQuality, saveQuality, QUALITY } from './config.js';
import { setMaxAniso } from './textures.js';
import { buildMaterials, setMaterialsTime, M } from './materials.js';
import { Atmosphere, TIMES, TIME_ORDER, patchSceneMaterials } from './sky.js';
import { buildGround } from './world/ground.js';
import { buildRoadData, buildRoadMeshes, HeightField } from './world/roads.js';
import { buildBuildings } from './world/buildings.js';
import { buildFurniture } from './world/furniture.js';
import { buildDLR } from './world/dlr.js';
import { Traffic, signalState } from './traffic.js';
import { Crowd } from './crowd.js';
import { Pipeline } from './post.js';
import { Player } from './controls.js';
import { CityAudio } from './audio.js';
import { UI } from './ui.js';
import { SPAWN, PARKS } from './layout.js';
import { mergeStatic } from './world/merge.js';

const params = new URLSearchParams(location.search);
const loading = document.getElementById('loading');
const setLoad = (t) => { loading.querySelector('.msg').textContent = t; };
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// Post-processing look per time of day
const LOOK = {
  day: { bloom: 0.18, bloomThreshold: 1.6, gain: new THREE.Vector3(1.0, 1.0, 1.0), lift: new THREE.Vector3(0, 0, 0), saturation: 1.06, sunStrength: 0.45, rayTint: new THREE.Color(1, 0.95, 0.88) },
  golden: { bloom: 0.3, bloomThreshold: 1.4, gain: new THREE.Vector3(1.0, 0.99, 0.97), lift: new THREE.Vector3(0.002, 0.001, 0.0), saturation: 1.02, sunStrength: 0.9, rayTint: new THREE.Color(1, 0.75, 0.5) },
  night: { bloom: 0.38, bloomThreshold: 1.25, gain: new THREE.Vector3(0.96, 0.99, 1.06), lift: new THREE.Vector3(0.0015, 0.0018, 0.003), saturation: 1.0, sunStrength: 0, rayTint: new THREE.Color(1, 1, 1) },
};

async function main() {
  const q = pickQuality();
  const canvas = document.getElementById('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { setLoad('WebGL2 is required but could not be initialised in this browser.'); return; }
  if (!renderer.capabilities.isWebGL2) { setLoad('WebGL2 is required.'); return; }
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  setMaxAniso(Math.min(16, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, 6000);
  camera.layers.enable(1);

  setLoad('Generating materials…'); await tick();
  buildMaterials(q);
  const atmo = new Atmosphere(renderer, scene);
  atmo.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); atmo.sun.shadow.radius = q.shadowSoft; atmo.shadowRadius = q.shadowRadius;

  setLoad('Laying out the docks…'); await tick();
  const { water } = buildGround(scene, q);
  const net = buildRoadData();
  buildRoadMeshes(scene, net);
  const hf = new HeightField(net);

  setLoad('Raising the towers…'); await tick();
  const bld = buildBuildings(scene, q);
  const dlr = buildDLR(scene);
  setLoad('Street furniture & trees…'); await tick();
  const fur = buildFurniture(scene, q, net, bld.colliders);

  // aviation obstruction lights
  const beaconMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), bld.beacons.length);
  bld.beacons.forEach(([x, y, z], i) => beaconMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)));
  beaconMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bld.beacons.length * 3), 3);
  scene.add(beaconMesh);

  setLoad('Traffic & people…'); await tick();
  const colliders = [...bld.colliders, ...fur.colliders, ...dlr.colliders];
  const traffic = new Traffic(scene, net, q);
  const crowd = new Crowd(scene, net, hf, colliders, q);

  // nearest-lamp real point lights (night)
  const pLights = [];
  for (let i = 0; i < q.pointLights; i++) { const l = new THREE.PointLight(0xffd8b0, 0, 38, 2); scene.add(l); pLights.push(l); }

  // static batching (keeps per-chunk frustum culling)
  for (const n of ['buildings', 'roads', 'ground', 'dlr', 'furniture']) { const g = scene.getObjectByName(n); if (g) mergeStatic(g, 420); }
  patchSceneMaterials(scene);

  const pipeline = new Pipeline(renderer, scene, camera, q);
  const player = new Player(camera, renderer.domElement, hf, colliders);
  const audio = new CityAudio();
  player.onStep = (i) => audio.footstep(i);
  const ui = new UI(); ui.drawRoads(net);

  // camera override for automated screenshots: ?cam=x,y,z,yawDeg,pitchDeg
  const camParam = params.get('cam');
  if (camParam) { const [x, y, z, yaw, pitch] = camParam.split(',').map(Number); player.place(x, z, THREE.MathUtils.degToRad(yaw || 0), THREE.MathUtils.degToRad(pitch || 0), y); if (y > 3) player.fly = true; }
  else player.place(SPAWN.x, SPAWN.z, SPAWN.yaw, 0.08);

  let timeKey = TIMES[params.get('time')] ? params.get('time') : 'day';
  const applyTime = (k) => {
    timeKey = k; const p = TIMES[k];
    atmo.set(k); setMaterialsTime(p);
    fur.poolMat.opacity = p.lamp >= 1 ? 0.32 : p.lamp > 0 ? 0.06 : 0;
    traffic.setNight(p.night);
    audio.setNight(p.night);
    const wu = water.material.uniforms;
    wu.sunDirection.value.copy(atmo.sunDir);
    wu.sunColor.value.copy(atmo.sun.color).multiplyScalar(p.night >= 1 ? 0.25 : Math.min(1.4, atmo.sun.intensity / 3.5));
    wu.waterColor.value.setRGB(...(p.night >= 1 ? [0.004, 0.006, 0.006] : p.night > 0 ? [0.05, 0.05, 0.04] : [0.06, 0.085, 0.075]));
    for (const l of pLights) l.intensity = p.lamp >= 1 ? 90 : p.lamp > 0 ? 20 : 0;
    // update env: needs current lighting in the scene
    atmo.update(0, camera.position);
    atmo.captureEnvironment(); atmo.captureEnvironment();
  };
  applyTime(timeKey);

  // ---- input ----
  const started = { v: false };
  const begin = () => { audio.start(); started.v = true; ui.showOverlay(false); setTimeout(() => document.getElementById('hint').classList.add('dim'), 12000); };
  ui.buildCompareList((l) => {
    const [x, z, hdg, pitch] = l.view;
    if (player.fly) player.toggleFly();
    player.place(x, z, THREE.MathUtils.degToRad(-hdg), THREE.MathUtils.degToRad(pitch));
    player.controls.lock(); begin();
  });
  document.getElementById('overlay').addEventListener('click', () => { player.controls.lock(); begin(); });
  renderer.domElement.addEventListener('click', () => { if (!player.controls.isLocked) player.controls.lock(); });
  player.controls.addEventListener('unlock', () => ui.showOverlay(true));
  player.controls.addEventListener('lock', () => ui.showOverlay(false));
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyN') applyTime(TIME_ORDER[(TIME_ORDER.indexOf(timeKey) + 1) % TIME_ORDER.length]);
    if (e.code === 'KeyF') player.toggleFly();
    if (e.code === 'KeyB') pipeline.dofOn = !pipeline.dofOn;
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
    if (e.code === 'KeyH') ui.toggle();
    if (e.code === 'KeyG') window.open(ui.hereURL(camera), '_blank', 'noopener');
    const qk = { Digit1: 'low', Digit2: 'high', Digit3: 'ultra' }[e.code];
    if (qk && qk !== q.key) { saveQuality(qk); const u = new URL(location.href); u.searchParams.set('q', qk); location.href = u.toString(); }
  });
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); pipeline.resize(); });
  if (params.get('auto')) { ui.showOverlay(false); started.v = true; }
  if (params.get('dof') === '1') pipeline.dofOn = true;

  loading.style.display = 'none';
  window.__cw = { scene, camera, renderer, pipeline, traffic, crowd, applyTime, player, atmo };

  // ---- loop ----
  let lastT = performance.now();
  let adaptT = 0, adaptFrames = 0;
  const dynRes = params.get('dynres') !== '0';
  let T = 0, lightTimer = 0;
  const lampPos = fur.lampPos;
  const sigCol = { R: [6, 0.15, 0.05], A: [6, 2.6, 0.05], G: [0.1, 5, 1.6], man: [0.6, 5, 2.2], stop: [6, 0.2, 0.1] };
  const parks = PARKS.map((p) => { const xs = p.poly.map((v) => v[0]), zs = p.poly.map((v) => v[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]; });
  const frame = () => {
    const now = performance.now(); const rawDt = (now - lastT) / 1000; const dt = Math.min(0.1, rawDt); lastT = now; T += dt;
    adaptT += rawDt; adaptFrames++;
    if (adaptT > 2.5) { if (dynRes && started.v) pipeline.adapt(adaptFrames / adaptT); adaptT = 0; adaptFrames = 0; }
    if (started.v) player.update(dt);
    traffic.update(dt);
    crowd.update(dt, traffic.T, camera.position);
    dlr.update(dt);
    atmo.update(dt, camera.position);
    water.material.uniforms.time.value += dt * 0.6;
    // signals
    const lm = fur.lampMesh, c = new THREE.Color();
    fur.lamps.forEach((l, i) => {
      const st = signalState(net.crossings[l.c], traffic.T);
      let on = false;
      if (l.kind === 'R') on = st.car === 'R' || st.car === 'RA';
      else if (l.kind === 'A') on = st.car === 'A' || st.car === 'RA';
      else if (l.kind === 'G') on = st.car === 'G';
      else if (l.kind === 'man') on = st.ped === 'walk' || (st.ped === 'flash' && Math.floor(T * 3) % 2 === 0);
      else if (l.kind === 'stop') on = st.ped === 'stop';
      const k = sigCol[l.kind]; const f = on ? 1 : 0.025;
      lm.setColorAt(i, c.setRGB(k[0] * f, k[1] * f, k[2] * f));
    });
    lm.instanceColor.needsUpdate = true;
    // aviation lights: red blink ~1 Hz, OCS white strobe
    bld.beacons.forEach((b, i) => {
      const red = b[3] === 'red'; const on = red ? Math.sin(T * 2 * Math.PI * 0.8) > 0 : (T % 1.6) < 0.08;
      const k = TIMES[timeKey].night >= 1 ? 1 : 0.5;
      beaconMesh.setColorAt(i, c.setRGB(...(red ? (on ? [14 * k, 0.4, 0.2] : [0.15, 0, 0]) : (on ? [30, 30, 30] : [0.1, 0.1, 0.1]))));
    });
    beaconMesh.instanceColor.needsUpdate = true;
    if (fur.fountain) fur.fountain.scale.y = 1 + Math.sin(T * 1.7) * 0.12;
    // nearest street lamps get real point lights
    lightTimer -= dt;
    if (lightTimer <= 0 && pLights.length && TIMES[timeKey].lamp > 0) {
      lightTimer = 0.3; const cp = camera.position;
      const near = lampPos.map((p, i) => [(p[0] - cp.x) ** 2 + (p[2] - cp.z) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, pLights.length);
      near.forEach(([, i], k) => pLights[k].position.set(lampPos[i][0], lampPos[i][1] - 0.3, lampPos[i][2]));
    }
    const P = TIMES[timeKey], L = LOOK[timeKey];
    pipeline.render(dt, { sunDir: P.night >= 1 ? null : atmo.sunDir, sunStrength: L.sunStrength, rayTint: L.rayTint, wet: P.wet, exposure: P.exposure, bloom: L.bloom, bloomThreshold: L.bloomThreshold, gain: L.gain, lift: L.lift, saturation: L.saturation });
    // audio context
    let trainDist = 1e9; for (const t of dlr.trains) trainDist = Math.min(trainDist, Math.hypot(t.g.position.x - camera.position.x, t.g.position.y - camera.position.y, t.g.position.z - camera.position.z));
    let parkDist = 1e9; for (const [x, z] of parks) parkDist = Math.min(parkDist, Math.hypot(x - camera.position.x, z - camera.position.z));
    audio.update(dt, { trainDist, parkDist });
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    ui.update(dt, { quality: q.name + (pipeline.resScale < 1 ? ` · ${Math.round(pipeline.resScale * 100)}% res` : ''), time: P.label, fly: player.fly, dof: pipeline.dofOn, muted: audio.muted, x: camera.position.x, z: camera.position.z, yaw: -e.y, cam: camera });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((e) => { console.error(e); setLoad('Error: ' + e.message); });
