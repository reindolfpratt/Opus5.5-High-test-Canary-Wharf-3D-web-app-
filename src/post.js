// HDR render pipeline: MSAA scene RT (+depth) -> SSAO -> composite (AO, SSR wet ground, god rays, exposure)
// -> camera motion blur -> depth of field -> bloom -> ACES filmic tone mapping + grade -> (FXAA on Low).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const DEPTH_FN = /* glsl */`
uniform sampler2D tDepth; uniform mat4 projInv; uniform mat4 proj;
float rawDepth(vec2 uv){ return texture2D(tDepth, uv).x; }
vec3 viewPos(vec2 uv){ float d = rawDepth(uv); vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
vec3 viewPosD(vec2 uv, float d){ vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 normalFromDepth(vec2 uv, vec3 P, vec2 px){
  vec3 r = viewPos(uv + vec2(px.x, 0.0)), l = viewPos(uv - vec2(px.x, 0.0));
  vec3 u = viewPos(uv + vec2(0.0, px.y)), d = viewPos(uv - vec2(0.0, px.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
  vec3 dy = abs(u.z - P.z) < abs(P.z - d.z) ? u - P : P - d;
  return normalize(cross(dx, dy));
}`;

function shader(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

const AO_FRAG = /* glsl */`
varying vec2 vUv; uniform vec2 resolution; uniform float radius; uniform float intensity;
${DEPTH_FN}
void main(){
  float d = rawDepth(vUv);
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / resolution;
  vec3 N = normalFromDepth(vUv, P, px);
  float rs = radius * proj[1][1] * 0.5 / -P.z;
  rs = min(rs, 0.08);
  if (rs < px.y * 1.5) { gl_FragColor = vec4(1.0); return; }
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  const int NS = 12;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + 0.5) / float(NS);
    float a = ang + float(i) * 2.39996323;
    vec2 off = vec2(cos(a) * resolution.y / resolution.x, sin(a)) * rs * sqrt(fi);
    vec3 Q = viewPos(vUv + off);
    vec3 v = Q - P; float vv = dot(v, v); float vn = dot(v, N);
    float fall = clamp(1.0 - vv / (radius * radius * 4.0), 0.0, 1.0);
    sum += max(0.0, vn - 0.015 * -P.z * 0.05 - 0.02) / (vv + 0.02) * fall;
  }
  float ao = clamp(1.0 - intensity * radius * sum / float(NS), 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

const RAYS_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tColor; uniform vec2 sunUV; uniform float strength; uniform vec3 tint;
uniform sampler2D tDepth;
void main(){
  vec2 dir = sunUV - vUv;
  float L = length(dir);
  const int NS = 40;
  vec2 st = dir / float(NS) * min(1.0, 0.9 / max(L, 1e-3)) * min(L, 0.9);
  vec2 p = vUv + st * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 acc = vec3(0.0); float w = 1.0;
  for (int i = 0; i < NS; i++) {
    p += st;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
    float sky = step(0.99999, texture2D(tDepth, p).x);
    vec3 c = min(texture2D(tColor, p).rgb, vec3(4.0));
    acc += c * sky * w; w *= 0.962;
  }
  gl_FragColor = vec4(acc / float(NS) * strength * tint, 1.0);
}`;

const COMP_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tAO; uniform sampler2D tRays;
uniform vec2 resolution; uniform float aoOn; uniform float aoStrength; uniform float raysOn;
uniform float ssrOn; uniform float wet; uniform mat4 viewInv; uniform float exposure;
${DEPTH_FN}
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = rawDepth(vUv);
  vec2 px = 1.0 / resolution;
  if (d < 0.99999) {
    vec3 P = viewPosD(vUv, d);
    if (aoOn > 0.5) {
      // depth-aware 3x3 blur of the half-res AO
      float acc = 0.0, wsum = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)) * px * 2.0;
        float z = viewPos(vUv + o).z;
        float w = 1.0 / (0.05 + abs(z - P.z) * 2.0);
        acc += texture2D(tAO, vUv + o).r * w; wsum += w;
      }
      float ao = acc / wsum;
      col *= mix(1.0, ao, aoStrength);
    }
    if (ssrOn > 0.5 && wet > 0.0) {
      vec3 N = normalFromDepth(vUv, P, px);
      vec3 Nw = mat3(viewInv) * N;
      vec3 W = (viewInv * vec4(P, 1.0)).xyz;
      float dist = length(P);
      if (Nw.y > 0.93 && W.y > -1.0 && dist < 260.0) {
        vec3 V = normalize(P);
        // tiny normal perturbation (puddle ripples / uneven paving) to break up the mirror
        vec3 R = normalize(reflect(V, N));
        vec3 pos = P; float stepL = 0.25 + dist * 0.012;
        vec2 hit = vec2(-1.0); float fadeI = 0.0;
        for (int i = 0; i < 36; i++) {
          pos += R * stepL; stepL *= 1.09;
          vec4 c = proj * vec4(pos, 1.0); vec2 suv = c.xy / c.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0 || c.w < 0.0) break;
          float sz = viewPos(suv).z;
          float diff = sz - pos.z;
          if (diff > 0.0 && diff < stepL * 2.0 + 0.3) {
            // refine
            vec3 a = pos - R * stepL, b = pos;
            for (int k = 0; k < 5; k++) { vec3 m = (a + b) * 0.5; vec4 cm = proj * vec4(m, 1.0); vec2 mu = cm.xy / cm.w * 0.5 + 0.5; if (viewPos(mu).z > m.z) b = m; else a = m; }
            vec4 cb = proj * vec4(b, 1.0); hit = cb.xy / cb.w * 0.5 + 0.5; fadeI = float(i) / 36.0; break;
          }
        }
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        if (hit.x >= 0.0) {
          vec2 e = smoothstep(0.0, 0.08, hit) * smoothstep(1.0, 0.92, hit);
          float amt = wet * mix(0.2, 1.0, fres) * e.x * e.y * (1.0 - fadeI) * smoothstep(260.0, 120.0, dist);
          vec3 refl = texture2D(tColor, hit).rgb;
          col = col * (1.0 - amt * 0.6) + refl * amt;
        }
      }
    }
  }
  if (raysOn > 0.5) col += texture2D(tRays, vUv).rgb;
  col = min(col, vec3(20.0));
  gl_FragColor = vec4(col * exposure, 1.0);
}`;

const MB_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 viewProjInv; uniform mat4 prevViewProj; uniform float strength;
void main(){
  float d = texture2D(tDepth, vUv).x;
  vec4 wp = viewProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); wp /= wp.w;
  vec4 pp = prevViewProj * wp; vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
  vec2 vel = (vUv - puv) * strength;
  float l = length(vel); if (l > 0.03) vel *= 0.03 / l;
  vec3 c = texture2D(tColor, vUv).rgb;
  if (l < 0.0006) { gl_FragColor = vec4(c, 1.0); return; }
  vec3 acc = c; float n = 1.0;
  for (int i = 1; i < 8; i++) { float t = float(i) / 7.0 - 0.5; acc += texture2D(tColor, vUv - vel * t).rgb; n += 1.0; }
  gl_FragColor = vec4(acc / n, 1.0);
}`;

const DOF_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tColor; uniform vec2 resolution; uniform float aperture; uniform float maxBlur;
${DEPTH_FN}
void main(){
  float z = -viewPos(vUv).z;
  float f = -viewPos(vec2(0.5)).z;
  f = clamp(f, 2.0, 400.0);
  float coc = clamp((z - f) / z * aperture, 0.0, 1.0) * maxBlur; // only background blur (filmic, avoids foreground halos)
  vec3 c = texture2D(tColor, vUv).rgb;
  if (coc < 0.6) { gl_FragColor = vec4(c, 1.0); return; }
  vec3 acc = c; float w = 1.0;
  for (int i = 0; i < 16; i++) {
    float r = sqrt((float(i) + 0.5) / 16.0) * coc; float a = float(i) * 2.39996;
    vec2 o = vec2(cos(a), sin(a)) * r / resolution;
    float zs = -viewPos(vUv + o).z; float cs = clamp((zs - f) / zs * aperture, 0.0, 1.0) * maxBlur;
    float ww = smoothstep(r - 1.0, r, cs);
    acc += texture2D(tColor, vUv + o).rgb * ww; w += ww;
  }
  gl_FragColor = vec4(acc / w, 1.0);
}`;

const FINAL_FRAG = /* glsl */`
varying vec2 vUv; uniform sampler2D tColor; uniform float time; uniform vec3 gain; uniform vec3 lift; uniform float saturation; uniform float vignette;
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color){
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6; color = IN * color; color = RRTAndODTFit(color); color = OUT * color; return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
void main(){
  vec3 c = texture2D(tColor, vUv).rgb;
  c = c * gain + lift;
  c = aces(max(c, 0.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  float v = smoothstep(1.25, 0.25, length((vUv - 0.5) * vec2(1.25, 1.0)));
  c *= mix(1.0, v, vignette);
  c = toSRGB(c);
  c += (hash(vUv * 1000.0) - 0.5) / 255.0 * 1.5; // dither + fine grain
  gl_FragColor = vec4(c, 1.0);
}`;

export class Pipeline {
  constructor(renderer, scene, camera, q) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.quad = new FullScreenQuad(null);
    this.prevViewProj = new THREE.Matrix4(); this.first = true;
    this.mats = {
      ao: shader(AO_FRAG, { tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, proj: { value: new THREE.Matrix4() }, resolution: { value: new THREE.Vector2() }, radius: { value: 1.6 }, intensity: { value: 1.1 } }),
      rays: shader(RAYS_FRAG, { tColor: { value: null }, tDepth: { value: null }, sunUV: { value: new THREE.Vector2() }, strength: { value: 0 }, tint: { value: new THREE.Color(1, 0.9, 0.8) } }),
      comp: shader(COMP_FRAG, { tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, tRays: { value: null }, projInv: { value: new THREE.Matrix4() }, proj: { value: new THREE.Matrix4() }, viewInv: { value: new THREE.Matrix4() }, resolution: { value: new THREE.Vector2() }, aoOn: { value: 1 }, aoStrength: { value: 0.85 }, raysOn: { value: 1 }, ssrOn: { value: 0 }, wet: { value: 0 }, exposure: { value: 1 } }),
      mb: shader(MB_FRAG, { tColor: { value: null }, tDepth: { value: null }, viewProjInv: { value: new THREE.Matrix4() }, prevViewProj: { value: new THREE.Matrix4() }, strength: { value: 0.5 } }),
      dof: shader(DOF_FRAG, { tColor: { value: null }, tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, proj: { value: new THREE.Matrix4() }, resolution: { value: new THREE.Vector2() }, aperture: { value: 0.9 }, maxBlur: { value: 5 } }),
      final: shader(FINAL_FRAG, { tColor: { value: null }, time: { value: 0 }, gain: { value: new THREE.Vector3(1, 1, 1) }, lift: { value: new THREE.Vector3(0, 0, 0) }, saturation: { value: 1.05 }, vignette: { value: 0.3 } }),
      fxaa: new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false }),
    };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.9);
    this.dofOn = false;
    this.setQuality(q);
  }

  setQuality(q) {
    this.q = q;
    this.resScale = 1;
    this.applyPixelRatio();
  }

  applyPixelRatio() { this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio) * this.resScale); this.resize(); }
  // dynamic resolution: keep frame rate >= ~30 by trimming render resolution
  adapt(fps) {
    const prev = this.resScale;
    if (fps < 29 && this.resScale > 0.6) this.resScale = Math.max(0.6, this.resScale - 0.1);
    else if (fps > 52 && this.resScale < 1) this.resScale = Math.min(1, this.resScale + 0.05);
    if (prev !== this.resScale) this.applyPixelRatio();
  }

  resize() {
    const r = this.renderer; const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, size.x), h = Math.max(2, size.y);
    this.w = w; this.h = h;
    for (const k of ['sceneRT', 'aoRT', 'raysRT', 'hdrA', 'hdrB', 'ldr']) if (this[k]) this[k].dispose();
    const dt = new THREE.DepthTexture(w, h); dt.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.msaa, depthTexture: dt, depthBuffer: true });
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    this.aoRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.raysRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.hdrA = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.hdrB = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.ldr = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.bloom.setSize(w, h);
    this.mats.ao.uniforms.resolution.value.set(w, h);
    this.mats.comp.uniforms.resolution.value.set(w, h);
    this.mats.dof.uniforms.resolution.value.set(w, h);
    this.mats.fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  pass(mat, target) { this.quad.material = mat; this.renderer.setRenderTarget(target); this.quad.render(this.renderer); }

  render(dt, env) {
    const r = this.renderer, cam = this.camera, q = this.q, M = this.mats;
    cam.updateMatrixWorld();
    // 1. scene
    r.setRenderTarget(this.sceneRT); r.clear(); r.render(this.scene, cam);
    const depth = this.sceneRT.depthTexture, color = this.sceneRT.texture;
    const projInv = cam.projectionMatrixInverse, proj = cam.projectionMatrix;
    // 2. AO
    if (q.ssao) { const u = M.ao.uniforms; u.tDepth.value = depth; u.projInv.value.copy(projInv); u.proj.value.copy(proj); this.pass(M.ao, this.aoRT); }
    // 3. god rays (sun on/near screen)
    let raysOn = 0;
    if (q.godRays && env.sunDir && env.sunStrength > 0) {
      const sp = env.sunDir.clone().multiplyScalar(5000).add(cam.position).project(cam);
      const facing = cam.getWorldDirection(new THREE.Vector3()).dot(env.sunDir);
      if (facing > 0.05 && sp.z < 1) {
        const u = M.rays.uniforms; u.tColor.value = color; u.tDepth.value = depth; u.sunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
        const onScreen = Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) * 0.6);
        u.strength.value = env.sunStrength * onScreen * Math.min(1, facing * 2.5); u.tint.value.copy(env.rayTint);
        this.pass(M.rays, this.raysRT); raysOn = 1;
      }
    }
    // 4. composite
    { const u = M.comp.uniforms; u.tColor.value = color; u.tDepth.value = depth; u.tAO.value = this.aoRT.texture; u.tRays.value = this.raysRT.texture;
      u.projInv.value.copy(projInv); u.proj.value.copy(proj); u.viewInv.value.copy(cam.matrixWorld);
      u.aoOn.value = q.ssao ? 1 : 0; u.raysOn.value = raysOn; u.ssrOn.value = q.ssr ? 1 : 0; u.wet.value = env.wet; u.exposure.value = env.exposure;
      this.pass(M.comp, this.hdrA); }
    let cur = this.hdrA, other = this.hdrB;
    // 5. motion blur (camera)
    const viewProj = new THREE.Matrix4().multiplyMatrices(proj, cam.matrixWorldInverse);
    if (q.motionBlur && !this.first) {
      const u = M.mb.uniforms; u.tColor.value = cur.texture; u.tDepth.value = depth;
      u.viewProjInv.value.copy(viewProj).invert(); u.prevViewProj.value.copy(this.prevViewProj);
      u.strength.value = Math.min(1.0, (1 / 60) / Math.max(dt, 1e-3)) * 0.55;
      this.pass(M.mb, other); [cur, other] = [other, cur];
    }
    this.prevViewProj.copy(viewProj); this.first = false;
    // 6. depth of field
    if (this.dofOn) { const u = M.dof.uniforms; u.tColor.value = cur.texture; u.tDepth.value = depth; u.projInv.value.copy(projInv); u.proj.value.copy(proj); this.pass(M.dof, other); [cur, other] = [other, cur]; }
    // 7. bloom (adds into cur)
    if (q.bloom) { this.bloom.strength = env.bloom; this.bloom.threshold = env.bloomThreshold; this.bloom.render(r, null, cur, dt, false); }
    // 8. tone map + grade
    { const u = M.final.uniforms; u.tColor.value = cur.texture; u.time.value = (u.time.value + dt) % 100; u.gain.value.copy(env.gain); u.lift.value.copy(env.lift); u.saturation.value = env.saturation; }
    if (q.fxaa) { this.pass(M.final, this.ldr); M.fxaa.uniforms.tDiffuse.value = this.ldr.texture; this.pass(M.fxaa, null); }
    else this.pass(M.final, null);
  }
}
