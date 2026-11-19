// Page deformation: paper folding + cylinder curl.
//
// Coordinates are in "local page space": the spine is the line u = 0 and the
// page extends to u = W, v in [-H/2, H/2]. A backward flip uses the same math
// on a mirrored mesh.
//
// Model: the reader grabs the page at G (on the outer edge) and drags it to M.
// A sheet of paper folded so that G lands on M has its fold line on the
// perpendicular bisector of GM. Instead of a sharp crease we roll the paper
// around a cylinder of radius R, which is what makes the curl look real. The
// page is glued to the spine, so both spine corners must keep their distance
// to the grabbed point (|S - M| <= |S - G|): that constraint is what makes a
// dragged corner swing on a believable arc instead of tearing off.

export function constrainPointer(G, M, W, H) {
  let mx = Math.min(M[0], G[0]);
  let my = M[1];
  const spine = [[0, H / 2], [0, -H / 2]];
  for (let it = 0; it < 4; it++) {
    for (const [sx, sy] of spine) {
      const rg = Math.hypot(G[0] - sx, G[1] - sy);
      const dx = mx - sx, dy = my - sy;
      const r = Math.hypot(dx, dy);
      if (r > rg) { mx = sx + (dx * rg) / r; my = sy + (dy * rg) / r; }
    }
  }
  // never let the page go further than lying flat on the other side
  mx = Math.max(mx, -W);
  return [mx, my];
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Write deformed vertex positions into `pos`.
 * @param o.rest   Float32Array rest positions (u, v, 0) per vertex
 * @param o.pos    Float32Array output positions
 * @param o.G,o.M  grab point and (constrained) pointer, local space
 * @param o.zFlat  base height of the part still lying on its stack
 * @param o.zFold  base height of the folded part (moves towards the other stack)
 * @param o.bulge  function u -> extra height (gutter dip of an open book)
 */
export function deformPage(o) {
  const { rest, pos, W, H, G, M, Rbase, lift, zFlat, zFold, bulge } = o;
  const n = rest.length / 3;
  const dx = G[0] - M[0], dy = G[1] - M[1];
  const len = Math.hypot(dx, dy);

  if (len < 1e-5) {
    for (let i = 0; i < n; i++) {
      const u = rest[i * 3], v = rest[i * 3 + 1];
      pos[i * 3] = u; pos[i * 3 + 1] = v; pos[i * 3 + 2] = zFlat + bulge(u);
    }
    return { progress: 0, R: 0 };
  }

  const nx = dx / len, ny = dy / len;
  const midx = (G[0] + M[0]) / 2, midy = (G[1] + M[1]) / 2;

  // Signed distance of both spine corners from the fold line. They must stay
  // on the flat side, so the cylinder radius shrinks as the fold nears the
  // spine and the page lands perfectly flat at the end of a turn.
  const dTop = -midx * nx + (H / 2 - midy) * ny;
  const dBot = -midx * nx + (-H / 2 - midy) * ny;
  const maxdS = Math.max(dTop, dBot);
  let R = Math.min(Rbase, len * 0.55, Math.max(0, (-2 * maxdS) / Math.PI));
  R = Math.max(R, 1e-5);

  // shift the cylinder so the grabbed point ends exactly under the pointer
  const d0 = (-Math.PI * R) / 2;
  const progress = Math.min(1, Math.max(0, (G[0] - M[0]) / (2 * W)));
  const L = lift * Math.sin(Math.PI * progress);
  const zBase = zFlat + (zFold - zFlat) * progress;
  const PI_R = Math.PI * R;

  for (let i = 0; i < n; i++) {
    const u = rest[i * 3], v = rest[i * 3 + 1];
    const z0 = bulge(u);
    const d = (u - midx) * nx + (v - midy) * ny;
    const s = d - d0;
    if (s <= 0) {
      pos[i * 3] = u; pos[i * 3 + 1] = v; pos[i * 3 + 2] = zFlat + z0;
      continue;
    }
    let dd, zz;
    const th = s / R;
    if (th < Math.PI) { dd = d0 + R * Math.sin(th); zz = R * (1 - Math.cos(th)); }
    else { dd = d0 - (s - PI_R); zz = 2 * R; }
    const x = u + nx * (dd - d);
    const y = v + ny * (dd - d);
    const ff = Math.min(1, s / (PI_R + 1e-6));
    // the folded part also rises off the book in an arc, like a real sheet
    // held by the reader, strongest mid-turn and zero when it lands
    const arc = L * Math.sin(Math.min(Math.abs(x) / W, 1) * Math.PI * 0.5) * smooth(0, 0.3 * W, s);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = zFlat + (zBase - zFlat) * ff + zz + z0 * (1 - ff) + arc;
  }
  return { progress, R };
}
