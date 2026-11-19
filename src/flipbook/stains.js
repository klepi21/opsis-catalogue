// Coffee stains painted onto page canvases.
// Real coffee stains are pale in the middle with a darker rim, because as a
// drop dries the coffee particles flow to its edge ("coffee ring effect").
// Every stain is stored in page UV space with a seed, so it can be repainted
// identically whenever a page is re-rendered at another resolution.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blobPath(ctx, x, y, r, rand, wobble = 0.16, n = 28) {
  const phase = rand() * 10, k1 = 2 + Math.floor(rand() * 3), k2 = 5 + Math.floor(rand() * 4);
  const a1 = wobble * (0.5 + rand()), a2 = wobble * 0.5 * rand();
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rr = r * (1 + a1 * Math.sin(k1 * t + phase) + a2 * Math.sin(k2 * t + phase * 1.7) + (rand() - 0.5) * wobble * 0.35);
    const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drop(ctx, x, y, r, rand, strength = 1) {
  // body: pale tea-brown wash, a little darker toward the edge
  const g = ctx.createRadialGradient(x, y, r * 0.05, x, y, r * 1.05);
  g.addColorStop(0, `rgba(205,165,118,${0.22 * strength})`);
  g.addColorStop(0.7, `rgba(182,130,78,${0.3 * strength})`);
  g.addColorStop(1, `rgba(140,88,42,${0.5 * strength})`);
  ctx.fillStyle = g;
  blobPath(ctx, x, y, r, rand, 0.12);
  ctx.fill();
  // the fine dark rim where the coffee dried
  ctx.strokeStyle = `rgba(112,64,28,${0.38 * strength})`;
  ctx.lineWidth = Math.max(0.8, r * 0.05);
  ctx.stroke();
}

// pen strokes: a thick felt marker (or a see-through highlighter)
function ink(ctx, cw, ch, op, from = 0) {
  const pts = op.pts;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, op.width * cw);
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.globalCompositeOperation = op.mode === 'highlighter' ? 'multiply' : 'source-over';
  ctx.globalAlpha = op.mode === 'highlighter' ? 0.55 : 1;
  const P = (k) => [pts[k][0] * cw, (1 - pts[k][1]) * ch];
  if (pts.length === 1) {
    const [x, y] = P(0);
    ctx.beginPath(); ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  } else if (from > 0) {
    // live drawing: just the newest segment
    const [x0, y0] = P(from), [x1, y1] = P(from + 1);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  } else {
    ctx.beginPath();
    let [x, y] = P(0);
    ctx.moveTo(x, y);
    for (let k = 1; k < pts.length - 1; k++) {
      const [ax, ay] = P(k), [bx, by] = P(k + 1);
      ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    [x, y] = P(pts.length - 1);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStain(ctx, cw, ch, op, from) {
  if (op.kind === 'ink') return ink(ctx, cw, ch, op, from);
  const rand = rng(op.seed);
  const x = op.u * cw, y = (1 - op.v) * ch;
  const r = Math.max(1.2, op.size * cw);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  if (op.kind === 'ketchup' || op.kind === 'mustard') {
    ctx.globalCompositeOperation = 'source-over';
    sauce(ctx, x, y, r, rand, op.kind, op.stretch || 1, op.angle || 0);
  } else if (op.kind === 'grease') {
    grease(ctx, x, y, r, rand);
  } else if (op.kind === 'seed') {
    ctx.globalCompositeOperation = 'source-over';
    seed(ctx, x, y, r, rand);
  } else if (op.kind === 'ring') {
    // mug base ring: a broken, uneven circle plus a faint second ring
    for (let ring = 0; ring < 2; ring++) {
      const rr = r * (ring ? 0.94 : 1), ox = ring ? r * 0.05 : 0, oy = ring ? -r * 0.03 : 0;
      const segs = 40;
      for (let i = 0; i < segs; i++) {
        if (rand() < 0.12) continue; // gaps where the rim did not touch
        const t0 = (i / segs) * Math.PI * 2, t1 = ((i + 1.15) / segs) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, rr * (1 + (rand() - 0.5) * 0.015), t0, t1);
        ctx.strokeStyle = `rgba(120,70,30,${(ring ? 0.18 : 0.45) * (0.55 + rand() * 0.45)})`;
        ctx.lineWidth = Math.max(1, r * (ring ? 0.035 : 0.06) * (0.6 + rand() * 0.8));
        ctx.stroke();
      }
    }
    // faint wash inside
    ctx.fillStyle = 'rgba(190,150,105,0.07)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.97, 0, Math.PI * 2); ctx.fill();
  } else {
    // a drop that lands at an angle smears into an ellipse with a tail and
    // a trail of tiny droplets in the direction it was flying
    const stretch = Math.min(3.2, op.stretch || 1);
    const ang = op.angle || 0;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(stretch, 1 / Math.sqrt(stretch));
    drop(ctx, 0, 0, r, rand, op.strength ?? 1);
    if (stretch > 1.25) {
      // tail
      drop(ctx, r * 1.05, 0, r * 0.32, rand, 0.9);
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) drop(ctx, r * (1.5 + i * 0.6 + rand() * 0.3), (rand() - 0.5) * r * 0.3, r * (0.12 + rand() * 0.1), rand, 0.85);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // big splashes throw a few satellite droplets
    const sat = op.size > 0.022 ? 2 + Math.floor(rand() * 4) : 0;
    for (let i = 0; i < sat; i++) {
      const a = ang + (rand() - 0.5) * 2.2, d = r * stretch * (1.2 + rand() * 1.4);
      drop(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.07 + rand() * 0.12), rand, 0.85);
    }
  }
  ctx.restore();
}


// ---- burger stains -------------------------------------------------------
const SAUCE = {
  ketchup: { base: [176, 22, 14], dark: [112, 8, 6], light: [214, 52, 34] },
  mustard: { base: [222, 168, 18], dark: [170, 112, 6], light: [246, 206, 70] },
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// thick sauce sits ON the paper: opaque, glossy, with a soft shadow under it
function sauce(ctx, x, y, r, rand, kind, stretch, ang) {
  const c = SAUCE[kind];
  const st = Math.min(2.2, stretch);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang); ctx.scale(st, 1 / Math.sqrt(st));
  // contact shadow
  ctx.fillStyle = 'rgba(40,20,10,0.16)';
  blobPath(ctx, r * 0.08, r * 0.1, r * 1.04, rand, 0.2);
  ctx.fill();
  // body
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 1.05);
  g.addColorStop(0, rgba(c.light, 0.97));
  g.addColorStop(0.55, rgba(c.base, 0.97));
  g.addColorStop(1, rgba(c.dark, 0.98));
  ctx.fillStyle = g;
  blobPath(ctx, 0, 0, r, rand, 0.24);
  ctx.fill();
  // a tail for blobs that skidded
  if (st > 1.3) {
    ctx.beginPath();
    ctx.ellipse(r * 1.05, 0, r * 0.38, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // glossy highlight
  const h = ctx.createRadialGradient(-r * 0.32, -r * 0.36, 0, -r * 0.32, -r * 0.36, r * 0.5);
  h.addColorStop(0, 'rgba(255,255,255,0.55)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.34, r * 0.42, r * 0.26, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // little splatter dots
  const n = r > 6 ? 2 + Math.floor(rand() * 4) : 0;
  for (let i = 0; i < n; i++) {
    const a = ang + (rand() - 0.5) * 2.4, d = r * st * (1.3 + rand() * 1.3), rr = r * (0.08 + rand() * 0.14);
    ctx.fillStyle = rgba(c.base, 0.95);
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rr, 0, Math.PI * 2); ctx.fill();
  }
}

// grease makes paper darker and a little see-through, with soft edges
function grease(ctx, x, y, r, rand) {
  for (let k = 0; k < 3; k++) {
    const ox = (rand() - 0.5) * r * 0.5, oy = (rand() - 0.5) * r * 0.5, rr = r * (0.55 + rand() * 0.45);
    const g = ctx.createRadialGradient(x + ox, y + oy, rr * 0.2, x + ox, y + oy, rr);
    g.addColorStop(0, 'rgba(206,176,120,0.30)');
    g.addColorStop(0.8, 'rgba(214,186,130,0.22)');
    g.addColorStop(1, 'rgba(220,195,140,0)');
    ctx.fillStyle = g;
    blobPath(ctx, x + ox, y + oy, rr, rand, 0.2);
    ctx.fill();
  }
}

function seed(ctx, x, y, r, rand) {
  const a = rand() * Math.PI;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(60,40,20,0.22)';
  ctx.beginPath(); ctx.ellipse(r * 0.15, r * 0.2, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
  g.addColorStop(0, '#fbf1d6'); g.addColorStop(1, '#d9c08c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.52, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,115,60,0.6)'; ctx.lineWidth = Math.max(0.6, r * 0.08); ctx.stroke();
  ctx.restore();
}

/** stain drawn alone on a transparent canvas (for table splats) */
export function stainCanvas(kind, seedNo, size = 128, extra = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawStain(c.getContext('2d'), size, size, { kind, u: 0.5, v: 0.5, size: extra.size ?? 0.18, seed: seedNo, ...extra });
  return c;
}

/** a small canvas with a coffee splat, used for puddles on the table */
export function makeSplatCanvas(seed, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  const r = size * 0.3;
  const g = ctx.createRadialGradient(size / 2, size / 2, r * 0.1, size / 2, size / 2, r * 1.1);
  g.addColorStop(0, 'rgba(70,36,14,0.55)');
  g.addColorStop(1, 'rgba(45,22,8,0.8)');
  ctx.fillStyle = g;
  blobPath(ctx, size / 2, size / 2, r, rand, 0.22);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2, d = r * (1.2 + rand() * 0.8);
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, r * (0.05 + rand() * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  // wet highlight
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,240,220,0.12)';
  ctx.beginPath(); ctx.ellipse(size * 0.44, size * 0.42, r * 0.35, r * 0.18, -0.6, 0, Math.PI * 2); ctx.fill();
  return c;
}
