import * as THREE from 'three';
import { makeSplatCanvas } from './stains.js';

// A just-for-fun coffee mug that sits next to the catalogue.
// Drag it and the coffee sloshes (and spills if you shake it); let go while
// moving fast and it tips and throws coffee. Droplets fly ballistically,
// stain the pages they hit (stains stay on that page) and splat on the table.
// Leave the mug on a page and it leaves a ring.

const G = 26;            // gravity, world units / s^2 (page width = 1 unit, ~21 cm)
const MAX_DROPS = 520;

export class CoffeeCup {
  constructor(book, { logo } = {}) {
    this.book = book;
    this.R = 0.15;
    this.Hc = 0.31;
    this.fill = 0.85;
    this.scale = 1;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.slide = new THREE.Vector2();
    this.slosh = new THREE.Vector2();
    this.sloshV = new THREE.Vector2();
    this.tiltAmt = 0; this.tiltDir = new THREE.Vector2(1, 0);
    this.throwT = -1;
    this.lift = 0;
    this.idle = 0;
    this.userMoved = false;
    this.ringDone = true;
    this._build(logo);
    this._buildDrops();
    this.splats = [];
    this.splatTex = [0, 1, 2, 3].map((k) => {
      const t = new THREE.CanvasTexture(makeSplatCanvas(1234 + k * 77));
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    book.extras.push(this);
    this.onResize();
    this.pos.copy(this.home);
    this._place();
  }

  // ------------------------------------------------------------ model
  _build(logoSrc) {
    const R = this.R, Hc = this.Hc;
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.group.add(this.tilt);

    const ceramic = new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.22, metalness: 0, side: THREE.DoubleSide });
    const pts = [
      [0, 0.004], [R * 0.82, 0], [R * 0.93, 0.004], [R * 0.985, 0.022], [R, 0.06], [R, Hc - 0.012],
      [R - 0.002, Hc - 0.002], [R - 0.008, Hc + 0.001], [R - 0.013, Hc - 0.003], [R - 0.015, Hc - 0.02],
      [R - 0.017, 0.07], [R * 0.75, 0.045], [0, 0.04],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.LatheGeometry(pts, 64);
    body.rotateX(Math.PI / 2);
    const mug = new THREE.Mesh(body, ceramic);
    mug.castShadow = true; mug.receiveShadow = true;
    this.tilt.add(mug);

    // handle on the outer side (+x)
    const hg = new THREE.TorusGeometry(0.075, 0.019, 16, 32, Math.PI);
    hg.rotateZ(-Math.PI / 2);
    hg.rotateX(Math.PI / 2);
    const handle = new THREE.Mesh(hg, ceramic);
    handle.position.set(R - 0.006, 0, Hc * 0.52);
    handle.scale.set(1, 1, 1.15);
    handle.castShadow = true;
    this.tilt.add(handle);

    // brand on the side facing the book
    if (logoSrc) {
      const tex = new THREE.TextureLoader().load(logoSrc);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const len = 1.5, bandH = 0.075;
      const band = new THREE.CylinderGeometry(R + 0.0015, R + 0.0015, bandH, 48, 1, true, -Math.PI / 2 - len / 2, len);
      band.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(band, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3, depthWrite: false }));
      m.position.z = Hc * 0.5;
      this.tilt.add(m);
    }

    // coffee with crema
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    rg.addColorStop(0, '#2a150a'); rg.addColorStop(0.62, '#3a1e0c'); rg.addColorStop(0.86, '#7a4a24'); rg.addColorStop(1, '#a8743f');
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 58;
      g.fillStyle = `rgba(200,150,95,${Math.random() * 0.18})`;
      g.beginPath(); g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, Math.random() * 3, 0, 7); g.fill();
    }
    const ct = new THREE.CanvasTexture(c);
    ct.colorSpace = THREE.SRGBColorSpace;
    this.surface = new THREE.Mesh(
      new THREE.CircleGeometry(R - 0.017, 48),
      new THREE.MeshStandardMaterial({ map: ct, roughness: 0.12, metalness: 0.05 })
    );
    this.surface.receiveShadow = true;
    this.tilt.add(this.surface);

    // steam
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const sg = sc.getContext('2d');
    const sr = sg.createRadialGradient(32, 32, 2, 32, 32, 32);
    sr.addColorStop(0, 'rgba(255,255,255,0.9)'); sr.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = sr; sg.fillRect(0, 0, 64, 64);
    const stex = new THREE.CanvasTexture(sc);
    this.steam = Array.from({ length: 7 }, (_, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData = { t: i / 7, sx: (Math.random() - 0.5) * 0.05, sy: (Math.random() - 0.5) * 0.05 };
      this.group.add(sp);
      return sp;
    });

    this.book.scene.add(this.group);
    this.pickables = [mug, handle, this.surface];
  }

  _buildDrops() {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b1d0b, roughness: 0.15, metalness: 0.05 });
    this.drops = new THREE.InstancedMesh(geo, mat, MAX_DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.count = 0;
    this.drops.castShadow = true;
    this.drops.frustumCulled = false;
    this.book.scene.add(this.drops);
    this.d = { x: [], y: [], z: [], vx: [], vy: [], vz: [], s: [], n: 0 };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3(); this._up = new THREE.Vector3(0, 0, 1);
  }

  // ------------------------------------------------------------ layout
  onResize() {
    const b = this.book;
    if (!b.H) return;
    this.scale = b.portrait ? 0.62 : 1;
    this.bounds = this._visibleBounds(this.Hc * this.scale);
    this.group.scale.setScalar(this.scale);
    const R = this.R * this.scale;
    const bb = this.bounds;
    if (b.portrait) {
      this.home = new THREE.Vector3(bb.maxX - R - 0.16, bb.minY + R + 0.3, 0); // inset: its rim is nearer the camera
    } else {
      const x = Math.min(1 + 0.022 + R + 0.12, bb.maxX - R * 1.55); // room for the handle
      this.home = new THREE.Vector3(x, -b.H * 0.16, 0);
    }
    if (!this.userMoved && this.pos) { this.pos.copy(this.home); this._place(); }
  }

  _visibleBounds(top = 0.14) {
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -top), p = new THREE.Vector3(); // at the object's top: it is nearer the camera
    const xs = [], ys = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.setFromCamera(new THREE.Vector2(x, y), this.book.camera);
      if (ray.ray.intersectPlane(plane, p)) { xs.push(p.x); ys.push(p.y); }
    }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  _baseZ(x, y) {
    const r = this.R * this.scale * 0.8;
    let z = 0;
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) z = Math.max(z, this.book.surfaceZ(x + dx, y + dy));
    return z;
  }

  _place() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z + this.lift);
  }

  // ------------------------------------------------------------ input
  _ndc(e) {
    const r = this.book.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _hit(e) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this._ndc(e), this.book.camera);
    return ray.intersectObjects(this.pickables, false).length > 0;
  }

  _planePoint(e, z) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this._ndc(e), this.book.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p) ? p : null;
  }

  onDown(e) {
    if (!this.book.list || !this._hit(e)) return false;
    const p = this._planePoint(e, this.pos.z);
    if (!p) return false;
    try { this.book.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.drag = { id: e.pointerId, off: new THREE.Vector2(this.pos.x - p.x, this.pos.y - p.y), last: performance.now(), z: this.pos.z };
    this.userMoved = true;
    this.slide.set(0, 0);
    this.ringDone = true;
    this.book.renderer.domElement.style.cursor = 'grabbing';
    this.book._emit('coffee', { type: 'grab' });
    return true;
  }

  onMove(e) {
    if (this.drag && e.pointerId === this.drag.id) {
      const p = this._planePoint(e, this.drag.z);
      if (p) {
        const bb = this.bounds, R = this.R * this.scale;
        this.target = new THREE.Vector2(
          THREE.MathUtils.clamp(p.x + this.drag.off.x, bb.minX + R, bb.maxX - R),
          THREE.MathUtils.clamp(p.y + this.drag.off.y, bb.minY + R, bb.maxY - R)
        );
      }
      return true;
    }
    if (e.pointerType === 'mouse' && !e.buttons) {
      const over = this._hit(e);
      if (over !== this._over) {
        this._over = over;
        this.book.renderer.domElement.style.cursor = over ? 'grab' : '';
        if (over) this.book._emit('coffee', { type: 'hover' });
      }
    }
    return false;
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return false;
    this.drag = null;
    this.target = null;
    this.book.renderer.domElement.style.cursor = this._over ? 'grab' : '';
    const speed = this.vel.length();
    if (speed > 1.5 && this.fill > 0.08) this._throw(this.vel.clone());
    else { this.slide.copy(this.vel).multiplyScalar(0.15); this.ringDone = false; this.idle = 0; this._clink(); }
    return true;
  }

  onDbl(e) {
    if (!this._hit(e)) return false;
    // throw towards the middle of the book
    const dir = new THREE.Vector2(-this.pos.x * 0.55, -this.pos.y + 0.1);
    this._throw(dir.normalize().multiplyScalar(4.2));
    return true;
  }

  // ------------------------------------------------------------ physics
  _throw(v) {
    const sp = Math.min(v.length(), 7);
    this.throwV = v.clone().normalize().multiplyScalar(sp);
    this.tiltDir.copy(this.throwV).normalize();
    this.throwT = 0;
    this.slide.copy(this.throwV).multiplyScalar(0.12);
    this._splashSound(0.5);
    this.book._emit('coffee', { type: 'throw' });
  }

  _lip(dir, up = 0) {
    const s = this.scale, R = this.R * s, Hc = this.Hc * s;
    const t = this.tiltAmt;
    return new THREE.Vector3(
      this.pos.x + dir.x * (R * 0.92 + Math.sin(t) * Hc),
      this.pos.y + dir.y * (R * 0.92 + Math.sin(t) * Hc),
      this.pos.z + this.lift + Math.cos(t) * Hc + up
    );
  }

  _emit(origin, vx, vy, vz, size) {
    const d = this.d;
    let i = d.n;
    if (i >= MAX_DROPS) i = Math.floor(Math.random() * MAX_DROPS); else d.n++;
    d.x[i] = origin.x; d.y[i] = origin.y; d.z[i] = origin.z;
    d.vx[i] = vx; d.vy[i] = vy; d.vz[i] = vz; d.s[i] = size;
  }

  update(dt) {
    if (!this.book.list || !this.home) return false;
    const prevX = this.pos.x, prevY = this.pos.y;
    const s = this.scale;

    // move
    if (this.drag && this.target) {
      const k = 1 - Math.exp(-dt * 30);
      this.pos.x += (this.target.x - this.pos.x) * k;
      this.pos.y += (this.target.y - this.pos.y) * k;
      this.lift += (0.05 * s - this.lift) * (1 - Math.exp(-dt * 14));
    } else {
      this.pos.x += this.slide.x * dt; this.pos.y += this.slide.y * dt;
      this.slide.multiplyScalar(Math.exp(-dt * 6));
      const bb = this.bounds, R = this.R * s;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, bb.minX + R, bb.maxX - R);
      this.pos.y = THREE.MathUtils.clamp(this.pos.y, bb.minY + R, bb.maxY - R);
      this.lift += (0 - this.lift) * (1 - Math.exp(-dt * 16));
    }
    const zt = this._baseZ(this.pos.x, this.pos.y);
    this.pos.z += (zt - this.pos.z) * (1 - Math.exp(-dt * 18));

    // velocity / acceleration
    const nvx = (this.pos.x - prevX) / Math.max(dt, 1e-3), nvy = (this.pos.y - prevY) / Math.max(dt, 1e-3);
    const ax = (nvx - this.vel.x) / Math.max(dt, 1e-3), ay = (nvy - this.vel.y) / Math.max(dt, 1e-3);
    this.vel.x += (nvx - this.vel.x) * 0.5; this.vel.y += (nvy - this.vel.y) * 0.5;

    // liquid slosh: a damped spring pushed by the mug's acceleration
    const kS = 140, cS = 7, gain = 0.0035;
    this.sloshV.x += (-kS * this.slosh.x - cS * this.sloshV.x - THREE.MathUtils.clamp(ax, -400, 400) * gain * 60) * dt;
    this.sloshV.y += (-kS * this.slosh.y - cS * this.sloshV.y - THREE.MathUtils.clamp(ay, -400, 400) * gain * 60) * dt;
    this.slosh.x += this.sloshV.x * dt; this.slosh.y += this.sloshV.y * dt;
    if (this.slosh.length() > 0.7) this.slosh.setLength(0.7);

    // spill when the coffee climbs over the rim
    const sl = this.slosh.length();
    const limit = 0.12 + (1 - this.fill) * 0.9;
    if (sl > limit && this.fill > 0.05 && (this.drag || this.slide.length() > 0.2)) {
      const dir = this.slosh.clone().normalize();
      const n = Math.min(6, Math.ceil((sl - limit) * 30));
      for (let i = 0; i < n; i++) {
        const o = this._lip(dir, 0.004);
        this._emit(o, this.vel.x * 0.9 + dir.x * (0.4 + Math.random() * 0.6), this.vel.y * 0.9 + dir.y * (0.4 + Math.random() * 0.6),
          0.3 + Math.random() * 0.7, (0.006 + Math.random() * 0.012) * s);
        this.fill -= 0.0025;
      }
    }

    // throw: tip the mug and pour a burst along the throw
    if (this.throwT >= 0) {
      this.throwT += dt;
      const t = this.throwT;
      this.tiltAmt = t < 0.13 ? (t / 0.13) * 1.15 : Math.max(0, 1.15 * (1 - (t - 0.13) / 0.45));
      if (t < 0.2 && this.fill > 0.02) {
        const dir = this.tiltDir;
        const perp = new THREE.Vector2(-dir.y, dir.x);
        const n = Math.ceil(dt * 520 * Math.min(1, this.fill + 0.2));
        for (let i = 0; i < n; i++) {
          const side = (Math.random() - 0.5) * 2;
          const o = this._lip(dir, 0.01);
          o.x += perp.x * side * this.R * s * 0.7; o.y += perp.y * side * this.R * s * 0.7;
          const spread = 0.35 + Math.random() * 0.75;
          const big = Math.random() < 0.1;
          this._emit(o,
            this.throwV.x * spread + perp.x * side * 0.5 + (Math.random() - 0.5) * 0.4,
            this.throwV.y * spread + perp.y * side * 0.5 + (Math.random() - 0.5) * 0.4,
            0.6 + Math.random() * 1.6,
            (big ? 0.026 + Math.random() * 0.02 : 0.004 + Math.random() * Math.random() * 0.02) * s);
          this.fill -= 0.0072;
        }
      }
      if (t > 0.6) { this.throwT = -1; this.tiltAmt = 0; }
    } else if (this.drag) {
      // a slight lean while carried
      const lean = Math.min(0.18, this.vel.length() * 0.035);
      this.tiltAmt += (lean - this.tiltAmt) * 0.2;
      if (this.vel.lengthSq() > 1e-4) this.tiltDir.copy(this.vel).normalize();
    } else {
      this.tiltAmt *= Math.exp(-dt * 10);
    }
    this.fill = Math.max(0, this.fill);

    // refill after a while when it's (almost) empty
    const still = !this.drag && this.throwT < 0 && this.slide.length() < 0.05;
    this.idle = still ? this.idle + dt : 0;
    if (this.fill < 0.2 && this.idle > 2.2) this.fill = Math.min(0.85, this.fill + dt * 0.5);

    // mug ring on the page when it's been put down there
    if (!this.ringDone && still && this.idle > 0.9) {
      this.ringDone = true;
      if (this.fill > 0.05) {
        this.book.stainAt(this.pos.x, this.pos.y, { kind: 'ring', size: this.R * s * 0.9, seed: (Math.random() * 1e9) | 0 });
      }
    }

    // apply transforms
    this._place();
    const axis = new THREE.Vector3(-this.tiltDir.y, this.tiltDir.x, 0).normalize();
    this.tilt.quaternion.setFromAxisAngle(axis, this.tiltAmt);
    // keep the coffee level in the world, plus the slosh
    const level = new THREE.Quaternion();
    if (sl > 1e-4) level.setFromAxisAngle(new THREE.Vector3(this.slosh.y, -this.slosh.x, 0).normalize(), sl * 0.9);
    this.surface.quaternion.copy(this.tilt.quaternion).invert().multiply(level);
    const fz = 0.045 + this.fill * (this.Hc - 0.075);
    this.surface.position.set(0, 0, fz);
    this.surface.visible = this.fill > 0.02;
    const shrink = this.fill < 0.12 ? 0.82 + this.fill * 1.5 : 1;
    this.surface.scale.setScalar(shrink);

    this._updateSteam(dt);
    this._updateDrops(dt);
    return true; // steam and liquid are always gently moving
  }

  _updateSteam(dt) {
    const on = this.fill > 0.3 && !this.drag && this.throwT < 0;
    for (const sp of this.steam) {
      const u = sp.userData;
      u.t += dt * 0.28;
      if (u.t > 1) { u.t -= 1; u.sx = (Math.random() - 0.5) * 0.06; u.sy = (Math.random() - 0.5) * 0.06; }
      const t = u.t;
      sp.position.set(u.sx * t * 2 + Math.sin(t * 6 + u.sx * 40) * 0.015, u.sy * t * 2, this.Hc + 0.02 + t * 0.32);
      sp.scale.setScalar(0.07 + t * 0.16);
      const target = on ? Math.sin(Math.PI * t) * 0.16 : 0;
      sp.material.opacity += (target - sp.material.opacity) * Math.min(1, dt * 4);
    }
  }

  _updateDrops(dt) {
    const d = this.d, b = this.book;
    let w = 0, landed = 0;
    for (let i = 0; i < d.n; i++) {
      d.vz[i] -= G * dt;
      d.vx[i] *= 1 - 0.4 * dt; d.vy[i] *= 1 - 0.4 * dt;
      const x = d.x[i] + d.vx[i] * dt, y = d.y[i] + d.vy[i] * dt, z = d.z[i] + d.vz[i] * dt;
      const ground = b.surfaceZ(x, y);
      if (z <= ground) {
        landed++;
        const size = d.s[i];
        const speed = Math.hypot(d.vx[i], d.vy[i], d.vz[i]);
        // oblique hits smear: stretch by how flat the drop came in, along its flight
        const hv = Math.hypot(d.vx[i], d.vy[i]);
        const stretch = 1 + Math.min(2.2, (hv / (Math.abs(d.vz[i]) + 0.5)) * 0.9);
        const angle = -Math.atan2(d.vy[i], d.vx[i]); // canvas y points down
        const onPage = b.stainAt(x, y, { kind: 'drop', size: size * (1.5 + Math.min(1, speed * 0.12)), stretch, angle, seed: (Math.random() * 1e9) | 0 });
        if (!onPage) this._splat(x, y, ground, size);
        // a big fast drop splashes into a few smaller ones
        if (size > 0.014 && speed > 2.2 && d.n < MAX_DROPS - 6) {
          const m = 2 + Math.floor(Math.random() * 3);
          for (let k = 0; k < m; k++) {
            const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.8;
            this._emit({ x, y, z: ground + 0.003 }, Math.cos(a) * sp + d.vx[i] * 0.2, Math.sin(a) * sp + d.vy[i] * 0.2, 0.5 + Math.random() * 0.8, size * 0.32);
          }
        }
        continue; // drop removed
      }
      // keep (compact the arrays)
      d.x[w] = x; d.y[w] = y; d.z[w] = z; d.vx[w] = d.vx[i]; d.vy[w] = d.vy[i]; d.vz[w] = d.vz[i]; d.s[w] = d.s[i];
      // stretch along velocity, like a real falling drop
      this._v.set(d.vx[w], d.vy[w], d.vz[w]);
      const sp = this._v.length();
      if (sp > 1e-4) this._q.setFromUnitVectors(this._up, this._v.multiplyScalar(1 / sp)); else this._q.identity();
      const r = d.s[w];
      this._sc.set(r, r, r * (1 + Math.min(2.5, sp * 0.18)));
      this._m.compose(new THREE.Vector3(x, y, z), this._q, this._sc);
      this.drops.setMatrixAt(w, this._m);
      w++;
    }
    d.n = Math.min(w, MAX_DROPS);
    this.drops.count = d.n;
    this.drops.instanceMatrix.needsUpdate = true;
    if (landed) this._splashSound(Math.min(1, landed / 25));
    return d.n > 0;
  }

  _splat(x, y, z, size) {
    let m;
    if (this.splats.length < 160) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.renderOrder = 1;
      this.book.scene.add(m);
      this.splats.push(m);
    } else {
      m = this.splats[(this._splatI = ((this._splatI || 0) + 1) % this.splats.length)];
    }
    m.material.map = this.splatTex[(Math.random() * 4) | 0];
    m.material.needsUpdate = true;
    m.position.set(x, y, z + 0.0008);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.scale.setScalar(size * (7 + Math.random() * 4));
  }

  clearSplats() {
    for (const m of this.splats) { this.book.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.splats = [];
  }

  // ------------------------------------------------------------ sound
  _ctx() { const s = this.book.sound; return s.enabled ? s.ensure() : null; }

  _splashSound(amount) {
    const ctx = this._ctx();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this._lastSplash && now - this._lastSplash < 0.07) return;
    this._lastSplash = now;
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 600;
    const g = ctx.createGain(); g.gain.value = 0.12 + amount * 0.3;
    src.connect(f).connect(g).connect(this.book.sound.out);
    src.start();
  }

  _clink() {
    const ctx = this._ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [fq, gn] of [[2350, 0.05], [3720, 0.025], [5100, 0.012]]) {
      const o = ctx.createOscillator(); o.frequency.value = fq * (0.98 + Math.random() * 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gn, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(this.book.sound.out);
      o.start(t); o.stop(t + 0.3);
    }
  }
}
