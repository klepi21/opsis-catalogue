import * as THREE from 'three';

// A thick 3D marker. It lies on the table; click it to pick it up, then
// press and drag on the pages to write. Its tip follows the pointer, it leans
// like a pen in a right hand and casts a shadow on the paper. Strokes are
// saved on the page they were drawn on (and turn with it).

export const PEN_COLORS = {
  red: { color: '#d3202a', width: 0.015, mode: 'marker' },
  blue: { color: '#1d4fd8', width: 0.015, mode: 'marker' },
  black: { color: '#17191e', width: 0.015, mode: 'marker' },
  highlighter: { color: '#ffe23d', width: 0.034, mode: 'highlighter' },
};

const L = 0.56; // pen length (tip at local origin, body along +z)

export class Pen {
  constructor(book) {
    this.book = book;
    this.active = false;
    this.colorName = 'red';
    this.scale = 1;
    this.tip = new THREE.Vector3();
    this.tipTarget = new THREE.Vector3();
    this.pressed = false;
    this.strokeId = 0;
    this.history = [];
    this._build();
    book.extras.unshift(this); // the pen gets first say over pointer input
    this.onResize();
    this.group.position.copy(this.restPos);
    this.group.quaternion.copy(this.restQuat);
  }

  _build() {
    this.group = new THREE.Group();
    const cyl = (r0, r1, z0, z1, mat, seg = 32) => {
      const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, (z0 + z1) / 2);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.inkMat = new THREE.MeshStandardMaterial({ color: 0xd3202a, roughness: 0.55 });
    this.capMat = new THREE.MeshStandardMaterial({ color: 0xd3202a, roughness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f6f7, roughness: 0.25 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.35 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.9 });

    cyl(0.004, 0.01, 0, 0.032, this.inkMat, 16);        // felt nib
    const nibTip = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), this.inkMat);
    this.group.add(nibTip);
    cyl(0.011, 0.028, 0.032, 0.1, grey);                // cone
    cyl(0.031, 0.031, 0.1, 0.22, rubber);               // grip
    cyl(0.03, 0.03, 0.22, 0.47, white);                 // body
    cyl(0.0305, 0.0305, 0.43, 0.455, this.capMat);      // colour band
    cyl(0.032, 0.032, 0.47, 0.545, this.capMat);        // end cap
    const end = new THREE.Mesh(new THREE.SphereGeometry(0.032, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.capMat);
    end.rotation.x = Math.PI / 2; end.position.z = 0.545; end.castShadow = true;
    this.group.add(end);
    // pocket clip
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.16), this.capMat);
    clip.position.set(0, 0.036, 0.44); clip.castShadow = true;
    this.group.add(clip);

    this.book.scene.add(this.group);
    this.pickables = this.group.children;
  }

  setColor(name) {
    if (!PEN_COLORS[name]) return;
    this.colorName = name;
    const c = new THREE.Color(PEN_COLORS[name].color);
    this.inkMat.color.copy(c);
    this.capMat.color.copy(c);
    this.book.dirty = true;
    this.book._emit('pen', { color: name });
  }

  // ------------------------------------------------------------ layout
  onResize() {
    const b = this.book;
    if (!b.H) return;
    this.scale = b.portrait ? 0.62 : 1;
    const bb = this._visibleBounds(0.07 * this.scale);
    this.bounds = bb;
    this.group.scale.setScalar(this.scale);
    const ang = b.portrait ? 0.15 : -0.5;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
    // lying on the table: below the cup on desktop, bottom centre on phones
    const centre = b.portrait
      ? new THREE.Vector3((bb.minX + bb.maxX) / 2, bb.minY + 0.22, 0)
      : new THREE.Vector3(
          Math.min(1.3, bb.maxX - (L / 2) * Math.abs(Math.cos(ang)) - 0.14),
          Math.max(-b.H * 0.45, bb.minY + (L / 2) * Math.abs(Math.sin(ang)) + 0.12), 0);
    this.restPos = centre.clone().addScaledVector(dir, (-L / 2) * this.scale);
    this.restPos.z = 0.032 * this.scale + centre.z;
    this.restQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // roll it so the clip points up
    this.restQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    // held: lean back towards the bottom right, like a right hand holds it
    const lean = new THREE.Vector3(0.42, -0.5, 0.76).normalize();
    this.heldQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), lean);
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

  // ------------------------------------------------------------ mode
  activate() {
    if (this.active) return;
    this.active = true;
    this.book.renderer.domElement.style.cursor = 'none';
    this.tip.copy(this.group.position);
    this.book._emit('pen', { active: true, color: this.colorName });
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.drawing = null;
    this.pressed = false;
    this.book.renderer.domElement.style.cursor = '';
    this.book._emit('pen', { active: false });
  }

  undo() {
    const id = this.history.pop();
    if (id != null) this.book.removeStains((o) => o.stroke === id);
  }

  // ------------------------------------------------------------ input
  _ray(e) {
    const r = this.book.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.book.camera);
    return ray;
  }

  _paperPoint(e) {
    // intersect with the page surface (refine once using the surface height there)
    const ray = this._ray(e).ray, p = new THREE.Vector3();
    let z = 0.05;
    for (let k = 0; k < 2; k++) {
      if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p)) return null;
      z = this.book.surfaceZ(p.x, p.y);
    }
    p.z = z;
    return p;
  }

  onDown(e) {
    if (!this.book.list) return false;
    if (!this.active) {
      if (!this._ray(e).intersectObjects(this.pickables, false).length) return false;
      this.activate();
      const p = this._paperPoint(e);
      if (p) this.tipTarget.copy(p);
      return true;
    }
    const p = this._paperPoint(e);
    if (!p) return true;
    try { this.book.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.tipTarget.copy(p);
    this.pressed = true;
    const style = { ...PEN_COLORS[this.colorName], stroke: ++this.strokeId };
    this.drawing = { id: e.pointerId, style, h: this.book.inkStart(p.x, p.y, style), used: false };
    if (this.drawing.h) this.drawing.used = true;
    return true;
  }

  onMove(e) {
    if (!this.book.list) return false;
    if (!this.active) {
      if (e.pointerType === 'mouse' && !e.buttons) {
        const over = this._ray(e).intersectObjects(this.pickables, false).length > 0;
        if (over !== this._over) {
          this._over = over;
          this.book.renderer.domElement.style.cursor = over ? 'pointer' : '';
          if (over) this.book._emit('pen', { hover: true });
        }
      }
      return false;
    }
    const p = this._paperPoint(e);
    if (p) this.tipTarget.copy(p);
    if (this.drawing && e.pointerId === this.drawing.id && p) {
      this.drawing.h = this.book.inkMove(this.drawing.h, p.x, p.y, this.drawing.style);
      if (this.drawing.h) this.drawing.used = true;
    }
    return true;
  }

  onUp(e) {
    if (!this.active) return false;
    if (this.drawing && e.pointerId === this.drawing.id) {
      if (this.drawing.used) this.history.push(this.drawing.style.stroke);
      this.drawing = null;
      this.pressed = false;
    }
    return true;
  }

  onDbl() { return this.active; }

  // ------------------------------------------------------------ frame
  update(dt) {
    if (!this.restPos) return false;
    const g = this.group;
    if (this.active) {
      // the tip hovers just above the paper and touches it while pressed
      const hover = this.pressed ? 0.002 : 0.04 * this.scale;
      const k = 1 - Math.exp(-dt * 45);
      this.tip.x += (this.tipTarget.x - this.tip.x) * k;
      this.tip.y += (this.tipTarget.y - this.tip.y) * k;
      this.tip.z += (this.tipTarget.z + hover - this.tip.z) * (1 - Math.exp(-dt * 25));
      g.position.copy(this.tip);
      g.quaternion.slerp(this.heldQuat, 1 - Math.exp(-dt * 12));
    } else {
      g.position.lerp(this.restPos, 1 - Math.exp(-dt * 9));
      g.quaternion.slerp(this.restQuat, 1 - Math.exp(-dt * 9));
    }
    return this.active || g.position.distanceToSquared(this.restPos) > 1e-7;
  }
}
