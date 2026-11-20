// First-person player: pointer-lock mouse look, WASD + arrow keys, sprint, jump, fly mode, collision with
// buildings / street furniture / dock edges (footbridges are walkable), kerb step-up.
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { DOCKS, BRIDGES, THAMES_EDGE_X } from './layout.js';
import { pointInPoly, closestOnSeg, clamp } from './util.js';

const EYE = 1.7;

export class Player {
  constructor(camera, dom, heightField, colliders) {
    this.camera = camera; this.hf = heightField; this.colliders = colliders;
    this.controls = new PointerLockControls(camera, dom);
    this.controls.pointerSpeed = 0.9;
    this.keys = new Set(); this.vel = new THREE.Vector3(); this.vy = 0; this.onGround = true;
    this.fly = false; this.feet = 0; this.bob = 0; this.stepPhase = 0; this.onStep = null;
    this.radius = 0.35;
    this.docks = DOCKS.map((d) => { const xs = d.poly.map((p) => p[0]), zs = d.poly.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; });
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  place(x, z, yaw = 0, pitch = 0, y = null) {
    this.feet = y !== null ? y - EYE : this.hf.heightAt(x, z);
    this.camera.position.set(x, this.feet + EYE, z);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  toggleFly() { this.fly = !this.fly; this.vy = 0; if (!this.fly) { this.feet = Math.max(this.hf.heightAt(this.camera.position.x, this.camera.position.z), this.camera.position.y - EYE); } }

  key(...codes) { return codes.some((c) => this.keys.has(c)); }

  update(dt) {
    const k = (a, b) => (this.key(...a) ? 1 : 0) - (this.key(...b) ? 1 : 0);
    const fwd = k(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const strafe = k(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    const sprint = this.key('ShiftLeft', 'ShiftRight');
    const cam = this.camera;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    if (this.fly) {
      const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
      const up = k(['Space', 'KeyE'], ['KeyC', 'KeyQ', 'ControlLeft']);
      const speed = sprint ? 70 : 18;
      const target = new THREE.Vector3().addScaledVector(dir, fwd).addScaledVector(right, strafe).addScaledVector(THREE.Object3D.DEFAULT_UP, up);
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);
      this.vel.lerp(target, 1 - Math.exp(-dt * 6));
      cam.position.addScaledVector(this.vel, dt);
      cam.position.y = clamp(cam.position.y, 0.5, 900);
      return { moving: this.vel.length() > 0.5 };
    }
    // walking
    dir.y = 0; dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const speed = sprint ? 6.5 : 2.4;
    const target = new THREE.Vector3().addScaledVector(dir, fwd).addScaledVector(right, strafe);
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);
    const accel = this.onGround ? 10 : 2;
    this.vel.x += (target.x - this.vel.x) * (1 - Math.exp(-dt * accel));
    this.vel.z += (target.z - this.vel.z) * (1 - Math.exp(-dt * accel));
    let x = cam.position.x, z = cam.position.z;
    const nx = x + this.vel.x * dt, nz = z + this.vel.z * dt;
    // try full move, then axis-separated (wall sliding)
    let p = this.resolve(nx, nz);
    const g0 = this.hf.heightAt(p[0], p[1]);
    if (g0 - this.feet > 0.45 && this.onGround) { p = [x, z]; }
    x = p[0]; z = p[1];
    // vertical
    const ground = this.hf.heightAt(x, z);
    if (this.key('Space') && this.onGround) { this.vy = 4.3; this.onGround = false; }
    this.vy -= 9.81 * dt;
    this.feet += this.vy * dt;
    if (this.feet <= ground) {
      if (!this.onGround && this.vy < -2 && this.onStep) this.onStep(0.6);
      this.feet = ground; this.vy = 0; this.onGround = true;
    } else if (this.feet - ground > 0.05) this.onGround = false;
    if (this.onGround && ground > this.feet - 0.5) this.feet += (ground - this.feet) * Math.min(1, dt * 18); // smooth kerb steps
    // head bob + footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.3) {
      const prev = this.stepPhase; this.stepPhase += dt * hs / 0.75 * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI) && this.onStep) this.onStep(Math.min(1, hs / 6));
    }
    const bob = this.onGround ? Math.sin(this.stepPhase * 2) * 0.028 * Math.min(1, hs / 3) : 0;
    cam.position.set(x, this.feet + EYE + bob, z);
    return { moving: hs > 0.3 };
  }

  onBridge(x, z) {
    for (const b of BRIDGES) if (x > b.x0 - 0.2 && x < b.x1 + 0.2 && z > b.z0 - 0.5 && z < b.z1 + 0.5) return b;
    return null;
  }

  resolve(x, z) {
    const r = this.radius;
    for (let iter = 0; iter < 3; iter++) {
      for (const c of this.colliders) {
        if (c.poly) {
          const bb = c.bb; if (x < bb.x0 - r || x > bb.x1 + r || z < bb.z0 - r || z > bb.z1 + r) continue;
          const inside = pointInPoly(x, z, c.poly);
          let best = 1e9, bx = 0, bz = 0;
          for (let i = 0; i < c.poly.length; i++) { const a = c.poly[i], b2 = c.poly[(i + 1) % c.poly.length]; const [cx, cz] = closestOnSeg(x, z, a[0], a[1], b2[0], b2[1]); const d = (x - cx) ** 2 + (z - cz) ** 2; if (d < best) { best = d; bx = cx; bz = cz; } }
          const d = Math.sqrt(best);
          if (inside) { const nx = (bx - x) / (d || 1), nz = (bz - z) / (d || 1); x = bx + nx * r; z = bz + nz * r; }
          else if (d < r) { const nx = (x - bx) / (d || 1), nz = (z - bz) / (d || 1); x = bx + nx * r; z = bz + nz * r; }
        } else if (c.circle) {
          const [cx, cz, cr] = c.circle; const dx = x - cx, dz = z - cz; const d = Math.hypot(dx, dz); const m = cr + r;
          if (d < m) { x = cx + (dx / (d || 1)) * m; z = cz + (dz / (d || 1)) * m; }
        } else if (c.rect) {
          const [x0, x1, z0, z1] = c.rect; const cx = clamp(x, x0, x1), cz = clamp(z, z0, z1); const dx = x - cx, dz = z - cz; const d = Math.hypot(dx, dz);
          if (d < r) { if (d > 1e-4) { x = cx + (dx / d) * r; z = cz + (dz / d) * r; } else { // inside: push to nearest side
            const opts = [[x0 - r, z, x - x0], [x1 + r, z, x1 - x], [x, z0 - r, z - z0], [x, z1 + r, z1 - z]]; opts.sort((a, b) => a[2] - b[2]); x = opts[0][0]; z = opts[0][1]; } }
        }
      }
      // docks (water) — footbridges carve walkable strips
      const br = this.onBridge(x, z);
      if (br) {
        const overWater = this.docks.some((d) => x > d.x0 - 1 && x < d.x1 + 1 && z > d.z0 && z < d.z1);
        if (overWater) x = clamp(x, br.x0 + r, br.x1 - r);
      } else {
        for (const d of this.docks) {
          if (x < d.x0 - r || x > d.x1 + r || z < d.z0 - r || z > d.z1 + r) continue;
          const opts = [[d.x0 - r, z, Math.abs(x - d.x0)], [d.x1 + r, z, Math.abs(d.x1 - x)], [x, d.z0 - r, Math.abs(z - d.z0)], [x, d.z1 + r, Math.abs(d.z1 - z)]];
          opts.sort((a, b) => a[2] - b[2]); x = opts[0][0]; z = opts[0][1];
        }
      }
      if (x < THAMES_EDGE_X + 0.8) x = THAMES_EDGE_X + 0.8;
    }
    x = clamp(x, THAMES_EDGE_X + 0.8, 1400); z = clamp(z, -1400, 1400);
    return [x, z];
  }
}
