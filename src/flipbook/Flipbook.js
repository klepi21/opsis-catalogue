import * as THREE from 'three';
import { constrainPointer, deformPage } from './curl.js';
import { PdfSource } from './pdfSource.js';
import { PaperSound } from './sound.js';
import { drawStain } from './stains.js';

const W = 1;                 // page width in world units, height comes from the PDF
const SEG_X = 72, SEG_Y = 44; // flipping page tessellation
const BOARD_T = 0.028;       // hardcover thickness
const BOARD_M = 0.022;       // how far the cover sticks out around the pages
const SHEET_T = 0.0011;      // thickness of one sheet (2 pages)
const GUTTER_A = 0.016;      // how deep pages dip into the spine
const GUTTER_K = 0.075;
const R_BASE = 0.17;         // curl radius
const LIFT_DRAG = 0.08, LIFT_AUTO = 0.2;

const bulge = (u) => GUTTER_A * (1 - Math.exp(-u / GUTTER_K));
const gutterShade = (u) => 1 - 0.32 * Math.exp(-u / 0.03) - 0.07 * Math.exp(-u / 0.18);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Flipbook extends EventTarget {
  constructor(container, opts = {}) {
    super();
    this.container = container;
    this.opts = { wheelZoom: true, sound: true, coverColor: '#24382d', padding: { top: 0, bottom: 0, side: 0 }, ...opts };
    this.sound = new PaperSound();
    this.sound.enabled = this.opts.sound;
    this.spread = 0;
    this.flip = null;
    this.pending = [];
    this.portrait = false; // single page view on tall screens
    this.focus = 'R';      // which page of the spread the portrait view shows
    this.zoom = 1; this.zoomTarget = 1;
    this.pan = new THREE.Vector2(); this.panTarget = new THREE.Vector2();
    this.pointers = new Map();
    this.tex = new Map();
    this.stains = new Map();   // page index -> coffee stains (page uv space)
    this._stainDirty = new Set();
    this.extras = [];          // add-ons living in the scene (the coffee cup)
    this.dirty = true;
    this._initThree();
    this._bind();
    this._clock = new THREE.Clock();
    this._raf = requestAnimationFrame(this._loop);
  }

  // ---------------------------------------------------------------- public

  async load(src) {
    this.pdf?.destroy();
    this.tex.forEach((t) => t.tex.dispose());
    this.tex.clear();
    this.pdf = new PdfSource();
    await this.pdf.open(src, (p) => this._emit('progress', { loaded: p }));
    const n = this.pdf.numPages;
    this._makeList();
    this.H = W * this.pdf.aspect;
    this.spread = 0;
    this.flip = null;
    this.focus = 'R';
    this._buildBook();
    this._fitCamera();
    this._updateStatic();
    this._requestTextures();
    this.dirty = true;
    this._emit('ready', { pages: n });
    this._emitFlip();
  }

  get pageCount() { return this.pdf?.numPages ?? 0; }

  /** pdf page numbers visible right now */
  visiblePages(s = this.spread) {
    const both = [this.list[2 * s], this.list[2 * s + 1]];
    const shown = this.portrait ? [both[this.focus === 'L' ? 0 : 1]] : both;
    return shown.filter((e) => e && e.page).map((e) => e.page);
  }

  get canNext() {
    if (this.portrait && this.focus === 'L' && this._isPage(2 * this.spread + 1)) return true;
    return this.spread < this.numSpreads - 1;
  }
  get canPrev() {
    if (this.portrait && this.focus === 'R' && this._isPage(2 * this.spread)) return true;
    return this.spread > 0;
  }

  next() {
    if (this.portrait && !this.flip && this.focus === 'L' && this._isPage(2 * this.spread + 1)) return this._setFocus('R');
    this._auto(+1);
  }
  prev() {
    if (this.portrait && !this.flip && this.focus === 'R' && this._isPage(2 * this.spread)) return this._setFocus('L');
    this._auto(-1);
  }
  goToPage(no) {
    const t = this._spreadOf(no);
    const side = this._sideOf(no);
    if (t === this.spread) { if (this.portrait) this._setFocus(side); return; }
    this._landFocus = side;
    this._auto(t > this.spread ? 1 : -1, t);
  }

  _isPage(i) { return !!this.list?.[i]?.page; }

  // two page layouts:
  //   spread view: [inside front cover, p1 ... pn, (inside back cover if needed)]
  //   single view (phones): every page is a right hand page with a blank back, [paper, p1, paper, p2 ...]
  //   so a turn is just the sheet going over, and the camera never has to move
  _makeList() {
    const n = this.pdf.numPages;
    this.list = [{ paper: true }];
    for (let i = 1; i <= n; i++) {
      this.list.push({ page: i });
      if (this.portrait && i < n) this.list.push({ paper: true });
    }
    if (this.list.length % 2) this.list.push({ paper: true });
    this.numSpreads = this.list.length / 2;
  }
  _spreadOf(no) { return clamp(this.portrait ? no - 1 : Math.floor(no / 2), 0, this.numSpreads - 1); }
  _sideOf(no) { return this.portrait || no % 2 ? 'R' : 'L'; }

  // the view switched between single and spread: rebuild the book on the same page
  _relayout() {
    if (!this.pdf) return;
    const at = this.visiblePagesFor(!this.portrait)[0] || 1;
    if (this.flip) { this.flip = null; this.flipGroup && (this.flipGroup.visible = false); }
    this.pending = [];
    this.tex.forEach((t) => t.tex?.dispose());
    this.tex.clear();
    this.stains.clear();
    this._makeList();
    this.spread = this._spreadOf(at);
    this.focus = this._sideOf(at);
    this._normalizeFocus();
    this._buildBook();
    this._updateStatic();
    this._requestTextures();
  }
  // pages of the current spread as the previous layout would show them
  visiblePagesFor(wasPortrait) {
    const both = [this.list?.[2 * this.spread], this.list?.[2 * this.spread + 1]];
    const shown = wasPortrait ? [both[this.focus === 'L' ? 0 : 1]] : both;
    return shown.filter((e) => e && e.page).map((e) => e.page);
  }
  _baseX() { return this.portrait ? (this.focus === 'L' ? -1 : 1) * W / 2 : 0; }
  _normalizeFocus() {
    if (!this.portrait) return;
    if (this.focus === 'L' && !this._isPage(2 * this.spread)) this.focus = 'R';
    else if (this.focus === 'R' && !this._isPage(2 * this.spread + 1) && this._isPage(2 * this.spread)) this.focus = 'L';
  }
  _setFocus(side) {
    this.focus = side;
    this._normalizeFocus();
    if (this.zoomTarget > 1.02) this.zoomTarget = 1;
    this.panTarget.set(this._baseX(), 0);
    this.dirty = true;
    this._emitFlip();
  }

  /** jump without animation, e.g. for ?page= deep links */
  jumpToPage(no) {
    if (!this.list) return;
    if (this.flip) this._cancelFlip();
    this.spread = this._spreadOf(no);
    this.focus = this._sideOf(no);
    this._normalizeFocus();
    this.panTarget.set(this._baseX(), 0); this.pan.copy(this.panTarget); this._placeCamera();
    this._updateStatic();
    this._requestTextures();
    this._emitFlip();
  }

  setZoom(z, focusWorld) {
    this.zoomTarget = clamp(z, 1, 4);
    if (focusWorld && this.zoomTarget > 1) this.panTarget.set(focusWorld.x, focusWorld.y);
    if (this.zoomTarget === 1) this.panTarget.set(this._baseX(), 0);
    this._clampPan();
    this.dirty = true;
  }

  renderThumb(pageNo, height = 180) { return this.pdf.render(pageNo, height, 1000 + pageNo); }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this._unbind();
    this.pdf?.destroy();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- scene

  // dark room: softer fill light and a deeper shadow, the pages stay readable like under a lamp
  setDark(on) {
    this.hemi.intensity = on ? 0.62 : 1.05;
    this.key.intensity = on ? 2.05 : 2.35;
    this.groundMat.opacity = on ? 0.55 : 0.32;
    this._calibratePaper(); // pages keep the PDF's exact colours in both themes
  }

  _initThree() {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 3)); // full screen resolution, 3x phones included
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'fb-canvas';
    r.domElement.style.touchAction = 'none';
    this.container.appendChild(r.domElement);
    this.maxAniso = r.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);

    const hemi = (this.hemi = new THREE.HemisphereLight(0xfffaf0, 0x9a9488, 1.05));
    this.scene.add(hemi);
    const key = (this.key = new THREE.DirectionalLight(0xfffdf8, 2.35));
    key.position.set(-1.4, 1.9, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -1.6; sc.right = 1.6; sc.top = 1.6; sc.bottom = -1.6; sc.near = 1; sc.far = 12;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.003;
    this.scene.add(key, key.target);
    this._calibratePaper();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      (this.groundMat = new THREE.ShadowMaterial({ opacity: 0.32 }))
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.book = new THREE.Group();
    this.scene.add(this.book);

    this.paperTex = this._makePaperTexture();
    this.edgeTex = this._makeEdgeTexture();

    // unlock audio on the first interaction anywhere (so buttons and keys also get sound)
    this._unlock = () => this.sound.ensure();
    window.addEventListener('pointerdown', this._unlock, { once: true });
    window.addEventListener('keydown', this._unlock, { once: true });
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.container);
    this._resize();
  }

  _makePaperTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 720;
    const g = c.getContext('2d');
    g.fillStyle = this.opts.paperColor || '#efe7d6';
    g.fillRect(0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.06;
    g.strokeStyle = this.opts.fiberColor || '#7a6a4a';
    for (let i = 0; i < 260; i++) {
      g.beginPath();
      const x = Math.random() * c.width, y = Math.random() * c.height;
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _makeEdgeTexture() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = this.opts.edgeColor || '#ece4d2';
    g.fillRect(0, 0, 4, 256);
    for (let y = 0; y < 256; y += 4) {
      g.fillStyle = `rgba(${this.opts.edgeLine || '110,95,70'},${0.1 + Math.random() * 0.18})`;
      g.fillRect(0, y + Math.random() * 2, 4, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  _pageMaterial() {
    // matte paper (pure diffuse, so lighting only scales the colour) tinted by the inverse of the light
    // that falls on a flat page: a page lying flat shows the PDF's exact colours, curves still shade
    const m = new THREE.MeshLambertMaterial({ map: this.paperTex, vertexColors: true });
    m.color.copy(this._pageTint || new THREE.Color(1, 1, 1));
    (this._pageMats ||= new Set()).add(m);
    return m;
  }

  // how much light a flat, face up white page receives, measured with the real lights, then inverted
  _calibratePaper() {
    const r = this.renderer;
    const type = r.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.UnsignedByteType;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type });
    const scene = new THREE.Scene();
    const hemi = this.hemi.clone(); hemi.position.copy(this.hemi.position);
    const key = new THREE.DirectionalLight(this.key.color, this.key.intensity);
    key.position.copy(this.key.position).sub(this.key.target.position);
    scene.add(hemi, key, key.target);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.render(scene, cam);
    const px = type === THREE.FloatType ? new Float32Array(4) : new Uint8Array(4);
    r.readRenderTargetPixels(rt, 1, 1, 1, 1, px);
    r.setRenderTarget(prev);
    rt.dispose(); quad.geometry.dispose(); quad.material.dispose();
    const k = type === THREE.FloatType ? 1 : 1 / 255;
    const f = [px[0] * k, px[1] * k, px[2] * k].map((v) => (v > 0.01 ? v : 1));
    this._pageTint = new THREE.Color().setRGB(1 / f[0], 1 / f[1], 1 / f[2]);
    this._pageMats?.forEach((m) => m.color.copy(this._pageTint));
    this.dirty = true;
  }

  _pageGeometry(segX, segY, mirrorUV) {
    const H = this.H;
    const g = new THREE.PlaneGeometry(W, H, segX, segY);
    g.translate(W / 2, 0, 0);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      pos.setZ(i, bulge(u));
      // a single page catalogue has no spine to darken
      const s = this.portrait ? 1 : gutterShade(u);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
      if (mirrorUV) uv.setX(i, 1 - u / W);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.userData.rest = pos.array.slice();
    return g;
  }

  _buildBook() {
    this._pageMats?.clear();
    // clear old book
    while (this.book.children.length) {
      const m = this.book.children.pop();
      m.traverse?.((o) => { o.geometry?.dispose(); });
    }
    const H = this.H;

    // hardcover boards
    const coverMat = new THREE.MeshStandardMaterial({ color: this.opts.coverColor, roughness: 0.92 });
    const boardGeo = new THREE.BoxGeometry(W + BOARD_M, H + 2 * BOARD_M, BOARD_T);
    this.boards = [];
    for (const side of [1, -1]) {
      const b = new THREE.Mesh(boardGeo, coverMat);
      b.position.set((side * (W + BOARD_M)) / 2, 0, BOARD_T / 2);
      b.castShadow = true; b.receiveShadow = true;
      this.book.add(b);
      this.boards.push(b);
    }
    // page stacks (side faces follow the gutter curve of the top page)
    const edgeMat = new THREE.MeshStandardMaterial({ map: this.edgeTex, roughness: 0.9 });
    this.stackR = this._makeStack(edgeMat); this.book.add(this.stackR);
    this.stackL = this._makeStack(edgeMat); this.stackL.scale.x = -1; this.book.add(this.stackL);

    // static pages
    this.staticR = new THREE.Mesh(this._pageGeometry(SEG_X, 1, false), this._pageMaterial());
    this.staticL = new THREE.Mesh(this._pageGeometry(SEG_X, 1, true), this._pageMaterial());
    this.staticL.scale.x = -1;
    for (const m of [this.staticR, this.staticL]) { m.receiveShadow = true; this.book.add(m); }

    // the flipping sheet: two meshes (front/back) sharing one deforming geometry
    const fg = this._pageGeometry(SEG_X, SEG_Y, false);
    const bg = new THREE.BufferGeometry();
    bg.setIndex(fg.index);
    bg.setAttribute('position', fg.attributes.position);
    bg.setAttribute('normal', fg.attributes.normal);
    bg.setAttribute('color', fg.attributes.color);
    bg.setAttribute('uv', fg.attributes.uv.clone());
    this.flipGeoF = fg; this.flipGeoB = bg;
    this.flipRest = fg.userData.rest;
    const fm = this._pageMaterial(); fm.side = THREE.FrontSide; fm.shadowSide = THREE.DoubleSide;
    const bm = this._pageMaterial(); bm.side = THREE.BackSide; bm.shadowSide = THREE.DoubleSide;
    this.flipFront = new THREE.Mesh(fg, fm);
    this.flipBack = new THREE.Mesh(bg, bm);
    this.flipFront.castShadow = true;
    this.flipFront.receiveShadow = true;
    this.flipBack.receiveShadow = true;
    this.flipGroup = new THREE.Group();
    this.flipGroup.add(this.flipFront, this.flipBack);
    this.flipGroup.visible = false;
    for (const m of [this.flipFront, this.flipBack]) m.frustumCulled = false;
    this.book.add(this.flipGroup);

    // phones: a catalogue, not a book. Only the page itself, no hard cover and nothing on the left;
    // a turned page goes over the edge and is gone
    const single = this.portrait;
    for (const b of this.boards) b.visible = !single;
    this.stackL.visible = this.staticL.visible = !single;
    this.book.position.z = single ? -BOARD_T : 0;
  }

  _makeStack(mat) {
    const g = new THREE.BufferGeometry();
    const n = SEG_X + 1;
    // two long sides (top/bottom edges of the book) + the fore-edge
    const verts = n * 2 * 2 + 4;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2));
    const idx = [];
    for (let s = 0; s < 2; s++) {
      const o = s * n * 2;
      for (let i = 0; i < SEG_X; i++) {
        const a = o + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (s === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
    const f = n * 4;
    idx.push(f, f + 2, f + 1, f + 1, f + 2, f + 3);
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  _zTop(sheets) { return BOARD_T + GUTTER_A + 0.002 + sheets * SHEET_T; }

  _updateStack(mesh, sheets) {
    const H = this.H;
    const g = mesh.geometry;
    const p = g.attributes.position, uv = g.attributes.uv;
    const zt = this._zTop(sheets) - GUTTER_A - 0.0006;
    const zb = BOARD_T;
    const n = SEG_X + 1;
    for (let s = 0; s < 2; s++) {
      const y = s === 0 ? H / 2 : -H / 2;
      for (let i = 0; i < n; i++) {
        const u = (i / SEG_X) * W;
        const top = zt + bulge(u);
        const k = s * n * 2 + i * 2;
        p.setXYZ(k, u, y, zb); uv.setXY(k, u, 0);
        p.setXYZ(k + 1, u, y, top); uv.setXY(k + 1, u, (top - zb) / 0.0045);
      }
    }
    const f = n * 4, topW = zt + bulge(W);
    p.setXYZ(f, W, -H / 2, zb); uv.setXY(f, 0, 0);
    p.setXYZ(f + 1, W, -H / 2, topW); uv.setXY(f + 1, 0, (topW - zb) / 0.0045);
    p.setXYZ(f + 2, W, H / 2, zb); uv.setXY(f + 2, 1, 0);
    p.setXYZ(f + 3, W, H / 2, topW); uv.setXY(f + 3, 1, (topW - zb) / 0.0045);
    p.needsUpdate = true; uv.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }

  // ---------------------------------------------------------------- textures

  // page texture height = how tall the page really is on screen, in device pixels.
  // A texture much bigger than that gets sampled from a blurred mipmap and small text goes soft.
  _texHeight() {
    const max = Math.min(this.renderer.capabilities.maxTextureSize, 4096);
    const canvasH = this.renderer.domElement.height || 1;
    // at rest the page is snapped to whole screen pixels: render it at exactly that size
    if (this._snap && Math.abs(this.zoomTarget - 1) < 1e-3) return clamp(this._snap.th, 256, max);
    let px = canvasH * 0.9;
    if (this.H && this.baseDist) {
      const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      // the lower edge sits a little closer to the tilted camera, hence the small margin
      px = (this.H / (2 * t * this.baseDist)) * canvasH * 1.04;
    }
    return clamp(Math.ceil((px * this.zoomTarget) / 64) * 64, 512, max);
  }

  _pageTexture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    // nearest mip level instead of blending two: the full size image is used whenever it fits,
    // so text stays crisp at normal zoom, and turning sheets still get a smaller level
    t.minFilter = THREE.LinearMipmapNearestFilter;
    t.anisotropy = this.maxAniso;
    return t;
  }

  _getTex(i) {
    const e = this.list?.[i];
    if (!e) return null;
    const rec = this.tex.get(i);
    if (rec?.tex) return rec.tex;
    if (e.paper) return this.stains.has(i) ? this._paperRec(i).tex : this.paperTex;
    return null;
  }

  _requestTextures() {
    if (!this.pdf) return;
    const s = this.flip?.target ?? this.spread;
    const centre = 2 * s + 0.5;
    const want = this._texHeight();
    const lo = 2 * s - 4, hi = 2 * s + 5;
    // the two spreads of an in-flight jump as well
    const extra = this.flip ? [this.flip.front, this.flip.back, this.flip.sL, this.flip.sR] : [];
    const needed = new Set(extra);
    for (let i = lo; i <= hi; i++) needed.add(i);
    for (const i of needed) {
      const e = this.list[i];
      if (!e || e.paper) continue;
      const near = Math.abs(i - centre) <= 2.5;
      const h = near ? want : Math.min(want, 1536);
      const have = this.tex.get(i);
      // good enough: at least as sharp as the screen, and not so oversized that it blurs (e.g. after zooming out)
      const exact = near && this._snap && Math.abs(this.zoomTarget - 1) < 1e-3;
      if (have && (exact ? have.height === h : have.height >= h && (have.height <= h * 1.6 || !near))) continue;
      if (have?.loading === h) continue;
      const rec = have || {};
      rec.loading = h;
      this.tex.set(i, rec);
      // fast low-res preview first so a page is never blank, then the sharp one
      if (!rec.tex && !rec.preview) {
        rec.preview = true;
        this.pdf.render(e.page, 480, Math.abs(i - centre) - 100).then((canvas) => {
          if (rec.tex) return;
          this._applyStains(i, canvas);
          const t = this._pageTexture(canvas);
          rec.tex = t; rec.height = rec.height || 0;
          this.pdf.forget(e.page, 480);
          this._refreshMaps();
        }).catch(() => { rec.preview = false; });
      }
      const tw = h === this._snap?.th ? this._snap.tw : 0;
      this.pdf.render(e.page, h, Math.abs(i - centre), tw).then((canvas) => {
        if (rec.loading !== h) return;
        this._applyStains(i, canvas);
        const t = this._pageTexture(canvas);
        rec.tex?.dispose();
        rec.tex = t; rec.height = h; rec.loading = 0;
        this.pdf.forget(e.page, h, tw);
        this._refreshMaps();
      }).catch(() => { if (rec.loading === h) rec.loading = 0; });
    }
    // the reader moved: serve the pages around them first, forget stale requests
    const pageIdx = new Map();
    this.list.forEach((e, i) => e.page && pageIdx.set(e.page, i));
    this.pdf.reprioritize((pageNo, height) => {
      const i = pageIdx.get(pageNo);
      if (!needed.has(i)) return null;
      const d = Math.abs(i - centre);
      return height <= 480 ? d - 100 : d;
    });
    // drop far textures
    for (const [i, rec] of this.tex) {
      if (i < lo - 8 || i > hi + 8) { if (!needed.has(i)) { rec.tex?.dispose(); this.tex.delete(i); } }
    }
  }

  // ---------------------------------------------------------------- coffee stains

  /** height of whatever is under (x, y): page, cover board or table */
  surfaceZ(x, y) {
    if (!this.list) return 0;
    const H = this.H, ax = Math.abs(x), ay = Math.abs(y);
    if (ax <= W && ay <= H / 2) {
      const sheets = x < 0 ? this.spread : this.numSpreads - this.spread;
      return this._zTop(sheets) - GUTTER_A + bulge(ax) + 0.0015;
    }
    if (ax <= W + BOARD_M && ay <= H / 2 + BOARD_M) return BOARD_T;
    return 0;
  }

  /** stain the visible page at world (x, y); returns false if it missed the pages */
  stainAt(x, y, op) {
    if (!this.list || Math.abs(x) > W || Math.abs(y) > this.H / 2) return false;
    const i = x >= 0 ? 2 * this.spread + 1 : 2 * this.spread;
    if (!this.list[i]) return false;
    const o = { ...op, u: x >= 0 ? x / W : 1 + x / W, v: (y + this.H / 2) / this.H };
    if (this.list[i].paper && !this.tex.get(i)?.tex) this._paperRec(i); // own canvas before the first stain
    if (!this.stains.has(i)) this.stains.set(i, []);
    this.stains.get(i).push(o);
    const rec = this.tex.get(i);
    if (rec?.tex?.image?.getContext) {
      drawStain(rec.tex.image.getContext('2d'), rec.tex.image.width, rec.tex.image.height, o);
      this._stainDirty.add(rec.tex);
    }
    if (!this.hasStains) { this.hasStains = true; this._emit('stain', { first: true }); }
    return true;
  }

  // ---- pen ink: strokes are stored like stains (page uv), drawn live
  _pageAt(x, y) {
    if (!this.list || Math.abs(x) > W || Math.abs(y) > this.H / 2) return null;
    const i = x >= 0 ? 2 * this.spread + 1 : 2 * this.spread;
    if (!this.list[i]) return null;
    return { i, u: x >= 0 ? x / W : 1 + x / W, v: (y + this.H / 2) / this.H };
  }

  inkStart(x, y, style) {
    const p = this._pageAt(x, y);
    if (!p) return null;
    if (this.list[p.i].paper && !this.tex.get(p.i)?.tex) this._paperRec(p.i);
    const op = { kind: 'ink', color: style.color, width: style.width, mode: style.mode, stroke: style.stroke, pts: [[p.u, p.v]] };
    if (!this.stains.has(p.i)) this.stains.set(p.i, []);
    this.stains.get(p.i).push(op);
    this._inkPaint(p.i, op, 0);
    if (!this.hasStains) { this.hasStains = true; this._emit('stain', { first: true }); }
    return { i: p.i, op };
  }

  inkMove(h, x, y, style) {
    const p = this._pageAt(x, y);
    if (!p) return null;                                    // left the page: lift the pen
    if (!h || p.i !== h.i) return this.inkStart(x, y, style); // crossed the spine
    const pts = h.op.pts, last = pts[pts.length - 1];
    if (Math.hypot((p.u - last[0]) * W, (p.v - last[1]) * this.H) < 0.0025) return h;
    pts.push([p.u, p.v]);
    this._inkPaint(h.i, h.op, pts.length - 2);
    return h;
  }

  _inkPaint(i, op, from) {
    const rec = this.tex.get(i);
    if (!rec?.tex?.image?.getContext) return;
    const c = rec.tex.image;
    drawStain(c.getContext('2d'), c.width, c.height, op, from);
    this._stainDirty.add(rec.tex);
    this._inkLive = true;
  }

  /** remove stains/strokes matching fn and repaint the pages they were on */
  removeStains(fn) {
    for (const [i, list] of this.stains) {
      const keep = list.filter((o) => !fn(o));
      if (keep.length === list.length) continue;
      if (keep.length) this.stains.set(i, keep); else this.stains.delete(i);
      const rec = this.tex.get(i);
      if (rec) { rec.tex?.dispose(); this.tex.delete(i); }
    }
    if (!this.stains.size && this.hasStains) { this.hasStains = false; this._emit('stain', { cleared: true }); }
    this._requestTextures();
    this._refreshMaps();
  }

  clearStains() {
    const stained = [...this.stains.keys()];
    this.stains.clear();
    this.hasStains = false;
    for (const i of stained) {
      const rec = this.tex.get(i);
      if (rec) { rec.tex?.dispose(); this.tex.delete(i); }
    }
    this._requestTextures();
    this._refreshMaps();
    this._emit('stain', { cleared: true });
  }

  _applyStains(i, canvas) {
    const list = this.stains.get(i);
    if (!list) return;
    const ctx = canvas.getContext('2d');
    for (const o of list) drawStain(ctx, canvas.width, canvas.height, o);
  }

  _paperRec(i) {
    let rec = this.tex.get(i);
    if (rec?.tex) return rec;
    const src = this.paperTex.image;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    this._applyStains(i, c);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    rec = { tex: t, height: 1e9, paper: true };
    this.tex.set(i, rec);
    return rec;
  }

  _setMap(mesh, i) {
    const t = this._getTex(i) ?? this.paperTex;
    if (mesh.material.map !== t) { mesh.material.map = t; mesh.material.needsUpdate = true; }
  }

  _refreshMaps() {
    if (this.flip) {
      this._setMap(this.staticL, this.flip.sL);
      this._setMap(this.staticR, this.flip.sR);
      this._setMap(this.flipFront, this.flip.front);
      this._setMap(this.flipBack, this.flip.back);
    } else {
      this._setMap(this.staticL, 2 * this.spread);
      this._setMap(this.staticR, 2 * this.spread + 1);
    }
    this.dirty = true;
  }

  _updateStatic() {
    const s = this.spread;
    const left = s, right = this.numSpreads - s;
    this._placeStatic(left, right);
    this._refreshMaps();
  }

  _placeStatic(leftSheets, rightSheets) {
    // geometry already carries bulge(u); the outer edge of the page sits at _zTop
    this.staticL.position.z = this._zTop(leftSheets) - GUTTER_A;
    this.staticR.position.z = this._zTop(rightSheets) - GUTTER_A;
    this._updateStack(this.stackL, leftSheets);
    this._updateStack(this.stackR, rightSheets);
    this._scaleStatic();
  }

  // ---------------------------------------------------------------- flipping

  _startFlip(dir, G, target) {
    const s = this.spread;
    const t = target ?? s + dir;
    if (t < 0 || t >= this.numSpreads || t === s) return null;
    const f = { dir, target: t, G: [...G], M: [...G], Mt: [...G], mode: 'drag', lift: LIFT_DRAG };
    if (dir > 0) { f.front = 2 * s + 1; f.back = 2 * t; f.sL = 2 * s; f.sR = 2 * t + 1; }
    else { f.front = 2 * s; f.back = 2 * t + 1; f.sL = 2 * t; f.sR = 2 * s + 1; }
    const leftNow = s, rightNow = this.numSpreads - s;
    const leftAfter = t, rightAfter = this.numSpreads - t;
    // the flipping sheet starts on its stack and lands on the other one
    if (dir > 0) {
      f.zFlat = this._zTop(rightNow) - GUTTER_A + 0.0012;
      f.zFold = this._zTop(leftAfter) - GUTTER_A + 0.0012;
      this._placeStatic(leftNow, rightAfter);
    } else {
      f.zFlat = this._zTop(leftNow) - GUTTER_A + 0.0012;
      f.zFold = this._zTop(rightAfter) - GUTTER_A + 0.0012;
      this._placeStatic(leftAfter, rightNow);
    }
    // uv layout depends on direction (the backward sheet is a mirrored mesh)
    const ufront = this.flipGeoF.attributes.uv, uback = this.flipGeoB.attributes.uv;
    const rest = this.flipRest;
    for (let i = 0; i < ufront.count; i++) {
      const u = rest[i * 3] / W;
      ufront.setX(i, dir > 0 ? u : 1 - u);
      uback.setX(i, dir > 0 ? 1 - u : u);
    }
    ufront.needsUpdate = true; uback.needsUpdate = true;
    this.flipGroup.scale.x = dir;
    this.flipGroup.visible = true;
    this.flip = f;
    this._refreshMaps();
    this._requestTextures();
    this._deform();
    return f;
  }

  _animateTo(f, complete, { auto = false, from } = {}) {
    const to = complete ? [-W, f.G[1]] : [...f.G];
    const start = from ?? [...f.M];
    const dist = Math.hypot(to[0] - start[0], to[1] - start[1]);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let dur = auto ? 980 : clamp((dist / (2 * W)) * 900, 260, 720);
    if (this.pending.length) dur *= 0.6;
    if (reduce) dur *= 0.4;
    f.mode = 'anim';
    f.anim = {
      from: start, to, t: 0, dur, complete,
      ease: auto ? easeInOut : easeOutCubic,
      bump: auto ? this.H * 0.16 * (f.G[1] < 0 ? 1 : -1) : 0,
    };
    f.lift = auto ? LIFT_AUTO : LIFT_DRAG * 1.4;
    if (complete) this.sound.flip({ quick: this.pending.length > 0 });
  }

  _auto(dir, target) {
    if (!this.list) return;
    if (this.flip && this.flip.mode === 'anim') { this.pending.push([dir, target]); return; }
    if (this.flip && this.flip.mode === 'peek' && this.flip.dir === dir && target == null) {
      const f = this.flip; this._animateTo(f, true, { auto: true }); return;
    }
    if (this.flip) this._cancelFlip();
    const gy = -this.H * (0.28 + Math.random() * 0.08);
    const f = this._startFlip(dir, [W, gy], target);
    if (f) this._animateTo(f, true, { auto: true });
  }

  _cancelFlip() {
    this._landFocus = null;
    this.flip = null;
    this.flipGroup.visible = false;
    this._updateStatic();
  }

  _endFlip(f) {
    if (f.anim.complete) {
      this.spread = f.target;
      this.focus = this._landFocus || (f.dir > 0 ? 'L' : 'R');
    }
    this._landFocus = null;
    this.flip = null;
    this._normalizeFocus();
    if (this.portrait && this.zoomTarget <= 1.02) this.panTarget.set(this._baseX(), 0);
    this.flipGroup.visible = false;
    this._updateStatic();
    this._requestTextures();
    if (f.anim.complete) this._emitFlip();
    const after = this._afterFlip; this._afterFlip = null;
    if (after) after();
    const next = this.pending.shift();
    if (next) (next[0] > 0 && next[1] == null ? this.next() : next[0] < 0 && next[1] == null ? this.prev() : this._auto(next[0], next[1]));
  }

  _deform() {
    const f = this.flip;
    const M = constrainPointer(f.G, f.M, W, this.H);
    f.Mc = M;
    const pos = this.flipGeoF.attributes.position;
    const r = deformPage({
      rest: this.flipRest, pos: pos.array, W, H: this.H, G: f.G, M,
      Rbase: R_BASE, lift: f.lift, zFlat: f.zFlat, zFold: f.zFold, bulge,
    });
    f.progress = r.progress;
    this._scaleFlip(f);
    pos.needsUpdate = true;
    this.flipGeoF.computeVertexNormals();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- loop

  _loop = () => {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const f = this.flip;
    if (f) {
      if (f.mode === 'anim') {
        const a = f.anim;
        a.t = Math.min(1, a.t + (dt * 1000) / a.dur);
        const e = a.ease(a.t);
        f.M[0] = a.from[0] + (a.to[0] - a.from[0]) * e;
        f.M[1] = a.from[1] + (a.to[1] - a.from[1]) * e + a.bump * Math.sin(Math.PI * e);
        this._deform();
        if (a.t >= 1) this._endFlip(f);
      } else {
        // drag and peek: the sheet follows the pointer with a little inertia
        const k = 1 - Math.exp(-dt * (f.mode === 'drag' ? 22 : 12));
        const dx = f.Mt[0] - f.M[0], dy = f.Mt[1] - f.M[1];
        if (Math.abs(dx) + Math.abs(dy) > 1e-5) {
          f.M[0] += dx * k; f.M[1] += dy * k;
          this._deform();
        } else if (f.mode === 'peek' && f.releasing) {
          this._cancelFlip();
        }
      }
    }
    if (this._panVel && !this._drag && !this._pinch) {
      this.panTarget.x += this._panVel.x * dt; this.panTarget.y += this._panVel.y * dt;
      this._clampPan();
      const decay = Math.exp(-dt * 4.5);
      this._panVel.x *= decay; this._panVel.y *= decay;
      if (Math.hypot(this._panVel.x, this._panVel.y) < 0.01 || this.zoomTarget <= 1.02) this._panVel = null;
    }
    for (const x of this.extras) if (x.update?.(dt)) this.dirty = true;
    if (this._stainDirty.size) {
      this._stainT = (this._stainT || 0) + dt;
      if (this._stainT > (this._inkLive ? 0 : 0.06)) {
        this._inkLive = false;
        this._stainT = 0;
        for (const t of this._stainDirty) t.needsUpdate = true;
        this._stainDirty.clear();
        this._refreshMaps();
        this.dirty = true;
      }
    }
    // zoom / pan easing
    const kz = 1 - Math.exp(-dt * 12);
    if (Math.abs(this.zoom - this.zoomTarget) > 1e-4 || this.pan.distanceTo(this.panTarget) > 1e-5) {
      this.zoom += (this.zoomTarget - this.zoom) * kz;
      this.pan.lerp(this.panTarget, kz);
      this._placeCamera();
      this.dirty = true;
    }
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  };

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // single page catalogue on tall screens, and always on phones (also held sideways)
    const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
    const portrait = this.opts.singlePage !== false && (w / h < 0.78 || phone);
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this._relayout();
      this._normalizeFocus();
      this.panTarget.set(this._baseX(), 0); this.pan.copy(this.panTarget);
      if (this.list) this._emitFlip();
    }
    this._fitCamera();
    if (this.list) this._requestTextures(); // the page size on screen changed: keep textures sharp
    for (const x of this.extras) x.onResize?.();
    this.dirty = true;
  }

  _fitCamera() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const p0 = this.opts.padding;
    const pad = { top: 0, bottom: 0, side: 0, ...(typeof p0 === 'function' ? p0() : p0) };
    // keep the book clear of overlaid UI (toolbars), centred in the free area
    const ah = Math.max(h - pad.top - pad.bottom, h * 0.4), aw = Math.max(w - 2 * pad.side, w * 0.5);
    this.camera.clearViewOffset();
    this.camera.setViewOffset(w, h, 0, -(pad.top - pad.bottom) / 2, w, h);
    if (!this.H) { this.camera.updateProjectionMatrix(); return; }
    const bw = this.portrait ? W + 0.05 : 2 * (W + BOARD_M) + 0.03;
    const bh = this.portrait ? this.H + 0.05 : this.H + 2 * BOARD_M + 0.03;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dH = (bh / 2 / t) * (h / ah), dW = (bw / 2 / (t * this.camera.aspect)) * (w / aw);
    this.baseDist = Math.max(dH, dW) * (this.opts.fitScale ?? 1);
    this.camera.near = 0.05; this.camera.far = this.baseDist * 4;
    this.camera.updateProjectionMatrix();
    this.key.shadow.camera.top = this.key.shadow.camera.right = W + 0.6;
    this.key.shadow.camera.bottom = this.key.shadow.camera.left = -(W + 0.6);
    this.key.shadow.camera.updateProjectionMatrix();
    this._snapCamera();
    this._placeCamera();
  }

  // Pixel perfect page at rest: the camera looks straight down, the right page is a whole number of
  // screen pixels wide and its corner sits on a pixel, and the page texture is rendered at exactly
  // that size, so every PDF pixel lands on one screen pixel (no resampling blur on small text).
  _snapCamera() {
    this._snap = null;
    if (!this.H || !this.staticR || !this.baseDist) return;
    const canvas = this.renderer.domElement;
    const cw = canvas.width, ch = canvas.height;
    if (!cw || !ch) return;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const lift = this.book.position.z;
    // reference level: the right page as it lies now; pages on other levels get scaled to match it
    const zR = lift + this._zTop(this.numSpreads - this.spread);
    const P = Math.max(64, Math.floor(ch / (2 * t * (this.baseDist + 0.03 - zR))));
    const camZ = zR + ch / (2 * t * P);
    const bx = this._baseX();
    // where the right page's top spine corner lands with no offset
    this.camera.position.set(bx, 0, camZ);
    this.camera.lookAt(bx, 0, camZ - 1);
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(0, this.H / 2, zR).project(this.camera);
    const sx = (v.x + 1) / 2 * cw, sy = (1 - v.y) / 2 * ch;
    const dx = sx - Math.round(sx), dy = sy - Math.round(sy);
    this._snap = { camZ, dx: dx / P, dy: -dy / P, P, tw: P, th: Math.round(P * this.H), zRef: zR, cx: bx + dx / P, cy: -dy / P };
    this._scaleStatic();
  }

  // pages lie on stacks of different height, and the stacks change as you turn. Instead of moving the
  // camera (a visible jump), each page is scaled about the camera axis so it shows at exactly the
  // reference pixel size wherever it lies
  _scaleStatic() {
    const s = this._snap;
    for (const [m, sign] of [[this.staticR, 1], [this.staticL, -1]]) {
      if (!m) continue;
      let k = 1, ox = 0, oy = 0;
      if (s) {
        const z = this.book.position.z + m.position.z + GUTTER_A;
        k = (s.camZ - z) / (s.camZ - s.zRef);
        ox = s.cx * (1 - k); oy = s.cy * (1 - k);
      }
      m.scale.set(sign * k, k, 1);
      m.position.x = ox; m.position.y = oy;
    }
  }

  // the turning sheet gets the same correction, following its height from one stack to the other
  _scaleFlip(f) {
    const s = this._snap;
    let k = 1;
    if (s) {
      const zb = (f.zFlat + (f.zFold - f.zFlat) * (f.progress || 0)) + GUTTER_A + this.book.position.z;
      k = (s.camZ - zb) / (s.camZ - s.zRef);
    }
    this.flipGroup.scale.set(f.dir * k, k, 1);
    this.flipGroup.position.x = s ? s.cx * (1 - k) : 0;
    this.flipGroup.position.y = s ? s.cy * (1 - k) : 0;
  }

  // where the closed or open book sits on screen at normal zoom, in CSS pixels
  bookScreenRect() {
    if (!this.H) return null;
    const half = this.portrait ? W / 2 : W + BOARD_M;
    const bx = this._baseX(), hy = this.H / 2 + (this.portrait ? 0 : BOARD_M);
    const saved = { z: this.zoom, x: this.pan.x, y: this.pan.y };
    this.zoom = 1; this.pan.set(bx, 0); this._placeCamera(); this.camera.updateMatrixWorld();
    const r = this.renderer.domElement.getBoundingClientRect();
    let l = Infinity, rt = -Infinity, t = Infinity, b = -Infinity;
    for (const [x, y] of [[bx - half, -hy], [bx + half, -hy], [bx - half, hy], [bx + half, hy]]) {
      const v = new THREE.Vector3(x, y, 0.03).project(this.camera);
      const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
      l = Math.min(l, sx); rt = Math.max(rt, sx); t = Math.min(t, sy); b = Math.max(b, sy);
    }
    this.zoom = saved.z; this.pan.set(saved.x, saved.y); this._placeCamera();
    return { left: l, right: rt, top: t, bottom: b };
  }

  _placeCamera() {
    const s = this._snap;
    const tx = this.pan.x + (s?.dx || 0), ty = this.pan.y + (s?.dy || 0);
    // straight down: a flat page stays a clean rectangle on screen
    const z = s && Math.abs(this.zoom - 1) < 1e-3 ? s.camZ : (s ? s.camZ - 0.03 : this.baseDist) / this.zoom + 0.03;
    this.camera.position.set(tx, ty, z);
    this.camera.lookAt(tx, ty, z - 1);
  }

  _clampPan() {
    const z = this.zoomTarget, bx = this._baseX();
    const half = this.portrait ? W / 2 + BOARD_M : W + BOARD_M;
    const mx = half * (1 - 1 / z) * 1.05, my = (this.H / 2) * (1 - 1 / z) * 1.1;
    this.panTarget.x = clamp(this.panTarget.x, bx - mx, bx + mx);
    this.panTarget.y = clamp(this.panTarget.y, -my, my);
  }

  // ---------------------------------------------------------------- input

  _world(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(BOARD_T + 0.03 + this.book.position.z));
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }

  _local(p, dir) { return [dir > 0 ? p.x : -p.x, p.y]; }

  _cornerZone(p) {
    // returns dir (+1 right page corner, -1 left) when hovering a corner
    const H = this.H;
    const ax = Math.abs(p.x), ay = Math.abs(p.y);
    if (ax > W - 0.16 && ax < W + 0.04 && ay > H / 2 - 0.17 && ay < H / 2 + 0.04) {
      const dir = p.x > 0 ? 1 : -1;
      if (this.portrait && dir !== (this.focus === 'L' ? -1 : 1)) return 0;
      if ((dir > 0 && this.spread < this.numSpreads - 1) || (dir < 0 && this.spread > 0)) return dir;
    }
    return 0;
  }

  _bind() {
    const el = this.renderer.domElement;
    this._h = {
      down: (e) => this._onDown(e),
      move: (e) => this._onMove(e),
      up: (e) => this._onUp(e),
      leave: () => this._onLeave(),
      wheel: (e) => this._onWheel(e),
      dbl: (e) => this._onDbl(e),
      key: (e) => this._onKey(e),
    };
    el.addEventListener('pointerdown', this._h.down);
    window.addEventListener('pointermove', this._h.move);
    window.addEventListener('pointerup', this._h.up);
    window.addEventListener('pointercancel', this._h.up);
    el.addEventListener('pointerleave', this._h.leave);
    el.addEventListener('wheel', this._h.wheel, { passive: false });
    el.addEventListener('dblclick', this._h.dbl);
    window.addEventListener('keydown', this._h.key);
  }

  _unbind() {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this._h.down);
    window.removeEventListener('pointermove', this._h.move);
    window.removeEventListener('pointerup', this._h.up);
    window.removeEventListener('pointercancel', this._h.up);
    el.removeEventListener('pointerleave', this._h.leave);
    el.removeEventListener('wheel', this._h.wheel);
    el.removeEventListener('dblclick', this._h.dbl);
    window.removeEventListener('keydown', this._h.key);
  }

  // ---- gestures
  // Mouse: a press on a page grabs it at once (and hovering peels the corner).
  // Touch: nothing turns until one finger has clearly swiped, so a pinch never
  // curls a page; a tap turns the page, a double tap zooms; when zoomed one
  // finger pans with momentum and two fingers pinch and pan together.

  _pxToWorld(z = this.zoom) {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return (2 * t * (this.baseDist / z)) / (this.renderer.domElement.clientHeight || 1);
  }

  _startPinch() {
    if (this.flip && this.flip.mode === 'drag') this._animateTo(this.flip, false);
    clearTimeout(this._tapTimer);
    this._drag = null;
    this._panVel = null;
    const [a, b] = [...this.pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this._pinch = {
      d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), z: this.zoom, mid,
      pan: this.pan.clone(), w: this._world({ clientX: mid.x, clientY: mid.y }) || this.pan.clone(),
    };
  }

  _startPan(e) {
    this._drag = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY, t: performance.now(), hist: [], moved: false,
      pan: { x: this.panTarget.x, y: this.panTarget.y, cx: e.clientX, cy: e.clientY }, touch: e.pointerType !== 'mouse',
    };
    this._panVel = null;
  }

  _onDown(e) {
    if (!this.list) return;
    if (!this.pointers.size && this.extras.some((x) => x.onDown?.(e))) { this.sound.ensure(); return; }
    this.sound.ensure();
    if (e.pointerType !== 'mouse') this._lastTouch = performance.now();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this._startPinch(); return; }
    if (this.pointers.size > 2) return;
    const p = this._world(e);
    if (!p) return;
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    const touch = e.pointerType !== 'mouse';
    if (this.zoom > 1.03) { this._startPan(e); return; }
    this._drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, t: performance.now(), hist: [], moved: false, touch, p0: p };
    if (this.flip && this.flip.mode === 'anim') { this._drag.ignore = true; return; }

    const dir = this.portrait ? (this.focus === 'L' ? -1 : 1) : p.x >= 0 ? 1 : -1;
    this._drag.dir = dir;
    if (this.portrait && ((dir > 0 && p.x < -0.02) || (dir < 0 && p.x > 0.02))) { this._drag.ignore = true; return; }
    if ((dir > 0 && this.spread >= this.numSpreads - 1) || (dir < 0 && this.spread <= 0)) {
      // nothing to turn: in single page view still allow sliding to the facing page
      if (this.portrait) this._drag.slide = true; else this._drag.ignore = true;
      return;
    }
    if (Math.abs(p.x) > W + 0.06 || Math.abs(p.y) > this.H / 2 + 0.06) { this._drag.ignore = true; return; }
    if (touch) { this._drag.pending = true; return; } // wait: is it a swipe, a tap or a pinch?
    this._beginDrag(dir, p, p);
  }

  _beginDrag(dir, p0, pNow) {
    let f = this.flip;
    if (f && f.mode === 'peek' && f.dir === dir) { f.mode = 'drag'; f.releasing = false; }
    else {
      if (f) this._cancelFlip();
      const lp = this._local(p0, dir);
      // grab on the outer edge at the pointer's height; snap to the corner near it
      let gy = clamp(lp[1], -this.H / 2, this.H / 2);
      if (Math.abs(gy) > this.H / 2 - 0.12) gy = Math.sign(gy) * this.H / 2;
      f = this._startFlip(dir, [W, gy]);
      if (!f) return null;
    }
    const ln = this._local(pNow, dir);
    f.Mt = [Math.min(ln[0], W), ln[1]];
    f.mode = 'drag';
    f.lift = LIFT_DRAG;
    this.sound.grab();
    return f;
  }

  _onMove(e) {
    if (!this.list) return;
    if (this.extras.some((x) => x.onMove?.(e))) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const P = this._pinch;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z1 = clamp(P.z * (dist / P.d), 1, 4);
      // keep the spot between the fingers under the fingers, and pan with them
      const k = P.z / z1;
      let px = P.w.x - (P.w.x - P.pan.x) * k;
      let py = P.w.y - (P.w.y - P.pan.y) * k;
      const s = this._pxToWorld(z1);
      px -= (mid.x - P.mid.x) * s;
      py += (mid.y - P.mid.y) * s;
      this.zoom = this.zoomTarget = z1;
      this.panTarget.set(px, py);
      this._clampPan();
      this.pan.copy(this.panTarget);
      this._placeCamera();
      this.dirty = true;
      return;
    }
    const d = this._drag;
    if (d && e.pointerType === 'mouse' && e.buttons === 0) { this._onUp(e); return; }
    if (d && d.id === e.pointerId) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > (d.touch ? 10 : 6)) d.moved = true;
      if (d.pan) {
        const s = this._pxToWorld();
        this.panTarget.x = d.pan.x - (e.clientX - d.pan.cx) * s;
        this.panTarget.y = d.pan.y + (e.clientY - d.pan.cy) * s;
        this._clampPan();
        this.pan.copy(this.panTarget); this._placeCamera(); this.dirty = true;
        d.hist.push({ t: performance.now(), x: this.panTarget.x, y: this.panTarget.y });
        if (d.hist.length > 5) d.hist.shift();
        return;
      }
      const p = this._world(e);
      if (!p) return;
      if (d.pending) {
        if (!d.moved || this.pointers.size !== 1) return;
        // a clear horizontal swipe turns the page; a mostly vertical one does nothing
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        d.pending = false;
        if (Math.abs(dy) > Math.abs(dx) * 1.4) { d.ignore = true; return; }
        // single view: a swipe to the right brings the previous sheet back over
        if (this.portrait && dx > 0) { d.ignore = true; if (this.canPrev) this.prev(); return; }
        if (!this._beginDrag(d.dir, d.p0, p)) { d.ignore = true; return; }
      }
      const f = this.flip;
      if (!f || f.mode !== 'drag' || d.ignore) return;
      const lp = this._local(p, f.dir);
      f.Mt = [lp[0], lp[1]];
      d.hist.push({ t: performance.now(), x: lp[0] });
      if (d.hist.length > 6) d.hist.shift();
      return;
    }
    // hover: peel the corner a little when the pointer is near it
    if (e.pointerType !== 'mouse' || this.zoom > 1.03) return;
    const p = this._world(e);
    if (!p) return;
    if (this.flip && this.flip.mode !== 'peek') return;
    const zone = this._cornerZone(p);
    if (zone) {
      let f = this.flip;
      if (f && f.dir !== zone) { this._cancelFlip(); f = null; }
      if (!f) {
        f = this._startFlip(zone, [W, Math.sign(p.y) * this.H / 2]);
        if (!f) return;
        f.mode = 'peek'; f.lift = 0;
      }
      f.releasing = false;
      const lp = this._local(p, zone);
      const cx = W, cy = f.G[1];
      let vx = lp[0] - cx, vy = lp[1] - cy;
      const len = Math.hypot(vx, vy), maxL = 0.17;
      const want = Math.max(len, 0.07);
      if (len < 1e-4) { vx = -0.7; vy = -Math.sign(cy) * 0.7; } else { vx /= len; vy /= len; }
      // always peel inward a bit, even right at the corner
      vx = Math.min(vx, -0.3);
      const L = Math.min(want, maxL);
      f.Mt = [cx + vx * L, cy + vy * L];
    } else if (this.flip && this.flip.mode === 'peek') {
      this.flip.Mt = [...this.flip.G];
      this.flip.releasing = true;
    }
  }

  _tap(e, dir) {
    const now = performance.now();
    const lt = this._lastTap;
    if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 40) {
      // double tap: zoom in where tapped, or back out
      clearTimeout(this._tapTimer);
      this._lastTap = null;
      if (this.zoomTarget > 1.05) this.setZoom(1);
      else this.setZoom(2.4, this._world(e));
      this._zoomedTex();
      return;
    }
    this._lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (this.zoom > 1.03 || !dir) return;
    clearTimeout(this._tapTimer);
    this._tapTimer = setTimeout(() => {
      if (this.zoomTarget > 1.03) return;
      this._auto(dir);
    }, 300);
  }

  _onUp(e) {
    if (this.extras.some((x) => x.onUp?.(e))) return;
    this.pointers.delete(e.pointerId);
    if (this._pinch) {
      if (this.pointers.size < 2) {
        this._pinch = null;
        if (this.zoomTarget < 1.08) this.setZoom(1);
        this._zoomedTex();
        // the finger still down keeps panning instead of doing nothing
        const rest = [...this.pointers.entries()][0];
        if (rest && this.zoomTarget > 1.03) this._startPan({ pointerId: rest[0], clientX: rest[1].x, clientY: rest[1].y, pointerType: 'touch' });
      }
      return;
    }
    const d = this._drag;
    if (!d || d.id !== e.pointerId) return;
    this._drag = null;
    if (d.pan) {
      if (!d.moved && d.touch) { this._tap(e, 0); return; }
      // a flick keeps the zoomed page gliding for a moment
      if (d.hist.length >= 2) {
        const a = d.hist[0], b = d.hist[d.hist.length - 1];
        const dt = (b.t - a.t) / 1000;
        if (dt > 0 && performance.now() - b.t < 80) this._panVel = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      }
      return;
    }
    if (d.ignore) return;
    if (d.slide) {
      const dx = e.clientX - d.sx;
      if (!d.moved) { if (d.touch) this._tap(e, this.focus === 'L' ? -1 : 0); else if (this.focus === 'L') this.next(); }
      else if (dx < -50) this.next();
      else if (dx > 50) this.prev();
      return;
    }
    if (d.pending) {
      if (!d.moved) this._tap(e, this.portrait && d.p0.x < W * 0.3 && this.canPrev ? -1 : d.dir);
      return;
    }
    const f = this.flip;
    if (!f || f.mode !== 'drag') return;
    const quick = !d.moved && performance.now() - d.t < 400;
    const dxScreen = e.clientX - d.sx;
    if (quick && this.portrait && f.dir < 0) {
      // in single page view a tap on the left page moves on to the right page
      this._cancelFlip();
      clearTimeout(this._tapTimer);
      this._tapTimer = setTimeout(() => this.next(), 240);
      return;
    }
    if (quick) {
      // wait a moment: a second click means double-click zoom, not a page turn
      clearTimeout(this._tapTimer);
      this._tapTimer = setTimeout(() => {
        if (this.flip === f && f.mode === 'drag') this._animateTo(f, true, { auto: true });
      }, 240);
      return;
    }
    // flick velocity in local x (towards the spine is negative)
    let vx = 0;
    if (d.hist.length >= 2) {
      const a = d.hist[0], b = d.hist[d.hist.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0) vx = (b.x - a.x) / dt;
    }
    const pastSpine = (f.Mc?.[0] ?? f.M[0]) < W * 0.2;
    const complete = vx < -1.1 || (pastSpine && vx < 1.1);
    f.M = [...(f.Mc ?? f.M)];
    // single page view: swiping the "wrong" way slides to the facing page
    if (this.portrait && !complete) {
      if (f.dir > 0 && dxScreen > 50 && this._isPage(2 * this.spread)) this._afterFlip = () => this._setFocus('L');
      if (f.dir < 0 && dxScreen < -50 && this._isPage(2 * this.spread + 1)) this._afterFlip = () => this._setFocus('R');
    }
    this._animateTo(f, complete);
  }

  _onLeave() {
    if (this.flip && this.flip.mode === 'peek') { this.flip.Mt = [...this.flip.G]; this.flip.releasing = true; }
  }

  _onWheel(e) {
    if (!this.opts.wheelZoom || !this.list) return;
    e.preventDefault();
    const p = this._world(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025));
    const z0 = this.zoomTarget;
    const z1 = clamp(z0 * factor, 1, 3.5);
    if (p && z1 > 1) {
      // keep the point under the cursor fixed while zooming
      this.panTarget.x = p.x - (p.x - this.panTarget.x) * (z0 / z1);
      this.panTarget.y = p.y - (p.y - this.panTarget.y) * (z0 / z1);
    }
    this.setZoom(z1);
    this._zoomedTex();
  }

  _onDbl(e) {
    if (this.extras.some((x) => x.onDbl?.(e))) return;
    if (performance.now() - (this._lastTouch || -1e9) < 800) return;
    clearTimeout(this._tapTimer);
    if (this.flip && this.flip.mode === 'drag') this._cancelFlip();
    const p = this._world(e);
    if (this.zoomTarget > 1.05) this.setZoom(1);
    else this.setZoom(2.2, p);
    this._zoomedTex();
  }

  _zoomedTex() {
    clearTimeout(this._zt);
    this._zt = setTimeout(() => this._requestTextures(), 250);
  }

  _onKey(e) {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); this.next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.prev(); }
    else if (e.key === 'Home') this.goToPage(0);
    else if (e.key === 'End') this.goToPage(this.list.length);
    else if (e.key === 'Escape') this.setZoom(1);
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _emitFlip() { this._emit('flip', { spread: this.spread, pages: this.visiblePages() }); }
}
