import * as THREE from 'three';
import { stainCanvas } from './stains.js';

// A just-for-fun burger that sits left of the catalogue.
// Fling it and ketchup, mustard and sesame seeds fly onto the pages; double
// click squeezes it so sauce squirts out all around; drag it over the pages
// and it drips; leave it on a page and it leaves a grease spot.

const G = 26;
const MAX = 260;
const TYPES = {
  ketchup: { color: 0xb3140c, rough: 0.18, shape: [1, 1, 0.8] },
  mustard: { color: 0xe0a812, rough: 0.22, shape: [1, 1, 0.8] },
  seed: { color: 0xf1e2b6, rough: 0.5, shape: [1, 0.52, 0.34] },
};

export class Burger {
  constructor(book) {
    this.book = book;
    this.R = 0.2;
    this.scale = 1;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.slide = new THREE.Vector2();
    this.lift = 0;
    this.squash = 0; this.squashT = -1;
    this.wobble = 0;
    this.idle = 0;
    this.greaseDone = true;
    this.userMoved = false;
    this.dripT = 0;
    this._build();
    this._buildBlobs();
    this.splats = [];
    this.splatTex = {};
    for (const k of ['ketchup', 'mustard', 'seed']) {
      this.splatTex[k] = [0, 1, 2].map((i) => {
        const t = new THREE.CanvasTexture(stainCanvas(k, 4242 + i * 91, 128, { size: k === 'seed' ? 0.06 : 0.17 }));
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
    }
    book.extras.push(this);
    this.onResize();
    this.pos.copy(this.home);
    this._place();
  }

  // ------------------------------------------------------------ model
  _lathe(pts, color, opts = {}) {
    const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 64);
    g.rotateX(Math.PI / 2);
    if (opts.jitter) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y);
        if (r < 1e-4) continue;
        const k = 1 + (Math.random() - 0.5) * opts.jitter;
        p.setXY(i, x * k, y * k);
        p.setZ(i, p.getZ(i) + (Math.random() - 0.5) * opts.jitter * 0.05);
      }
      g.computeVertexNormals();
    }
    if (opts.gradient) {
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      const [lo, hi, z0, z1] = opts.gradient;
      const a = new THREE.Color(lo), b = new THREE.Color(hi), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        c.copy(a).lerp(b, THREE.MathUtils.clamp((p.getZ(i) - z0) / (z1 - z0), 0, 1));
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: opts.gradient ? 0xffffff : color, vertexColors: !!opts.gradient, roughness: opts.rough ?? 0.6,
      side: THREE.DoubleSide, flatShading: !!opts.flat,
    }));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  _build() {
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // squashes
    this.group.add(this.body);
    const add = (m) => { this.body.add(m); return m; };

    // bottom bun
    add(this._lathe([[0, 0], [0.165, 0], [0.19, 0.008], [0.2, 0.028], [0.196, 0.046], [0.185, 0.054], [0, 0.054]], 0xd9963e, { rough: 0.55 }));
    // patty (bumpy, flat shaded so it reads as grilled meat)
    add(this._lathe([[0, 0.054], [0.198, 0.054], [0.212, 0.066], [0.214, 0.08], [0.206, 0.094], [0.19, 0.1], [0, 0.1]], 0x4e2a15, { rough: 0.85, jitter: 0.06, flat: true }));

    // melted cheese with drooping corners
    const cg = new THREE.PlaneGeometry(0.37, 0.37, 16, 16);
    cg.rotateZ(Math.PI / 4 + 0.15);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const r = Math.hypot(cp.getX(i), cp.getY(i));
      cp.setZ(i, r > 0.19 ? -(r - 0.19) * 1.1 - Math.pow(r - 0.19, 2) * 4 : 0);
    }
    cg.computeVertexNormals();
    const cheese = add(new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0xf3b42e, roughness: 0.35, side: THREE.DoubleSide })));
    cheese.position.z = 0.103; cheese.castShadow = true; cheese.receiveShadow = true;

    // tomato slices
    for (const [x, y] of [[-0.05, 0.03], [0.06, -0.035]]) {
      const tg = new THREE.CylinderGeometry(0.088, 0.088, 0.013, 32); tg.rotateX(Math.PI / 2);
      const t = add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0xd2352a, roughness: 0.3 })));
      t.position.set(x, y, 0.112); t.castShadow = true;
    }
    // ruffled lettuce
    const lg = new THREE.RingGeometry(0.0, 0.228, 72, 5);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i), r = Math.hypot(x, y), a = Math.atan2(y, x);
      const k = r / 0.228;
      const rr = r * (1 + Math.sin(a * 7 + 1.3) * 0.05 * k + (Math.random() - 0.5) * 0.03 * k);
      lp.setXYZ(i, Math.cos(a) * rr, Math.sin(a) * rr, Math.sin(a * 11) * 0.011 * k * k - k * k * 0.012);
    }
    lg.computeVertexNormals();
    const lettuce = add(new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: 0x5f9f3a, roughness: 0.5, side: THREE.DoubleSide })));
    lettuce.position.z = 0.124; lettuce.castShadow = true; lettuce.receiveShadow = true;

    // top bun: golden dome, darker on top
    const top = add(this._lathe(
      [[0, 0.25], [0.07, 0.247], [0.125, 0.233], [0.165, 0.205], [0.192, 0.17], [0.203, 0.145], [0.2, 0.132], [0.186, 0.126], [0, 0.126]],
      0, { rough: 0.42, gradient: ['#e3a24f', '#a85a1c', 0.13, 0.25] }
    ));
    top.castShadow = true;

    // sesame seeds sitting on the dome
    const dome = (r) => { // z of the dome at radius r
      const pts = [[0, 0.25], [0.07, 0.247], [0.125, 0.233], [0.165, 0.205], [0.192, 0.17]];
      for (let i = 1; i < pts.length; i++) if (r <= pts[i][0]) {
        const [r0, z0] = pts[i - 1], [r1, z1] = pts[i];
        return z0 + ((r - r0) / (r1 - r0)) * (z1 - z0);
      }
      return 0.17;
    };
    const sg = new THREE.SphereGeometry(1, 8, 6);
    const seeds = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xf4e6bf, roughness: 0.4 }), 46);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 46; i++) {
      const r = Math.sqrt(Math.random()) * 0.175, a = Math.random() * Math.PI * 2;
      const tilt = r * 2.6;
      e.set(Math.sin(a) * -tilt, Math.cos(a) * tilt, Math.random() * Math.PI);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, dome(r) + 0.002), q, new THREE.Vector3(0.011, 0.0055, 0.0035));
      seeds.setMatrixAt(i, m);
    }
    seeds.castShadow = true;
    add(seeds);

    // ketchup oozing out at the edge
    const kmat = new THREE.MeshStandardMaterial({ color: 0xb3140c, roughness: 0.15 });
    for (let i = 0; i < 5; i++) {
      const a = 2.3 + i * 0.5 + Math.random() * 0.3;
      const k = add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), kmat));
      k.position.set(Math.cos(a) * 0.205, Math.sin(a) * 0.205, 0.098 - Math.random() * 0.012);
      k.scale.set(0.022 + Math.random() * 0.012, 0.018, 0.012 + Math.random() * 0.01);
      k.rotation.z = a;
    }

    this.book.scene.add(this.group);
    this.pickables = this.body.children;
  }

  _buildBlobs() {
    this.blobs = {};
    for (const [k, t] of Object.entries(TYPES)) {
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: t.color, roughness: t.rough }), MAX);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.castShadow = true; im.frustumCulled = false;
      this.book.scene.add(im);
      this.blobs[k] = { im, x: [], y: [], z: [], vx: [], vy: [], vz: [], s: [], rot: [], n: 0, shape: t.shape };
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3(); this._up = new THREE.Vector3(0, 0, 1); this._p = new THREE.Vector3();
  }

  // ------------------------------------------------------------ layout
  onResize() {
    const b = this.book;
    if (!b.H) return;
    this.scale = b.portrait ? 0.55 : 1;
    this.bounds = this._visibleBounds(0.25 * this.scale);
    this.group.scale.setScalar(this.scale);
    const R = this.R * this.scale, bb = this.bounds;
    if (b.portrait) this.home = new THREE.Vector3(bb.minX + R + 0.16, bb.minY + R + 0.3, 0);
    else this.home = new THREE.Vector3(Math.max(-(1 + 0.022 + R + 0.12), bb.minX + R * 1.2), b.H * 0.12, 0);
    if (!this.userMoved) { this.pos.copy(this.home); this._place(); }
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
    const r = this.R * this.scale * 0.7;
    let z = 0;
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) z = Math.max(z, this.book.surfaceZ(x + dx, y + dy));
    return z;
  }

  _place() { this.group.position.set(this.pos.x, this.pos.y, this.pos.z + this.lift); }

  // ------------------------------------------------------------ input
  _ray(e) {
    const r = this.book.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.book.camera);
    return ray;
  }
  _hit(e) { return this._ray(e).intersectObjects(this.pickables, true).length > 0; }
  _planePoint(e, z) {
    const p = new THREE.Vector3();
    return this._ray(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p) ? p : null;
  }

  onDown(e) {
    if (!this.book.list || !this._hit(e)) return false;
    const p = this._planePoint(e, this.pos.z);
    if (!p) return false;
    try { this.book.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.drag = { id: e.pointerId, off: new THREE.Vector2(this.pos.x - p.x, this.pos.y - p.y), z: this.pos.z };
    this.userMoved = true;
    this.slide.set(0, 0);
    this.greaseDone = true;
    this.book.renderer.domElement.style.cursor = 'grabbing';
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
        if (over) this.book._emit('burger', { type: 'hover' });
      }
    }
    return false;
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return false;
    this.drag = null; this.target = null;
    this.book.renderer.domElement.style.cursor = this._over ? 'grab' : '';
    const speed = this.vel.length();
    if (speed > 1.5) this._fling(this.vel.clone());
    else { this.slide.copy(this.vel).multiplyScalar(0.12); this.greaseDone = false; this.idle = 0; this._thud(0.4); }
    return true;
  }

  onDbl(e) {
    if (!this._hit(e)) return false;
    this._squeeze();
    return true;
  }

  // ------------------------------------------------------------ actions
  _rim(dirX, dirY, z = 0.085) {
    const s = this.scale, R = this.R * s;
    return { x: this.pos.x + dirX * R * 1.02, y: this.pos.y + dirY * R * 1.02, z: this.pos.z + this.lift + z * s };
  }

  _fling(v) {
    const sp = Math.min(v.length(), 6.5);
    const dir = v.clone().normalize();
    const perp = new THREE.Vector2(-dir.y, dir.x);
    const s = this.scale;
    const shoot = (type, n, size, speedK, up) => {
      for (let i = 0; i < n; i++) {
        const side = (Math.random() - 0.5) * 1.6;
        const o = this._rim(dir.x * 0.6 + perp.x * side * 0.6, dir.y * 0.6 + perp.y * side * 0.6, type === 'seed' ? 0.24 : 0.085);
        const k = speedK * (0.45 + Math.random() * 0.75);
        this._emit(type, o, dir.x * sp * k + perp.x * side * 0.6, dir.y * sp * k + perp.y * side * 0.6, up * (0.6 + Math.random() * 0.8), size() * s);
      }
    };
    shoot('ketchup', 16 + Math.floor(Math.random() * 10), () => 0.011 + Math.random() * Math.random() * 0.03, 0.85, 1.3);
    shoot('mustard', 8 + Math.floor(Math.random() * 6), () => 0.01 + Math.random() * Math.random() * 0.022, 0.8, 1.2);
    shoot('seed', 6 + Math.floor(Math.random() * 6), () => 0.012, 1.0, 1.8);
    this.slide.copy(v).multiplyScalar(0.12);
    this.squashT = 0; this.squashAmp = 0.18;
    this._squish();
    this.book._emit('burger', { type: 'throw' });
  }

  _squeeze() {
    this.squashT = 0; this.squashAmp = 0.32;
    const s = this.scale;
    // sauce squirts out all around the patty
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, type = Math.random() < 0.62 ? 'ketchup' : 'mustard';
      const sp = 0.9 + Math.random() * 1.6;
      const o = this._rim(Math.cos(a), Math.sin(a), 0.09);
      this._emit(type, o, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.9, (0.009 + Math.random() * Math.random() * 0.024) * s);
    }
    this._squish();
  }

  _emit(type, o, vx, vy, vz, size) {
    const b = this.blobs[type];
    let i = b.n;
    if (i >= MAX) i = Math.floor(Math.random() * MAX); else b.n++;
    b.x[i] = o.x; b.y[i] = o.y; b.z[i] = o.z; b.vx[i] = vx; b.vy[i] = vy; b.vz[i] = vz; b.s[i] = size; b.rot[i] = Math.random() * 6.28;
  }

  // ------------------------------------------------------------ frame
  update(dt) {
    if (!this.book.list || !this.home) return false;
    const prevX = this.pos.x, prevY = this.pos.y, s = this.scale;
    if (this.drag && this.target) {
      const k = 1 - Math.exp(-dt * 26);
      this.pos.x += (this.target.x - this.pos.x) * k;
      this.pos.y += (this.target.y - this.pos.y) * k;
      this.lift += (0.06 * s - this.lift) * (1 - Math.exp(-dt * 14));
    } else {
      this.pos.x += this.slide.x * dt; this.pos.y += this.slide.y * dt;
      this.slide.multiplyScalar(Math.exp(-dt * 6));
      const bb = this.bounds, R = this.R * s;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, bb.minX + R, bb.maxX - R);
      this.pos.y = THREE.MathUtils.clamp(this.pos.y, bb.minY + R, bb.maxY - R);
      this.lift += (0 - this.lift) * (1 - Math.exp(-dt * 16));
    }
    this.pos.z += (this._baseZ(this.pos.x, this.pos.y) - this.pos.z) * (1 - Math.exp(-dt * 18));
    const nvx = (this.pos.x - prevX) / Math.max(dt, 1e-3), nvy = (this.pos.y - prevY) / Math.max(dt, 1e-3);
    this.vel.x += (nvx - this.vel.x) * 0.5; this.vel.y += (nvy - this.vel.y) * 0.5;

    // carried over the catalogue: the odd drip of ketchup falls out
    if (this.drag && this.vel.length() > 0.4) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 0.18 + Math.random() * 0.3;
        const a = Math.random() * Math.PI * 2;
        this._emit(Math.random() < 0.75 ? 'ketchup' : 'mustard', this._rim(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.05),
          this.vel.x * 0.5, this.vel.y * 0.5, -0.2, (0.008 + Math.random() * 0.012) * s);
      }
    }

    // squash and stretch
    if (this.squashT >= 0) {
      this.squashT += dt;
      const t = this.squashT;
      this.squash = this.squashAmp * Math.exp(-t * 7) * Math.cos(t * 26);
      if (t > 0.8) { this.squashT = -1; this.squash = 0; }
    }
    const sq = this.squash;
    this.body.scale.set(1 + sq * 0.5, 1 + sq * 0.5, 1 - sq);
    // a small wobble while carried
    const lean = this.drag ? Math.min(0.15, this.vel.length() * 0.03) : 0;
    this.wobble += (lean - this.wobble) * 0.2;
    const ax = this.vel.lengthSq() > 1e-4 ? new THREE.Vector3(-this.vel.y, this.vel.x, 0).normalize() : new THREE.Vector3(1, 0, 0);
    this.body.quaternion.setFromAxisAngle(ax, this.wobble);

    // grease spot when it's been left on a page
    const still = !this.drag && this.slide.length() < 0.05;
    this.idle = still ? this.idle + dt : 0;
    if (!this.greaseDone && still && this.idle > 1.0) {
      this.greaseDone = true;
      this.book.stainAt(this.pos.x, this.pos.y, { kind: 'grease', size: this.R * s * 0.85, seed: (Math.random() * 1e9) | 0 });
    }

    this._place();
    this._updateBlobs(dt);
    return true;
  }

  _updateBlobs(dt) {
    const book = this.book;
    let landed = 0;
    for (const [type, b] of Object.entries(this.blobs)) {
      let w = 0;
      for (let i = 0; i < b.n; i++) {
        b.vz[i] -= G * dt;
        const drag = type === 'seed' ? 0.8 : 0.3;
        b.vx[i] *= 1 - drag * dt; b.vy[i] *= 1 - drag * dt;
        const x = b.x[i] + b.vx[i] * dt, y = b.y[i] + b.vy[i] * dt, z = b.z[i] + b.vz[i] * dt;
        const ground = book.surfaceZ(x, y);
        if (z <= ground) {
          landed++;
          const hv = Math.hypot(b.vx[i], b.vy[i]);
          const stretch = type === 'seed' ? 1 : 1 + Math.min(1.4, (hv / (Math.abs(b.vz[i]) + 0.6)) * 0.45);
          const op = {
            kind: type, size: type === 'seed' ? 0.0085 : b.s[i] * 1.25,
            stretch, angle: -Math.atan2(b.vy[i], b.vx[i]), seed: (Math.random() * 1e9) | 0,
          };
          if (!book.stainAt(x, y, op)) this._splat(type, x, y, ground, b.s[i]);
          continue;
        }
        b.x[w] = x; b.y[w] = y; b.z[w] = z; b.vx[w] = b.vx[i]; b.vy[w] = b.vy[i]; b.vz[w] = b.vz[i]; b.s[w] = b.s[i];
        b.rot[w] = b.rot[i] + dt * 8;
        // sauce stretches as it flies; seeds tumble
        this._v.set(b.vx[w], b.vy[w], b.vz[w]);
        const sp = this._v.length();
        const r = b.s[w];
        if (type === 'seed') {
          this._q.setFromEuler(new THREE.Euler(b.rot[w], b.rot[w] * 0.7, b.rot[w] * 0.3));
          this._sc.set(r * b.shape[0], r * b.shape[1], r * b.shape[2]);
        } else {
          if (sp > 1e-4) this._q.setFromUnitVectors(this._up, this._v.multiplyScalar(1 / sp)); else this._q.identity();
          this._sc.set(r, r, r * (1 + Math.min(1.6, sp * 0.12)));
        }
        this._m.compose(this._p.set(x, y, z), this._q, this._sc);
        b.im.setMatrixAt(w, this._m);
        w++;
      }
      b.n = w;
      b.im.count = w;
      b.im.instanceMatrix.needsUpdate = true;
    }
    if (landed) this._splatSound(Math.min(1, landed / 12));
  }

  _splat(type, x, y, z, size) {
    let m;
    if (this.splats.length < 120) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.renderOrder = 1;
      this.book.scene.add(m);
      this.splats.push(m);
    } else {
      m = this.splats[(this._si = ((this._si || 0) + 1) % this.splats.length)];
    }
    m.material.map = this.splatTex[type][(Math.random() * 3) | 0];
    m.material.needsUpdate = true;
    m.position.set(x, y, z + 0.0009);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.scale.setScalar(type === 'seed' ? 0.09 : size * 6.5);
  }

  clearSplats() {
    for (const m of this.splats) { this.book.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.splats = [];
  }

  // ------------------------------------------------------------ sound
  _ctx() { const s = this.book.sound; return s.enabled ? s.ensure() : null; }

  _noise(dur, freqFrom, freqTo, gain, q = 0.8) {
    const ctx = this._ctx();
    if (!ctx) return;
    const t = ctx.currentTime, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freqFrom, t); f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.book.sound.out);
    src.start();
  }

  _squish() { this._noise(0.32, 900, 220, 0.5, 1.4); this._noise(0.18, 2600, 900, 0.12, 0.7); }
  _thud(a) { this._noise(0.14, 260, 120, 0.4 * a, 1.2); }
  _splatSound(a) {
    const ctx = this._ctx();
    if (!ctx) return;
    if (this._ls && ctx.currentTime - this._ls < 0.06) return;
    this._ls = ctx.currentTime;
    this._noise(0.12, 700 + Math.random() * 300, 260, 0.15 + a * 0.3, 1.1);
  }
}
