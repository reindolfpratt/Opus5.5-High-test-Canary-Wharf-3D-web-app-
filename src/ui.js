// Minimal HUD: start overlay, status line, FPS, crosshair, minimap.
import * as THREE from 'three';
import { BUILDINGS, DOCKS, THAMES_EDGE_X, FAR_BANK_X, PARKS, BRIDGES, DLR } from './layout.js';
import { LANDMARKS, streetViewForLandmark, streetViewForLocal } from './geo.js';

export class UI {
  constructor() {
    this.root = document.getElementById('ui');
    this.overlay = document.getElementById('overlay');
    this.status = document.getElementById('status');
    this.fps = document.getElementById('fps');
    this.hint = document.getElementById('hint');
    this.cross = document.getElementById('cross');
    this.map = document.getElementById('minimap');
    this.mctx = this.map.getContext('2d');
    this.frames = 0; this.acc = 0; this.visible = true; this.hereT = 0;
    this.here = document.getElementById('here');
    this.labels = document.getElementById('labels');
    this.buildMap();
    this.buildLabels();
  }

  // floating landmark labels with Street View links
  buildLabels() {
    this.labelEls = LANDMARKS.map((l) => {
      const d = document.createElement('div'); d.className = 'lm';
      d.innerHTML = `<span class="n">${l.name}</span><a href="${streetViewForLandmark(l)}" target="_blank" rel="noopener">Street View ↗</a>`;
      this.labels.appendChild(d); return d;
    });
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3();
  }

  // comparison list on the pause / start screen
  buildCompareList(onGo) {
    const list = document.getElementById('compare-list');
    for (const l of LANDMARKS) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<span class="n">${l.name}</span><button type="button">Go here</button><a href="${streetViewForLandmark(l)}" target="_blank" rel="noopener">Street View ↗</a>`;
      row.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); onGo(l); });
      row.querySelector('a').addEventListener('click', (e) => e.stopPropagation());
      list.appendChild(row);
    }
    document.getElementById('compare').addEventListener('click', (e) => e.stopPropagation());
  }

  hereURL(cam) {
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    const compass = ((-e.y * 180) / Math.PI + 360) % 360;
    return streetViewForLocal(cam.position.x, cam.position.z, compass, (e.x * 180) / Math.PI);
  }

  updateLabels(cam) {
    const W = window.innerWidth, H = window.innerHeight;
    cam.getWorldDirection(this._f);
    const cand = [];
    LANDMARKS.forEach((l, i) => {
      const dx = l.anchor[0] - cam.position.x, dz = l.anchor[1] - cam.position.z; const d = Math.hypot(dx, dz);
      cand.push([d, i]);
    });
    cand.sort((a, b) => a[0] - b[0]);
    const show = new Set(cand.filter(([d]) => d < 280).slice(0, 5).map(([, i]) => i));
    LANDMARKS.forEach((l, i) => {
      const el = this.labelEls[i];
      if (!show.has(i) || !this.visible) { el.style.display = 'none'; return; }
      this._v.set(l.anchor[0], l.labelY, l.anchor[1]);
      const toP = this._v.clone().sub(cam.position);
      if (toP.dot(this._f) < 2) { el.style.display = 'none'; return; }
      this._v.project(cam);
      if (Math.abs(this._v.x) > 1.05 || Math.abs(this._v.y) > 1.05) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.transform = `translate(${((this._v.x + 1) / 2) * W}px, ${((1 - this._v.y) / 2) * H}px) translate(-50%, -100%)`;
    });
  }

  buildMap() {
    // static map at 1 px per metre, region x[-1100, 900], z[-700, 900]
    const X0 = -1100, Z0 = -700, W = 2000, H = 1600;
    this.mapRegion = { X0, Z0, W, H };
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#26282b'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1b3240';
    x.fillRect(FAR_BANK_X - X0, 0, THAMES_EDGE_X - FAR_BANK_X, H);
    const poly = (p) => { x.beginPath(); p.forEach(([px, pz], i) => (i ? x.lineTo(px - X0, pz - Z0) : x.moveTo(px - X0, pz - Z0))); x.closePath(); x.fill(); };
    for (const d of DOCKS) poly(d.poly);
    x.fillStyle = '#2f4a30'; for (const p of PARKS) poly(p.poly);
    x.fillStyle = '#6b6f75'; for (const b of BRIDGES) x.fillRect(b.x0 - X0, b.z0 - Z0, b.x1 - b.x0, b.z1 - b.z0);
    x.fillStyle = '#8c939b'; for (const b of BUILDINGS) { x.fillStyle = b.h > 120 ? '#c9ced4' : '#8c939b'; poly(b.poly); }
    x.fillStyle = 'rgba(200,40,60,0.6)'; x.fillRect(DLR.x - 3 - X0, 0, 6, H);
    this.mapCanvas = c;
  }

  drawRoads(net) {
    const x = this.mapCanvas.getContext('2d'); const { X0, Z0 } = this.mapRegion;
    x.strokeStyle = '#4a4d52'; x.lineCap = 'round'; x.lineJoin = 'round';
    for (const r of net.roads) {
      x.lineWidth = r.w; x.beginPath(); r.center.pts.forEach(([px, pz], i) => (i ? x.lineTo(px - X0, pz - Z0) : x.moveTo(px - X0, pz - Z0))); if (r.center.closed) x.closePath(); x.stroke();
    }
    // redraw buildings on top
    const poly = (p) => { x.beginPath(); p.forEach(([px, pz], i) => (i ? x.lineTo(px - X0, pz - Z0) : x.moveTo(px - X0, pz - Z0))); x.closePath(); x.fill(); };
    for (const b of BUILDINGS) { x.fillStyle = b.h > 120 ? '#c9ced4' : '#8c939b'; poly(b.poly); }
  }

  showOverlay(v) { this.overlay.style.display = v ? 'flex' : 'none'; this.cross.style.display = v ? 'none' : 'block'; this.labels.style.visibility = v ? 'hidden' : 'visible'; }
  toggle() { this.visible = !this.visible; this.root.style.display = this.visible ? 'block' : 'none'; }

  update(dt, info) {
    this.frames++; this.acc += dt;
    if (this.acc > 0.5) { this.fps.textContent = `${Math.round(this.frames / this.acc)} fps · ${info.quality}`; this.frames = 0; this.acc = 0; }
    this.hereT -= dt;
    if (this.hereT <= 0 && info.cam) { this.hereT = 0.5; this.here.href = this.hereURL(info.cam); }
    if (info.cam) this.updateLabels(info.cam);
    this.status.textContent = `${info.time} · ${info.fly ? 'Fly' : 'Walk'}${info.dof ? ' · DoF' : ''}${info.muted ? ' · Muted' : ''}`;
    if (!this.visible) return;
    // minimap: player-centred, north up, ~3 m per px
    const m = this.mctx, S = this.map.width; const { X0, Z0 } = this.mapRegion; const span = 520;
    m.clearRect(0, 0, S, S);
    m.save(); m.beginPath(); m.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); m.clip();
    m.drawImage(this.mapCanvas, info.x - X0 - span / 2, info.z - Z0 - span / 2, span, span, 0, 0, S, S);
    m.translate(S / 2, S / 2); m.rotate(-info.yaw);
    m.fillStyle = '#ffd24a'; m.beginPath(); m.moveTo(0, -8); m.lineTo(5, 6); m.lineTo(0, 3); m.lineTo(-5, 6); m.closePath(); m.fill();
    m.restore();
    m.strokeStyle = 'rgba(255,255,255,0.35)'; m.lineWidth = 1.5; m.beginPath(); m.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); m.stroke();
    m.fillStyle = 'rgba(255,255,255,0.8)'; m.font = '600 10px system-ui, sans-serif'; m.textAlign = 'center'; m.fillText('N', S / 2, 12);
  }
}
