// Procedural texture generation (canvas 2D). Everything is generated at start-up — no network, no image files.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

let MAX_ANISO = 8;
export function setMaxAniso(a) { MAX_ANISO = a; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', { willReadFrequently: true }); return c; }

function tex(c, { srgb = false, repeat = true, aniso = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso ? MAX_ANISO : 1;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------- noise ----------
function makeValueNoise(seed, size = 256) {
  const r = mulberry32(seed); const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % size) + size) % size, y0 = ((yi % size) + size) % size, x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * size + x0], b = g[y0 * size + x1], c = g[y1 * size + x0], d = g[y1 * size + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
// tileable fbm over a w x h canvas with base period p (in pixels); returns Float32Array 0..1
function fbmField(w, h, period, octaves, seed) {
  const n = makeValueNoise(seed, 512);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, amp = 0.5, f = 1 / period, tot = 0;
    for (let o = 0; o < octaves; o++) { a += amp * n(x * f, y * f); tot += amp; amp *= 0.5; f *= 2; }
    out[y * w + x] = a / tot;
  }
  return out;
}

function rgb(r, g, b) { return `rgb(${Math.round(clamp(r, 0, 1) * 255)},${Math.round(clamp(g, 0, 1) * 255)},${Math.round(clamp(b, 0, 1) * 255)})`; }

// Apply per-pixel noise multiplicatively to an existing canvas
function grain(c, field, amount, bias = 1) {
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height); const p = d.data;
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const k = bias + (field[j % field.length] - 0.5) * amount;
    p[i] = clamp(p[i] * k, 0, 255); p[i + 1] = clamp(p[i + 1] * k, 0, 255); p[i + 2] = clamp(p[i + 2] * k, 0, 255);
  }
  ctx.putImageData(d, 0, 0);
}

// ============ FACADES ============
// Tile = 16 panels (1.5 m) x 12 floors (4 m) = 24 m x 48 m.
export const FACADE_TILE = { w: 24, h: 48 };
export const LOBBY_TILE = { w: 24, h: 12 };

const STYLES = {
  glassBlue:  { kind: 'curtain', glass: [0.2, 0.26, 0.32], tintVar: 0.05, mullion: [0.55, 0.58, 0.6], spandrel: [0.14, 0.17, 0.2], spandrelFrac: 0.2, lit: 0.62, finEvery: 0 },
  glassGrey:  { kind: 'curtain', glass: [0.21, 0.225, 0.24], tintVar: 0.04, mullion: [0.42, 0.43, 0.45], spandrel: [0.10, 0.11, 0.12], spandrelFrac: 0.26, lit: 0.6, finEvery: 2 },
  glassGreen: { kind: 'curtain', glass: [0.18, 0.25, 0.24], tintVar: 0.05, mullion: [0.6, 0.62, 0.62], spandrel: [0.2, 0.24, 0.24], spandrelFrac: 0.18, lit: 0.55, finEvery: 0 },
  glassDark:  { kind: 'curtain', glass: [0.16, 0.17, 0.19], tintVar: 0.03, mullion: [0.12, 0.12, 0.13], spandrel: [0.06, 0.06, 0.07], spandrelFrac: 0.24, lit: 0.5, finEvery: 4 },
  podium:     { kind: 'curtain', glass: [0.30, 0.34, 0.37], tintVar: 0.03, mullion: [0.75, 0.76, 0.78], spandrel: [0.62, 0.62, 0.6], spandrelFrac: 0.3, lit: 0.85, finEvery: 0, warm: true },
  steel:      { kind: 'steel' },
  stone:      { kind: 'stone', base: [0.66, 0.63, 0.58], rough: 0.78, lit: 0.55 },
  stoneWarm:  { kind: 'stone', base: [0.56, 0.47, 0.42], rough: 0.5, lit: 0.55 },
  brick:      { kind: 'brick', base: [0.50, 0.38, 0.26], lit: 0.4 },
  brickModern:{ kind: 'brick', base: [0.36, 0.22, 0.17], lit: 0.6, big: true },
  diagrid:    { kind: 'curtain', glass: [0.21, 0.27, 0.33], tintVar: 0.04, mullion: [0.5, 0.52, 0.55], spandrel: [0.16, 0.19, 0.22], spandrelFrac: 0.12, lit: 0.6, diagrid: true },
  resiWhite:  { kind: 'resi', frame: [0.82, 0.82, 0.8], glass: [0.26, 0.31, 0.36], lit: 0.5 },
  resiGrey:   { kind: 'resi', frame: [0.3, 0.31, 0.33], glass: [0.24, 0.28, 0.31], lit: 0.5, panels: [0.62, 0.55, 0.45] },
};
export const STYLE_NAMES = Object.keys(STYLES);

// Painter that draws into 4 canvases at once: albedo, rm (G=rough, B=metal), normal, emissive
class Painter {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.c = { a: canvas(w, h), rm: canvas(w, h), n: canvas(w, h), e: canvas(w, h) };
    this.x = {}; for (const k in this.c) this.x[k] = this.c[k].getContext('2d');
    this.x.n.fillStyle = 'rgb(128,128,255)'; this.x.n.fillRect(0, 0, w, h);
    this.x.e.fillStyle = '#000'; this.x.e.fillRect(0, 0, w, h);
  }
  // material rect: albedo color, roughness, metalness, optional normal tilt (nx, ny in -1..1)
  rect(x, y, w, h, col, rough, metal, nx = 0, ny = 0) {
    this.x.a.fillStyle = rgb(...col); this.x.a.fillRect(x, y, w, h);
    this.x.rm.fillStyle = `rgb(0,${Math.round(clamp(rough, 0, 1) * 255)},${Math.round(clamp(metal, 0, 1) * 255)})`; this.x.rm.fillRect(x, y, w, h);
    if (nx || ny) { this.x.n.fillStyle = `rgb(${Math.round(128 + nx * 127)},${Math.round(128 + ny * 127)},${Math.round(255 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.5 + 127)})`; this.x.n.fillRect(x, y, w, h); }
  }
  normal(x, y, w, h, nx, ny) {
    this.x.n.fillStyle = `rgb(${Math.round(128 + nx * 127)},${Math.round(128 + ny * 127)},${Math.round(127 + 128 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)))})`; this.x.n.fillRect(x, y, w, h);
  }
  // bevelled frame normals around a rectangle (raised or recessed)
  bevel(x, y, w, h, s, depth) {
    this.normal(x, y, s, h, -depth, 0); this.normal(x + w - s, y, s, h, depth, 0);
    this.normal(x, y, w, s, 0, depth); this.normal(x, y + h - s, w, s, 0, -depth);
  }
  emit(x, y, w, h, col) { this.x.e.fillStyle = rgb(...col); this.x.e.fillRect(x, y, w, h); }
  emitGrad(x, y, w, h, col, top = 1, bottom = 0.35) {
    const g = this.x.e.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgb(col[0] * top, col[1] * top, col[2] * top)); g.addColorStop(1, rgb(col[0] * bottom, col[1] * bottom, col[2] * bottom));
    this.x.e.fillStyle = g; this.x.e.fillRect(x, y, w, h);
  }
  textures(srgbAlbedo = true) {
    return {
      map: tex(this.c.a, { srgb: srgbAlbedo }), rm: tex(this.c.rm), normal: tex(this.c.n), emissive: tex(this.c.e, { srgb: true }),
    };
  }
}

function interiorColor(r) {
  // office light colours: cool LED / neutral / warm, with brightness variance
  const t = r();
  const b = 0.55 + r() * 0.45;
  if (t < 0.5) return [0.86 * b, 0.92 * b, 1.0 * b];
  if (t < 0.85) return [1.0 * b, 0.95 * b, 0.85 * b];
  return [1.0 * b, 0.8 * b, 0.55 * b];
}

function paintCurtain(P, s, r, cols, rows) {
  const pw = P.w / cols, fh = P.h / rows;
  const mw = Math.max(2, pw * 0.07), th = Math.max(2, fh * 0.035);
  // lit bays: decide per floor-section of 4 panels for coherent office lighting
  for (let j = 0; j < rows; j++) {
    const floorLit = r() < s.lit;
    let bayCol = interiorColor(r);
    for (let i = 0; i < cols; i++) {
      if (i % 4 === 0) { bayCol = interiorColor(r); }
      const x = i * pw, y = j * fh;
      const tv = (r() - 0.5) * s.tintVar;
      const g = [s.glass[0] + tv, s.glass[1] + tv, s.glass[2] + tv * 1.2];
      const sp = fh * s.spandrelFrac;
      // vision glass (slightly tilted per panel => broken reflections like real IGUs)
      P.rect(x, y, pw, fh - sp, g, 0.04 + r() * 0.05, 0.92, (r() - 0.5) * 0.035, (r() - 0.5) * 0.035);
      // spandrel / slab edge band at the bottom of each floor (canvas y grows downward => floor bottom = larger y)
      P.rect(x, y + fh - sp, pw, sp, s.spandrel, 0.25, 0.55, (r() - 0.5) * 0.02, 0);
      // interior light
      const lit = floorLit ? r() < 0.82 : r() < 0.12;
      if (lit) P.emitGrad(x + mw, y + th, pw - 2 * mw, fh - sp - th, s.warm ? [1, 0.85, 0.62] : bayCol, 1.0, 0.45);
      else if (r() < 0.25) P.emit(x + mw, y + th, pw - 2 * mw, fh - sp - th, [0.05, 0.055, 0.07]);
    }
  }
  // mullions & transoms (aluminium)
  for (let i = 0; i <= cols; i++) {
    const x = i * pw - mw / 2;
    const fin = s.finEvery && i % s.finEvery === 0;
    P.rect(x, 0, fin ? mw * 1.8 : mw, P.h, s.mullion, 0.38, 1.0);
    P.normal(x, 0, mw * 0.35, P.h, -0.5, 0); P.normal(x + (fin ? mw * 1.8 : mw) - mw * 0.35, 0, mw * 0.35, P.h, 0.5, 0);
  }
  for (let j = 0; j <= rows; j++) {
    const y = j * fh - th / 2; P.rect(0, y, P.w, th, s.mullion, 0.38, 1.0); P.normal(0, y, P.w, th * 0.4, 0, 0.5);
  }
  if (s.diagrid) {
    // diagonal steel members: diamonds 8 panels wide x 4 floors tall
    const dw = pw * 8, dh = fh * 4;
    for (const k of ['a', 'rm']) {
      const ctx = P.x[k];
      ctx.save(); ctx.lineWidth = mw * 2.4; ctx.strokeStyle = k === 'a' ? rgb(0.78, 0.8, 0.82) : 'rgb(0,90,255)';
      ctx.beginPath();
      for (let ox = -dw; ox <= P.w + dw; ox += dw) for (let oy = -dh; oy <= P.h + dh; oy += dh) {
        ctx.moveTo(ox, oy); ctx.lineTo(ox + dw, oy + dh); ctx.moveTo(ox + dw, oy); ctx.lineTo(ox, oy + dh);
      }
      ctx.stroke(); ctx.restore();
    }
    const ctx = P.x.e; ctx.save(); ctx.lineWidth = mw * 2.6; ctx.strokeStyle = '#000'; ctx.beginPath();
    for (let ox = -dw; ox <= P.w + dw; ox += dw) for (let oy = -dh; oy <= P.h + dh; oy += dh) { ctx.moveTo(ox, oy); ctx.lineTo(ox + dw, oy + dh); ctx.moveTo(ox + dw, oy); ctx.lineTo(ox, oy + dh); }
    ctx.stroke(); ctx.restore();
  }
}

function paintSteel(P, r, cols, rows) {
  // One Canada Square: stainless steel cladding with a regular grid of punched windows
  const pw = P.w / cols, fh = P.h / rows;
  P.rect(0, 0, P.w, P.h, [0.72, 0.73, 0.75], 0.36, 0.55);
  for (let j = 0; j < rows; j++) {
    const floorLit = r() < 0.65;
    for (let i = 0; i < cols; i++) {
      const x = i * pw, y = j * fh;
      // subtle per-panel variation in the steel (oil-canning)
      const v = (r() - 0.5) * 0.05;
      P.rect(x, y, pw, fh, [0.72 + v, 0.73 + v, 0.75 + v], 0.32 + r() * 0.1, 0.55, (r() - 0.5) * 0.05, (r() - 0.5) * 0.05);
      const wx = x + pw * 0.2, wy = y + fh * 0.24, ww = pw * 0.6, wh = fh * 0.5;
      P.rect(wx, wy, ww, wh, [0.17, 0.19, 0.22], 0.05, 0.9, (r() - 0.5) * 0.03, (r() - 0.5) * 0.03);
      P.bevel(wx - 2, wy - 2, ww + 4, wh + 4, 2, 0.55);
      if (floorLit ? r() < 0.85 : r() < 0.1) P.emitGrad(wx, wy, ww, wh, interiorColor(r), 1, 0.5);
    }
  }
}

function paintStone(P, s, r, cols, rows, field) {
  const pw = P.w / cols, fh = P.h / rows;
  P.rect(0, 0, P.w, P.h, s.base, s.rough, 0);
  // panel joints
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i += 2) {
    const v = (r() - 0.5) * 0.06; P.rect(i * pw, j * fh, pw * 2, fh, [s.base[0] + v, s.base[1] + v, s.base[2] + v], s.rough + (r() - 0.5) * 0.1, 0);
  }
  grain(P.c.a, field, 0.35);
  const ctx = P.x.a; ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let j = 0; j <= rows; j++) ctx.fillRect(0, j * fh - 1, P.w, 2);
  for (let i = 0; i <= cols; i += 2) ctx.fillRect(i * pw - 1, 0, 2, P.h);
  // punched windows: 2 panels per bay
  for (let j = 0; j < rows; j++) {
    const floorLit = r() < s.lit;
    for (let i = 0; i < cols; i += 2) {
      const x = i * pw + pw * 0.28, y = j * fh + fh * 0.18, w = pw * 1.44, h = fh * 0.6;
      // reveal (shadowed recess)
      P.rect(x - 3, y - 3, w + 6, h + 6, [s.base[0] * 0.45, s.base[1] * 0.45, s.base[2] * 0.45], 0.8, 0);
      P.bevel(x - 3, y - 3, w + 6, h + 6, 3, -0.7);
      P.rect(x, y, w, h, [0.22, 0.25, 0.28], 0.05, 0.88, (r() - 0.5) * 0.03, (r() - 0.5) * 0.03);
      // mullion splitting the window
      P.rect(x + w / 2 - 1.5, y, 3, h, [0.2, 0.2, 0.21], 0.4, 0.8);
      if (floorLit ? r() < 0.8 : r() < 0.1) P.emitGrad(x, y, w, h, interiorColor(r), 1, 0.5);
    }
  }
}

function paintBrick(P, s, r, cols, rows, field) {
  const pw = P.w / cols, fh = P.h / rows;
  P.rect(0, 0, P.w, P.h, s.base, 0.9, 0);
  // brick courses (scaled: individual bricks are tiny so suggest coursing)
  const ctx = P.x.a;
  for (let y = 0; y < P.h; y += 3) {
    for (let x = (y / 3) % 2 ? 0 : 4; x < P.w; x += 8) {
      const v = (r() - 0.5) * 0.18; ctx.fillStyle = rgb(s.base[0] + v, s.base[1] + v * 0.9, s.base[2] + v * 0.7); ctx.fillRect(x, y, 7, 2);
    }
  }
  grain(P.c.a, field, 0.4);
  const bays = s.big ? 2 : 2;
  for (let j = 0; j < rows; j++) {
    const floorLit = r() < s.lit;
    for (let i = 0; i < cols; i += bays) {
      const big = s.big;
      const w = big ? pw * 1.6 : pw * 0.9, h = big ? fh * 0.66 : fh * 0.55;
      const x = i * pw + (pw * bays - w) / 2, y = j * fh + fh * 0.2;
      P.rect(x - 3, y - 3, w + 6, h + 6, big ? [0.12, 0.12, 0.13] : [0.85, 0.84, 0.8], 0.5, big ? 0.7 : 0);
      P.bevel(x - 3, y - 3, w + 6, h + 6, 2, -0.6);
      P.rect(x, y, w, h, [0.16, 0.18, 0.2], 0.06, 0.85, (r() - 0.5) * 0.04, (r() - 0.5) * 0.04);
      if (!big) { // Georgian sash glazing bars
        const c = [0.85, 0.84, 0.8];
        for (let k = 1; k < 3; k++) P.rect(x + (w * k) / 3 - 1, y, 2, h, c, 0.5, 0);
        for (let k = 1; k < 4; k++) P.rect(x, y + (h * k) / 4 - 1, w, 2, c, 0.5, 0);
        // stone lintel
        P.rect(x - 4, y - 8, w + 8, 5, [0.72, 0.68, 0.6], 0.8, 0);
      }
      if (floorLit ? r() < 0.75 : r() < 0.1) P.emitGrad(x, y, w, h, [1, 0.82, 0.6], 1, 0.55);
    }
  }
}

function paintResi(P, s, r, cols, rows) {
  const pw = P.w / cols, fh = P.h / rows;
  for (let j = 0; j < rows; j++) {
    const y = j * fh;
    for (let i = 0; i < cols; i++) {
      const x = i * pw; const tv = (r() - 0.5) * 0.04;
      const solid = s.panels && r() < 0.28;
      if (solid) P.rect(x, y, pw, fh, [s.panels[0] + tv, s.panels[1] + tv, s.panels[2] + tv], 0.35, 0.8);
      else P.rect(x, y, pw, fh, [s.glass[0] + tv, s.glass[1] + tv, s.glass[2] + tv], 0.05, 0.9, (r() - 0.5) * 0.04, (r() - 0.5) * 0.04);
      if (!solid && r() < s.lit) P.emitGrad(x + 2, y + fh * 0.12, pw - 4, fh * 0.6, r() < 0.7 ? [1, 0.78, 0.5] : [0.9, 0.92, 1], 0.9, 0.5);
    }
    // slab edge band + balcony glass
    P.rect(0, y + fh * 0.78, P.w, fh * 0.22, s.frame, 0.45, 0.1);
    P.normal(0, y + fh * 0.78, P.w, 2, 0, 0.6);
    P.x.a.fillStyle = 'rgba(200,215,225,0.18)'; P.x.a.fillRect(0, y + fh * 0.5, P.w, fh * 0.28);
  }
  for (let i = 0; i <= cols; i += 2) P.rect(i * pw - 2, 0, 4, P.h, s.frame, 0.45, 0.1);
}

export function makeFacade(style, hiRes) {
  const s = STYLES[style];
  const W = hiRes ? 1024 : 512, H = hiRes ? 2048 : 1024;
  const r = mulberry32(style.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const P = new Painter(W, H);
  const cols = 16, rows = 12;
  if (s.kind === 'curtain') paintCurtain(P, s, r, cols, rows);
  else if (s.kind === 'steel') paintSteel(P, r, cols, rows);
  else if (s.kind === 'stone') paintStone(P, s, r, cols, rows, fbmField(W, H, 6, 4, 11));
  else if (s.kind === 'brick') paintBrick(P, s, r, cols, rows, fbmField(W, H, 3, 3, 12));
  else if (s.kind === 'resi') paintResi(P, s, r, cols, 15);
  return P.textures();
}

export function makeLobby(hiRes) {
  // tall shopfront / lobby glazing, 3 m panes, 12 m tile height (only bottom part normally visible)
  const W = hiRes ? 1024 : 512, H = W / 2;
  const P = new Painter(W, H); const r = mulberry32(99);
  const cols = 8; const pw = W / cols; const ph = H; // 12 m tall
  for (let i = 0; i < cols; i++) {
    const x = i * pw;
    P.rect(x, 0, pw, ph, [0.24, 0.27, 0.29], 0.03, 0.85, (r() - 0.5) * 0.02, 0);
    // lit interiors: bright ceiling band, darker floor zone, columns / desks / people silhouettes
    const warm = r() < 0.55; const ic = warm ? [0.95, 0.86, 0.72] : [0.85, 0.9, 0.97];
    P.emitGrad(x + 4, ph * 0.06, pw - 8, ph * 0.94, ic, 0.95, 0.22);
    P.emit(x + 4, ph * 0.06, pw - 8, ph * 0.035, [1, 0.98, 0.95]);
    for (let k = 0; k < 3; k++) if (r() < 0.6) P.emit(x + 6 + r() * (pw - 20), ph * (0.55 + r() * 0.15), 6 + r() * 14, ph * 0.45, [0.05, 0.045, 0.04]);
    if (r() < 0.5) P.emit(x + pw * 0.4, ph * 0.1, pw * 0.1, ph * 0.9, [0.1, 0.09, 0.08]);
  }
  for (let i = 0; i <= cols; i++) { P.rect(i * pw - 3, 0, 6, ph, [0.2, 0.21, 0.22], 0.35, 1); }
  P.rect(0, ph * 0.62, W, 5, [0.2, 0.21, 0.22], 0.35, 1); // transom at ~4.5 m above ground (v increases upward in mesh; canvas flipped)
  P.rect(0, ph - 6, W, 6, [0.12, 0.12, 0.12], 0.6, 0.2); // plinth at ground (canvas bottom = ground since flipY)
  return P.textures();
}

export function makeRoof() {
  const W = 512; const c = canvas(W, W); const ctx = c.getContext('2d');
  ctx.fillStyle = rgb(0.42, 0.41, 0.4); ctx.fillRect(0, 0, W, W);
  grain(c, fbmField(W, W, 4, 4, 21), 0.5);
  ctx.strokeStyle = 'rgba(20,20,20,0.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < W; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, W); ctx.stroke(); }
  return tex(c, { srgb: true });
}

// ============ GROUND ============
export function makePaving(hiRes) {
  // Large granite slabs (Canary Wharf plazas). Tile = 6 m.
  const W = hiRes ? 1024 : 512; const sl = W / 10; // 0.6 m slabs, running bond
  const a = canvas(W, W), rm = canvas(W, W), n = canvas(W, W);
  const xa = a.getContext('2d'), xr = rm.getContext('2d'), xn = n.getContext('2d');
  const r = mulberry32(5);
  xn.fillStyle = 'rgb(128,128,255)'; xn.fillRect(0, 0, W, W);
  for (let j = 0; j < 10; j++) for (let i = -1; i < 6; i++) {
    const x = i * sl * 2 + (j % 2 ? sl : 0), y = j * sl;
    const v = (r() - 0.5) * 0.07; const base = 0.47 + v;
    xa.fillStyle = rgb(base, base * 0.985, base * 0.96); xa.fillRect(x, y, sl * 2, sl);
    xr.fillStyle = `rgb(0,${Math.round((0.62 + r() * 0.18) * 255)},0)`; xr.fillRect(x, y, sl * 2, sl);
    // tiny per-slab tilt
    xn.fillStyle = `rgb(${128 + Math.round((r() - 0.5) * 8)},${128 + Math.round((r() - 0.5) * 8)},255)`; xn.fillRect(x, y, sl * 2, sl);
  }
  // granite speckle
  const f = fbmField(W, W, 1.5, 2, 33); grain(a, f, 0.45);
  const f2 = fbmField(W, W, 60, 3, 34); grain(a, f2, 0.18); // large-scale weathering
  // joints
  xa.fillStyle = 'rgba(40,38,36,0.9)'; xr.fillStyle = 'rgb(0,250,0)';
  const jw = Math.max(1.5, W / 512 * 1.5);
  for (let j = 0; j <= 10; j++) {
    const y = j * sl; xa.fillRect(0, y - jw / 2, W, jw); xr.fillRect(0, y - jw / 2, W, jw);
    xn.fillStyle = 'rgb(128,90,240)'; xn.fillRect(0, y - jw, W, jw / 2); xn.fillStyle = 'rgb(128,166,240)'; xn.fillRect(0, y + jw / 2, W, jw / 2);
    if (j < 10) for (let i = -1; i < 7; i++) {
      const x = i * sl * 2 + (j % 2 ? sl : 0);
      xa.fillRect(x - jw / 2, y, jw, sl); xr.fillRect(x - jw / 2, y, jw, sl);
      xn.fillStyle = 'rgb(90,128,240)'; xn.fillRect(x - jw, y, jw / 2, sl); xn.fillStyle = 'rgb(166,128,240)'; xn.fillRect(x + jw / 2, y, jw / 2, sl);
    }
  }
  return { map: tex(a, { srgb: true }), rm: tex(rm), normal: tex(n), size: 6 };
}

export function makeFlags() {
  // Footway: UK concrete flags 0.9 x 0.6 m. Tile 3.6 m across x 3.6 m along.
  const W = 512; const a = canvas(W, W), n = canvas(W, W); const xa = a.getContext('2d'), xn = n.getContext('2d');
  const r = mulberry32(8); const fw = W / 4, fl = W / 6;
  xn.fillStyle = 'rgb(128,128,255)'; xn.fillRect(0, 0, W, W);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
    const v = (r() - 0.5) * 0.08; const b = 0.5 + v; xa.fillStyle = rgb(b, b * 0.99, b * 0.97); xa.fillRect(i * fw, j * fl, fw, fl);
    xn.fillStyle = `rgb(${128 + Math.round((r() - 0.5) * 10)},${128 + Math.round((r() - 0.5) * 10)},255)`; xn.fillRect(i * fw, j * fl, fw, fl);
  }
  grain(a, fbmField(W, W, 2, 3, 41), 0.4); grain(a, fbmField(W, W, 40, 3, 42), 0.25);
  xa.fillStyle = 'rgba(35,35,35,0.85)';
  for (let i = 0; i <= 4; i++) xa.fillRect(i * fw - 1, 0, 2, W);
  for (let j = 0; j <= 6; j++) xa.fillRect(0, j * fl - 1, W, 2);
  // chewing-gum spots (very London)
  for (let k = 0; k < 40; k++) { xa.fillStyle = `rgba(30,30,30,${0.15 + r() * 0.2})`; xa.beginPath(); xa.arc(r() * W, r() * W, 1 + r() * 2.5, 0, 7); xa.fill(); }
  return { map: tex(a, { srgb: true }), normal: tex(n), size: 3.6 };
}

export function makeKerb() {
  const W = 256, H = 64; const a = canvas(W, H); const x = a.getContext('2d'); const r = mulberry32(3);
  for (let i = 0; i < 4; i++) { const v = 0.62 + (r() - 0.5) * 0.08; x.fillStyle = rgb(v, v, v * 0.98); x.fillRect(i * 64, 0, 64, H); }
  grain(a, fbmField(W, H, 1.5, 2, 51), 0.5);
  x.fillStyle = 'rgba(30,30,30,0.8)'; for (let i = 0; i <= 4; i++) x.fillRect(i * 64 - 1, 0, 2, H);
  return tex(a, { srgb: true });
}

function asphaltBase(W, H, seed) {
  const a = canvas(W, H), rm = canvas(W, H), n = canvas(W, H);
  const xa = a.getContext('2d'), xr = rm.getContext('2d'), xn = n.getContext('2d');
  xa.fillStyle = rgb(0.2, 0.2, 0.205); xa.fillRect(0, 0, W, H);
  grain(a, fbmField(W, H, 1.2, 2, seed), 0.55);
  grain(a, fbmField(W, H, 50, 4, seed + 1), 0.35);
  // tyre wear: slightly darker & smoother in wheel tracks handled by caller
  xr.fillStyle = 'rgb(0,225,0)'; xr.fillRect(0, 0, W, H);
  const f = fbmField(W, H, 1.1, 1, seed + 2); const ctx = xn; const d = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const v = f[i]; d.data[i * 4] = 128 + (v - 0.5) * 70; d.data[i * 4 + 1] = 128 + (f[(i + 7) % f.length] - 0.5) * 70; d.data[i * 4 + 2] = 245; d.data[i * 4 + 3] = 255; }
  ctx.putImageData(d, 0, 0);
  return { a, rm, n, xa, xr, xn };
}

// width in metres, length tile 24 m. kind: 'main' (cycle lanes), 'minor', 'ring'
export function makeRoad(kind, width) {
  const W = 512, H = 1024; const ppm = W / width, L = 24, ppl = H / L;
  const { a, rm, n, xa, xr } = asphaltBase(W, H, kind === 'ring' ? 61 : kind === 'main' ? 62 : 63);
  const X = (m) => (m + width / 2) * ppm; // metre offset from centreline -> px
  const paint = (x0, x1, y0, y1, col) => {
    xa.fillStyle = col; xa.fillRect(X(x0), y0 * ppl, (x1 - x0) * ppm, (y1 - y0) * ppl);
    xr.fillStyle = 'rgb(0,150,0)'; xr.fillRect(X(x0), y0 * ppl, (x1 - x0) * ppm, (y1 - y0) * ppl);
  };
  const white = 'rgba(232,232,226,0.92)', yellow = 'rgba(232,186,40,0.92)';
  // wheel tracks (polished, darker)
  for (const c of [-2.25, 2.25]) for (const o of [-0.8, 0.8]) {
    xa.fillStyle = 'rgba(10,10,12,0.12)'; xa.fillRect(X(c + o - 0.35), 0, 0.7 * ppm, H);
    xr.fillStyle = 'rgba(0,170,0,0.5)'; xr.fillRect(X(c + o - 0.35), 0, 0.7 * ppm, H);
  }
  if (kind !== 'ring') {
    for (let s = 0; s < L; s += 8) paint(-0.06, 0.06, s, s + 3, white); // centre dashes 3 m / gap 5 m
  }
  const hw = width / 2;
  if (kind === 'main') {
    // mandatory cycle lanes with solid white line and bike symbol
    paint(-hw + 1.5, -hw + 1.65, 0, L, white); paint(hw - 1.65, hw - 1.5, 0, L, white);
    for (const side of [-1, 1]) {
      const cx = X(side * (hw - 0.75)), cy = 12 * ppl;
      xa.save(); xa.translate(cx, cy); if (side > 0) xa.rotate(Math.PI); xa.strokeStyle = white; xa.lineWidth = 0.07 * ppm;
      const s = ppm * 0.28;
      xa.beginPath(); xa.arc(0, -1.6 * s, 0.9 * s, 0, 7); xa.stroke(); xa.beginPath(); xa.arc(0, 1.6 * s, 0.9 * s, 0, 7); xa.stroke();
      xa.beginPath(); xa.moveTo(0, -1.6 * s); xa.lineTo(-0.5 * s, 0); xa.lineTo(0, 1.6 * s); xa.moveTo(-0.5 * s, 0); xa.lineTo(0.6 * s, -0.8 * s); xa.lineTo(0, -1.6 * s); xa.stroke();
      xa.restore();
    }
  }
  if (kind !== 'ring') {
    // double yellow lines at the kerb (no waiting at any time)
    for (const side of [-1, 1]) {
      const e = side * hw;
      paint(Math.min(e - side * 0.2, e - side * 0.3), Math.max(e - side * 0.2, e - side * 0.3), 0, L, yellow);
      paint(Math.min(e - side * 0.4, e - side * 0.5), Math.max(e - side * 0.4, e - side * 0.5), 0, L, yellow);
    }
  } else {
    paint(-hw + 0.3, -hw + 0.42, 0, L, white); paint(hw - 0.42, hw - 0.3, 0, L, white);
  }
  // patch repairs / cracks
  const r = mulberry32(kind.length * 13);
  for (let k = 0; k < 5; k++) { xa.fillStyle = `rgba(${r() < 0.5 ? '15,15,16' : '60,60,60'},0.18)`; xa.fillRect(r() * W, r() * H, (0.5 + r() * 2) * ppm, (0.5 + r() * 3) * ppl); }
  return { map: tex(a, { srgb: true }), rm: tex(rm), normal: tex(n), length: L };
}

// UK signal-controlled crossing: stop lines, studs, zig-zags. Decal for a 30 m stretch of road.
export function makeCrossingDecal(width) {
  const W = 512, H = 1280; const L = 30; const ppm = W / width, ppl = H / L;
  const c = canvas(W, H); const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  const X = (m) => (m + width / 2) * ppm, Y = (m) => (m + L / 2) * ppl;
  x.fillStyle = 'rgba(236,236,230,0.95)';
  // crossing studs/edge lines (two dashed lines 2.4 m apart)
  for (const e of [-1.6, 1.6]) for (let m = -width / 2 + 0.3; m < width / 2 - 0.3; m += 0.5) x.fillRect(X(m), Y(e) - 0.05 * ppl, 0.25 * ppm, 0.1 * ppl);
  // stop lines (one per approach, across the left-hand lane)
  x.fillRect(X(-width / 2 + 0.6), Y(-4.2) - 0.15 * ppl, (width / 2 - 0.6) * ppm, 0.3 * ppl);
  x.fillRect(X(0), Y(4.2) - 0.15 * ppl, (width / 2 - 0.6) * ppm, 0.3 * ppl);
  // zig-zags along both kerbs and centre
  x.strokeStyle = 'rgba(236,236,230,0.95)'; x.lineWidth = 0.1 * ppm;
  for (const lane of [-width / 2 + 0.55, -0.0, width / 2 - 0.55]) {
    for (const dir of [-1, 1]) {
      x.beginPath();
      for (let k = 0; k <= 8; k++) { const m = dir * (5 + k * 1.2); const xo = lane + (k % 2 ? 0.25 : -0.25); if (k === 0) x.moveTo(X(xo), Y(m)); else x.lineTo(X(xo), Y(m)); }
      x.stroke();
    }
  }
  const t = tex(c, { srgb: true, repeat: false }); return t;
}

export function makeGrass() {
  const W = 512; const c = canvas(W, W); const x = c.getContext('2d');
  const f = fbmField(W, W, 30, 4, 71), g = fbmField(W, W, 1.3, 2, 72);
  const d = x.createImageData(W, W);
  for (let i = 0; i < W * W; i++) {
    const big = f[i], fine = g[i];
    const dry = clamp((big - 0.45) * 2.0, 0, 1);
    const r0 = 0.16 + dry * 0.14, g0 = 0.3 + dry * 0.06, b0 = 0.08 + dry * 0.03;
    const k = 0.7 + fine * 0.6;
    d.data[i * 4] = r0 * k * 255; d.data[i * 4 + 1] = g0 * k * 255; d.data[i * 4 + 2] = b0 * k * 255; d.data[i * 4 + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  // fallen leaves (it's late autumn)
  const r = mulberry32(73);
  for (let k = 0; k < 500; k++) { x.fillStyle = rgb(0.45 + r() * 0.3, 0.25 + r() * 0.2, 0.05); x.beginPath(); x.ellipse(r() * W, r() * W, 1.5 + r() * 2, 1 + r(), r() * 3, 0, 7); x.fill(); }
  return { map: tex(c, { srgb: true }), size: 5 };
}

export function makeQuayWall() {
  const W = 512, H = 512; const c = canvas(W, H); const x = c.getContext('2d'); const r = mulberry32(81);
  // London stock brick / granite blocks, 4 m x 4 m tile, with water staining near the bottom
  const bh = H / 10, bw = W / 4;
  for (let j = 0; j < 10; j++) for (let i = -1; i < 5; i++) {
    const v = (r() - 0.5) * 0.08; x.fillStyle = rgb(0.4 + v, 0.37 + v, 0.33 + v); x.fillRect(i * bw + (j % 2 ? bw / 2 : 0), j * bh, bw, bh);
  }
  grain(c, fbmField(W, H, 2, 3, 82), 0.5);
  x.fillStyle = 'rgba(20,20,20,0.6)';
  for (let j = 0; j <= 10; j++) x.fillRect(0, j * bh - 1, W, 2);
  for (let j = 0; j < 10; j++) for (let i = -1; i < 6; i++) x.fillRect(i * bw + (j % 2 ? bw / 2 : 0) - 1, j * bh, 2, bh);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(25,35,25,0.0)'); g.addColorStop(0.62, 'rgba(25,35,25,0.55)'); g.addColorStop(1, 'rgba(15,22,15,0.8)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return tex(c, { srgb: true });
}

export function makeConcrete(seed = 91, tone = 0.6) {
  const W = 512; const c = canvas(W, W); const x = c.getContext('2d');
  x.fillStyle = rgb(tone, tone * 0.99, tone * 0.97); x.fillRect(0, 0, W, W);
  grain(c, fbmField(W, W, 1.5, 2, seed), 0.3); grain(c, fbmField(W, W, 70, 4, seed + 1), 0.35);
  // rain streaks
  const r = mulberry32(seed + 2);
  for (let k = 0; k < 60; k++) { const g = x.createLinearGradient(0, 0, 0, W); g.addColorStop(0, 'rgba(30,30,30,0.18)'); g.addColorStop(1, 'rgba(30,30,30,0)'); x.fillStyle = g; x.fillRect(r() * W, 0, 2 + r() * 6, W * (0.3 + r() * 0.7)); }
  return tex(c, { srgb: true });
}

export function makeLattice() {
  // Crossrail Place timber lattice roof (diamond grid with alpha)
  const W = 512; const c = canvas(W, W); const x = c.getContext('2d'); x.clearRect(0, 0, W, W);
  x.strokeStyle = rgb(0.62, 0.45, 0.28); x.lineWidth = 22; x.lineCap = 'square';
  x.beginPath(); for (let k = -2; k <= 2; k++) { x.moveTo(k * W / 2, 0); x.lineTo(k * W / 2 + W, W); x.moveTo(k * W / 2 + W, 0); x.lineTo(k * W / 2, W); } x.stroke();
  x.strokeStyle = rgb(0.5, 0.36, 0.22); x.lineWidth = 6;
  x.beginPath(); for (let k = -2; k <= 2; k++) { x.moveTo(k * W / 2, 0); x.lineTo(k * W / 2 + W, W); } x.stroke();
  return tex(c, { srgb: true });
}

export function makeLeafCluster() {
  const W = 256; const c = canvas(W, W); const x = c.getContext('2d'); x.clearRect(0, 0, W, W);
  const r = mulberry32(101);
  for (let k = 0; k < 170; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * W * 0.42;
    const px = W / 2 + Math.cos(a) * d, py = W / 2 + Math.sin(a) * d;
    // London plane in late autumn: mix of green, olive, yellow, rust
    const t = r();
    const col = t < 0.45 ? [0.22 + r() * 0.1, 0.36 + r() * 0.12, 0.1] : t < 0.75 ? [0.45 + r() * 0.15, 0.42 + r() * 0.1, 0.12] : t < 0.92 ? [0.62 + r() * 0.15, 0.48, 0.12] : [0.55, 0.28, 0.1];
    const sh = 0.7 + r() * 0.3;
    x.fillStyle = rgb(col[0] * sh, col[1] * sh, col[2] * sh);
    x.save(); x.translate(px, py); x.rotate(r() * 6.28); x.beginPath();
    const s = 6 + r() * 7; x.moveTo(0, -s); for (let i = 1; i < 5; i++) { const aa = (i / 5) * Math.PI * 2 - Math.PI / 2; x.lineTo(Math.cos(aa) * s, Math.sin(aa) * s); x.lineTo(Math.cos(aa + 0.6) * s * 0.5, Math.sin(aa + 0.6) * s * 0.5); } x.closePath(); x.fill(); x.restore();
  }
  // twigs
  x.strokeStyle = 'rgba(60,45,35,0.9)'; x.lineWidth = 1.5;
  for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(W / 2, W / 2); x.lineTo(W / 2 + (r() - 0.5) * W * 0.8, W / 2 + (r() - 0.5) * W * 0.8); x.stroke(); }
  return tex(c, { srgb: true, repeat: false });
}

export function makeBark() {
  // London plane: mottled camouflage bark
  const W = 256; const c = canvas(W, W); const x = c.getContext('2d');
  const f = fbmField(W, W, 18, 3, 111); const d = x.createImageData(W, W);
  for (let i = 0; i < W * W; i++) {
    const v = f[i]; const patch = v > 0.52 ? 1 : 0;
    const base = patch ? [0.55, 0.52, 0.4] : [0.36, 0.32, 0.26];
    d.data[i * 4] = base[0] * 255; d.data[i * 4 + 1] = base[1] * 255; d.data[i * 4 + 2] = base[2] * 255; d.data[i * 4 + 3] = 255;
  }
  x.putImageData(d, 0, 0); grain(c, fbmField(W, W, 1.5, 2, 112), 0.3);
  return tex(c, { srgb: true });
}

export function makeRadial(inner = [1, 1, 1], stretch = 1) {
  const W = 256; const c = canvas(W, W); const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, rgb(...inner)); g.addColorStop(0.35, rgb(inner[0] * 0.45, inner[1] * 0.45, inner[2] * 0.45)); g.addColorStop(1, 'rgb(0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, W);
  return tex(c, { srgb: true, repeat: false });
}

export function makeHeadlightPool() {
  // two overlapping elongated beams, origin at bottom centre
  const W = 256, H = 512; const c = canvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'lighter';
  for (const ox of [-0.22, 0.22]) {
    x.save(); x.translate(W / 2 + ox * W, H); x.scale(1, 3.2);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, W * 0.5);
    g.addColorStop(0, 'rgba(255,240,215,0.9)'); g.addColorStop(0.4, 'rgba(255,235,200,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, W * 0.5, Math.PI, 2 * Math.PI); x.fill(); x.restore();
  }
  return tex(c, { srgb: true, repeat: false });
}

export function makeWaterNormals() {
  // tileable normal map from a sum of integer-frequency waves
  const W = 512; const c = canvas(W, W); const x = c.getContext('2d'); const d = x.createImageData(W, W);
  const r = mulberry32(131); const waves = [];
  for (let k = 0; k < 28; k++) {
    const kx = Math.round((r() - 0.5) * 2 * (2 + k)), ky = Math.round((r() - 0.5) * 2 * (2 + k));
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 1 / (1 + Math.hypot(kx, ky) * 0.6), p: r() * 6.28 });
  }
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    let dx = 0, dy = 0; const u = (i / W) * Math.PI * 2, v = (j / W) * Math.PI * 2;
    for (const w of waves) { const ph = w.kx * u + w.ky * v + w.p; const cph = Math.cos(ph) * w.a; dx += cph * w.kx; dy += cph * w.ky; }
    dx *= 0.035; dy *= 0.035;
    const l = Math.hypot(dx, dy, 1); const o = (j * W + i) * 4;
    d.data[o] = (-dx / l * 0.5 + 0.5) * 255; d.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; d.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; d.data[o + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return tex(c, { aniso: true });
}

export function makeLivery(kind) {
  // side decals for emergency vehicles (Battenburg) — 4 m x 1 m
  const W = 512, H = 128; const c = canvas(W, H); const x = c.getContext('2d');
  const n = 16; const s = W / n;
  const A = kind === 'police' ? '#1b3fb5' : '#1c8a3a', Bc = kind === 'police' ? '#f2e600' : '#f2e600';
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? A : Bc; x.fillRect(i * s, j * H / 2, s, H / 2); }
  return tex(c, { srgb: true, repeat: false });
}

export function makeBusDecal() {
  // destination blind + window band texture placeholder
  const W = 256, H = 64; const c = canvas(W, H); const x = c.getContext('2d');
  x.fillStyle = '#050505'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffb000'; x.font = 'bold 38px sans-serif'; x.textBaseline = 'middle'; x.fillText('D8  Canary Wharf', 10, H / 2 + 2);
  return tex(c, { srgb: true, repeat: false });
}

export function makeSignText(text, fg = '#fff', bg = '#000', w = 1024, h = 128) {
  const c = canvas(w, h); const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.font = `600 ${h * 0.55}px "Helvetica Neue", Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 2);
  return tex(c, { srgb: true, repeat: false });
}
