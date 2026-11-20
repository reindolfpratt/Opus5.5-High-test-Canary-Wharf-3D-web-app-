// Atmosphere: physically based (Preetham) sky + night layer, sun/moon light, analytic height fog with sun in-scatter,
// and an environment cubemap captured from the actual scene (so glass reflects the sky AND the neighbouring towers).
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp } from './util.js';

export const TIMES = {
  day:    { label: 'Day',         az: 200, el: 42, turbidity: 4.6, rayleigh: 1.0, mie: 0.005, mieG: 0.8, sunI: 7.5, skyRatio: 2.5, exposure: 0.8, fog: 0.00055, clouds: 0.35, night: 0, wet: 0.08, env: 1.0, lamp: 0 },
  golden: { label: 'Golden hour', az: 248, el: 4.5, turbidity: 5.5, rayleigh: 2.2, mie: 0.006, mieG: 0.86, sunI: 4.2, skyRatio: 1.7, exposure: 0.8, fog: 0.0009, clouds: 0.3, night: 0.15, wet: 0.2, env: 1.0, lamp: 0.25 },
  night:  { label: 'Night',       az: 140, el: 34, turbidity: 2, rayleigh: 0.5, mie: 0.003, mieG: 0.8, sunI: 0.12, skyRatio: 1, exposure: 1.45, fog: 0.0008, clouds: 0.25, night: 1, wet: 0.45, env: 1.0, lamp: 1 },
};
export const TIME_ORDER = ['day', 'golden', 'night'];

export function dirFromAzEl(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  // compass azimuth: 0 = north (-z), 90 = east (+x)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

// ---- CPU port of the Preetham model used by three's Sky (for fog colour / light colour matching) ----
const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
function skyRadiance(dir, sun, p) {
  const EE = 1000, cutoff = 1.6110731556870734, steep = 1.5;
  const sunE = EE * Math.max(0, 1 - Math.exp(-((cutoff - Math.acos(clamp(sun.y, -1, 1))) / steep)));
  const c = 0.2 * p.turbidity * 10e-18;
  const bR = totalRayleigh.map((v) => v * p.rayleigh), bM = MieConst.map((v) => 0.434 * c * v * p.mie);
  const zen = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const Fex = [0, 1, 2].map((i) => Math.exp(-(bR[i] * sR + bM[i] * sM)));
  const cosT = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieG, g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const out = [0, 0, 0];
  const mixF = clamp(Math.pow(1 - sun.y, 5), 0, 1);
  for (let i = 0; i < 3; i++) {
    const ratio = (bR[i] * rPhase + bM[i] * mPhase) / (bR[i] + bM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5);
    Lin *= 1 + (Math.pow(sunE * ratio * Fex[i], 0.5) - 1) * mixF;
    out[i] = (Lin + 0.1 * Fex[i]) * 0.04 + [0, 0.0003, 0.00075][i];
  }
  return out;
}
function sunTransmittance(sun, p) {
  const c = 0.2 * p.turbidity * 10e-18;
  const zen = Math.acos(Math.max(0.0, sun.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(Math.max(0.01, 93.885 - (zen * 180) / Math.PI), -1.253));
  return [0, 1, 2].map((i) => Math.exp(-(totalRayleigh[i] * p.rayleigh * 8.4e3 * inv + 0.434 * c * MieConst[i] * p.mie * 1.25e3 * inv)));
}

// ---- Shared fog uniforms injected into every material ----
export const FOG_UNIFORMS = {
  uFogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uFogSunColor: { value: new THREE.Color(1, 1, 1) },
  uFogFalloff: { value: 0.0045 },
};

const FOG_VERT_PARS = '#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vFogWorldDir;\n#endif\n';
const FOG_VERT = '#include <fog_vertex>\n#ifdef USE_FOG\nvFogWorldDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif\n';
const FOG_FRAG_PARS = '#include <fog_pars_fragment>\n#ifdef USE_FOG\nvarying vec3 vFogWorldDir;\nuniform vec3 uFogSunDir;\nuniform vec3 uFogSunColor;\nuniform float uFogFalloff;\n#endif\n';
const FOG_FRAG = `
#ifdef USE_FOG
{
  float fdist = length(vFogWorldDir);
  vec3 fdir = vFogWorldDir / max(fdist, 1e-4);
  float rayY = fdir.y * fdist * uFogFalloff;
  float integ = abs(rayY) > 1e-4 ? (1.0 - exp(-rayY)) / rayY : 1.0;
  #ifdef FOG_EXP2
    float fogAmt = fogDensity * exp(-uFogFalloff * max(cameraPosition.y, 0.0)) * fdist * integ;
  #else
    float fogAmt = smoothstep(fogNear, fogFar, fdist);
  #endif
  float fogF = 1.0 - exp(-fogAmt);
  float sunAmt = pow(max(dot(fdir, uFogSunDir), 0.0), 7.0);
  vec3 fcol = mix(fogColor, uFogSunColor, sunAmt);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol * (gl_FragColor.a > 0.0 ? 1.0 : 1.0), fogF);
}
#endif
`;

export function patchFogShader(shader) {
  if (!shader.vertexShader.includes('#include <fog_vertex>')) return;
  shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', FOG_VERT_PARS).replace('#include <fog_vertex>', FOG_VERT);
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', FOG_FRAG_PARS).replace('#include <fog_fragment>', FOG_FRAG);
  Object.assign(shader.uniforms, FOG_UNIFORMS);
}

// Wrap a material so it gets the fog patch (keeping any existing onBeforeCompile and cache key)
export function applyFogPatch(mat) {
  if (!mat || mat.userData.fogPatched) return;
  mat.userData.fogPatched = true;
  const inner = mat.onBeforeCompile;
  const innerKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
  mat.onBeforeCompile = function (shader, renderer) {
    if (inner) inner.call(this, shader, renderer);
    patchFogShader(shader);
  };
  mat.customProgramCacheKey = () => innerKey + '|hfog';
  mat.needsUpdate = true;
}

export function patchSceneMaterials(root) {
  root.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.fog !== false) applyFogPatch(m); });
    if (o.customDepthMaterial) { /* depth materials do not use fog */ }
  });
}

// ---- Sky with a night layer (stars, moon, London light pollution) ----
function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.uNight = { value: 0 };
  u.uSkyScale = { value: 1 };
  u.uSkyDesat = { value: 0 };
  u.uMoonDir = { value: dirFromAzEl(140, 34) };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float time;', `uniform float time;
      uniform float uNight; uniform vec3 uMoonDir; uniform float uSkyScale; uniform float uSkyDesat;
      float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }`)
    .replace('gl_FragColor = vec4( texColor, 1.0 );', `
      texColor *= uSkyScale;
      texColor = mix(texColor, vec3(dot(texColor, vec3(0.2126, 0.7152, 0.0722))), uSkyDesat);
      if (uNight > 0.0) {
        float h = max(direction.y, 0.0);
        // light-polluted London night: brownish orange glow near the horizon, deep blue overhead
        vec3 night = mix(vec3(0.030, 0.020, 0.013), vec3(0.0016, 0.0022, 0.0055), smoothstep(0.0, 0.45, h));
        night += vec3(0.010, 0.006, 0.003) * exp(-h * 12.0);
        // stars (few, the city washes most out)
        vec3 sd = floor(direction * 420.0);
        float st = hash13(sd);
        float star = step(0.9985, st) * smoothstep(0.08, 0.35, h) * (0.4 + 0.6 * hash13(sd + 7.0));
        night += vec3(star) * 0.25;
        // moon
        float mc = dot(direction, normalize(uMoonDir));
        night += vec3(0.9, 0.92, 1.0) * smoothstep(0.99985, 0.99992, mc) * 2.5;
        night += vec3(0.05, 0.06, 0.08) * pow(max(mc, 0.0), 300.0) * 0.6;
        texColor = mix(texColor, night + texColor * 0.2, uNight);
      }
      gl_FragColor = vec4( texColor, 1.0 );`);
  sky.material.needsUpdate = true;
  sky.frustumCulled = false;
  return sky;
}

export class Atmosphere {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.sky = makeSky(); scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025; this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 2600;
    this.sun.shadow.camera.layers.enableAll();
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8899bb, 0x443322, 0.0); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0006);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.key = 'day'; this.p = TIMES.day; this.time = 0;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 6000, this.cubeRT);
    this.cubeCam.position.set(90, 45, 60);
    scene.add(this.cubeCam);
    this.envRT = null;
    this.shadowRadius = 260;
  }

  set(key) {
    this.key = key; const p = (this.p = TIMES[key]);
    const night = p.night >= 1;
    const sunDir = dirFromAzEl(p.az, p.el);
    this.sunDir.copy(sunDir);
    const u = this.sky.material.uniforms;
    // In night mode the sky model's sun goes well below the horizon; the light is the moon.
    const skySun = night ? dirFromAzEl(p.az, -18) : sunDir;
    u.sunPosition.value.copy(skySun);
    u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh; u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = p.mieG;
    u.cloudCoverage.value = p.clouds; u.cloudDensity.value = 0.45; u.cloudScale.value = 0.00025; u.cloudSpeed.value = 0.00003;
    u.uNight.value = p.night >= 1 ? 1 : 0;
    u.uMoonDir.value.copy(sunDir);
    u.showSunDisc.value = night ? 0 : 1;
    u.uSkyDesat.value = key === 'day' ? 0.28 : key === 'golden' ? 0.08 : 0;

    // light colour = sky model transmittance along the sun ray
    const T = sunTransmittance(skySun, p);
    const horizon = [0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2; const d = new THREE.Vector3(Math.cos(a), 0.035, Math.sin(a)).normalize();
      const c = skyRadiance(d, skySun, p); horizon[0] += c[0] / 8; horizon[1] += c[1] / 8; horizon[2] += c[2] / 8;
    }
    const toward = skyRadiance(new THREE.Vector3(skySun.x, 0.04, skySun.z).normalize(), skySun, p);
    const scene = this.scene;
    if (!night) {
      const tmax = Math.max(...T);
      // soften the very saturated low-sun transmittance (real sunset light reads orange, not pure red)
      const sunCol = new THREE.Color(Math.pow(T[0] / tmax, 0.55), Math.pow(T[1] / tmax, 0.55), Math.pow(T[2] / tmax, 0.55));
      const hl = (horizon[0] + horizon[1] + horizon[2]) / 3;
      // Normalise the sky so a sunlit white lambertian surface is skyRatio x brighter than the horizon (real-world ratio)
      const skyScale = (p.sunI * 0.85 / (p.skyRatio * Math.PI)) / Math.max(hl, 1e-4);
      this.skyScale = skyScale;
      u.uSkyScale.value = skyScale;
      this.sun.color.copy(sunCol); this.sun.intensity = p.sunI;
      scene.fog.color.setRGB(horizon[0] * skyScale, horizon[1] * skyScale, horizon[2] * skyScale);
      FOG_UNIFORMS.uFogSunColor.value.setRGB(toward[0] * skyScale, toward[1] * skyScale, toward[2] * skyScale);
      this.hemi.intensity = 0.0;
    } else {
      u.uSkyScale.value = 1; this.skyScale = 1;
      this.sun.color.setRGB(0.55, 0.65, 0.95); this.sun.intensity = p.sunI;
      scene.fog.color.setRGB(0.024, 0.017, 0.013);
      FOG_UNIFORMS.uFogSunColor.value.setRGB(0.03, 0.03, 0.035);
      this.hemi.color.setRGB(0.25, 0.3, 0.45); this.hemi.groundColor.setRGB(0.25, 0.17, 0.1); this.hemi.intensity = 0.25;
    }
    scene.fog.density = p.fog;
    FOG_UNIFORMS.uFogSunDir.value.copy(night ? sunDir : skySun);
    scene.environmentIntensity = p.env;
    this.horizon = horizon;
  }

  // Capture the actual scene (sky + towers + lit windows) into a cubemap and prefilter it for IBL.
  captureEnvironment() {
    const r = this.renderer;
    const prevEnv = this.scene.environment;
    this.cubeCam.update(r, this.scene);
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.scene.environment = rt.texture;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    if (prevEnv && prevEnv !== rt.texture && !this.envRT) prevEnv.dispose?.();
  }

  update(dt, playerPos) {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time;
    // shadow frustum follows the player, snapped to texels to avoid shimmering
    const R = this.shadowRadius;
    const cam = this.sun.shadow.camera;
    if (cam.right !== R) { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.updateProjectionMatrix(); }
    const texel = (2 * R) / this.sun.shadow.mapSize.x;
    const c = new THREE.Vector3(playerPos.x, 0, playerPos.z);
    // snap in light space
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    c.applyMatrix4(inv); c.x = Math.round(c.x / texel) * texel; c.y = Math.round(c.y / texel) * texel; c.applyMatrix4(lightRot);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 1300);
    this.sun.target.updateMatrixWorld();
  }
}
