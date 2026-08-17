// geometry.js — procedural mesh generators (no dependencies).
// Every generator returns { positions: Float32Array, normals: Float32Array, indices: Uint16Array }.
// Axis conventions: cylinders/lathes are revolved around +Y; extrudePolar extrudes along +Z.

class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.idx = [];
    this.v = 0;
  }
  vertex(x, y, z, nx, ny, nz) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    return this.v++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  build() {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      indices: new Uint16Array(this.idx),
    };
  }
}

export function mergeGeometries(list) {
  const b = new Builder();
  for (const g of list) {
    const off = b.v;
    const nv = g.positions.length / 3;
    for (let i = 0; i < g.positions.length; i++) b.pos.push(g.positions[i]);
    for (let i = 0; i < g.normals.length; i++) b.nrm.push(g.normals[i]);
    for (let i = 0; i < g.indices.length; i++) b.idx.push(g.indices[i] + off);
    b.v += nv;
  }
  return b.build();
}

// Axis-aligned box, centered at origin, half-sizes.
export function box(sx, sy, sz) {
  const b = new Builder();
  const hx = sx, hy = sy, hz = sz;
  const V = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const add = (n, a, bb, c, d) => {
    const ia = b.vertex(...V[a], ...n), ib = b.vertex(...V[bb], ...n);
    const ic = b.vertex(...V[c], ...n), id = b.vertex(...V[d], ...n);
    b.quad(ia, ib, ic, id);
  };
  add([1, 0, 0], 1, 2, 6, 5);    // +X
  add([-1, 0, 0], 4, 7, 3, 0);   // -X
  add([0, 1, 0], 3, 7, 6, 2);    // +Y
  add([0, -1, 0], 0, 1, 5, 4);   // -Y
  add([0, 0, 1], 4, 5, 6, 7);    // +Z
  add([0, 0, -1], 0, 3, 2, 1);   // -Z
  return b.build();
}

// Solid cylinder along Y, centered at origin (y from -h/2..+h/2).
export function cylinder(rTop, rBottom, h, seg, opts = {}) {
  const thetaStart = opts.thetaStart ?? 0;
  const thetaLength = opts.thetaLength ?? Math.PI * 2;
  const capTop = opts.capTop ?? true;
  const capBottom = opts.capBottom ?? true;
  const smooth = opts.smooth ?? true;
  const b = new Builder();
  const hy = h / 2;
  const full = Math.abs(thetaLength - Math.PI * 2) < 1e-6;

  const ringBottom = [];
  const ringTop = [];
  for (let i = 0; i <= seg; i++) {
    const t = thetaStart + (i / seg) * thetaLength;
    const sx = Math.sin(t), cx = Math.cos(t);
    ringBottom.push([rBottom * sx, -hy, rBottom * cx]);
    ringTop.push([rTop * sx, hy, rTop * cx]);
  }

  // side
  for (let i = 0; i < seg; i++) {
    const t0 = thetaStart + (i / seg) * thetaLength;
    const t1 = thetaStart + ((i + 1) / seg) * thetaLength;
    const s0 = Math.sin(t0), c0 = Math.cos(t0);
    const s1 = Math.sin(t1), c1 = Math.cos(t1);
    const n0 = [s0, 0, c0], n1 = [s1, 0, c1];
    if (!smooth) { /* flat normals via face — not used for cylinders */ }
    const b0 = b.vertex(...ringBottom[i], ...n0);
    const b1 = b.vertex(...ringBottom[i + 1], ...n1);
    const t0v = b.vertex(...ringTop[i], ...n0);
    const t1v = b.vertex(...ringTop[i + 1], ...n1);
    // outward winding (verified): (bottom_i, bottom_{i+1}, top_i) and (bottom_{i+1}, top_{i+1}, top_i)
    b.tri(b0, b1, t0v);
    b.tri(b1, t1v, t0v);
  }

  const cap = (ring, normal, outward) => {
    if (full) {
      const c = b.vertex(0, normal[1] * hy, 0, ...normal);
      for (let i = 0; i < seg; i++) {
        const a = b.vertex(...ring[i], ...normal);
        const cc = b.vertex(...ring[i + 1], ...normal);
        if (outward) b.tri(c, a, cc); else b.tri(c, cc, a);
      }
    } else {
      // sector cap (pie slice)
      const c = b.vertex(0, normal[1] * hy, 0, ...normal);
      const a = b.vertex(...ring[0], ...normal);
      const cc = b.vertex(...ring[seg], ...normal);
      if (outward) b.tri(c, a, cc); else b.tri(c, cc, a);
    }
  };
  if (capTop) cap(ringTop, [0, 1, 0], true);
  if (capBottom) cap(ringBottom, [0, -1, 0], false);

  return b.build();
}

// Hollow pipe along Y, centered at origin (y -h/2..+h/2): outer radius ro, inner radius ri.
export function tube(ri, ro, h, seg) {
  const b = new Builder();
  const hy = h / 2;
  const rings = { oBot: [], oTop: [], iBot: [], iTop: [] };
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const sx = Math.sin(t), cx = Math.cos(t);
    rings.oBot.push([ro * sx, -hy, ro * cx]);
    rings.oTop.push([ro * sx, hy, ro * cx]);
    rings.iBot.push([ri * sx, -hy, ri * cx]);
    rings.iTop.push([ri * sx, hy, ri * cx]);
  }
  // outer side (outward radial)
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const s = Math.sin(t), c = Math.cos(t);
    const b0 = b.vertex(...rings.oBot[i], s, 0, c);
    const b1 = b.vertex(...rings.oBot[i + 1], s, 0, c);
    const t0 = b.vertex(...rings.oTop[i], s, 0, c);
    const t1 = b.vertex(...rings.oTop[i + 1], s, 0, c);
    b.tri(b0, b1, t0); b.tri(b1, t1, t0);
  }
  // inner side (inward radial)
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const s = -Math.sin(t), c = -Math.cos(t); // inward
    const b0 = b.vertex(...rings.iBot[i], s, 0, c);
    const b1 = b.vertex(...rings.iBot[i + 1], s, 0, c);
    const t0 = b.vertex(...rings.iTop[i], s, 0, c);
    const t1 = b.vertex(...rings.iTop[i + 1], s, 0, c);
    b.tri(b0, t0, b1); b.tri(b1, t0, t1);
  }
  // annulus rings
  const ring = (y, normal, outward) => {
    for (let i = 0; i < seg; i++) {
      const ii = b.vertex(...rings.iBot[i].map((v, k) => (k === 1 ? y : v)), ...normal);
      const i2 = b.vertex(...rings.iBot[i + 1].map((v, k) => (k === 1 ? y : v)), ...normal);
      const oo = b.vertex(...rings.oBot[i].map((v, k) => (k === 1 ? y : v)), ...normal);
      const o2 = b.vertex(...rings.oBot[i + 1].map((v, k) => (k === 1 ? y : v)), ...normal);
      if (outward) { b.tri(ii, oo, o2); b.tri(ii, o2, i2); }
      else { b.tri(ii, o2, oo); b.tri(ii, i2, o2); }
    }
  };
  ring(hy, [0, 1, 0], true);
  ring(-hy, [0, -1, 0], false);
  return b.build();
}

// Surface of revolution around Y. profile = [[r, y], ...] with y ascending.
export function lathe(profile, seg, opts = {}) {
  const capTop = opts.capTop ?? (profile[profile.length - 1][0] === 0);
  const capBottom = opts.capBottom ?? (profile[0][0] === 0);
  const b = new Builder();
  const n = profile.length;

  // 2D outward normals in (r, y) plane via central differences
  const norm2 = [];
  for (let i = 0; i < n; i++) {
    const im = profile[Math.max(0, i - 1)];
    const ip = profile[Math.min(n - 1, i + 1)];
    let dr = ip[0] - im[0];
    let dy = ip[1] - im[1];
    if (i === 0) { dr = profile[1][0] - profile[0][0]; dy = profile[1][1] - profile[0][1]; }
    if (i === n - 1) { dr = profile[n - 1][0] - profile[n - 2][0]; dy = profile[n - 1][1] - profile[n - 2][1]; }
    // outward = (dy, -dr) normalized
    const l = Math.hypot(dy, dr) || 1;
    norm2.push([dy / l, -dr / l]);
  }

  // rings
  const rings = [];
  for (let i = 0; i < n; i++) {
    const r = profile[i][0], y = profile[i][1];
    const nr2 = norm2[i][0], ny2 = norm2[i][1];
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * Math.PI * 2;
      const sx = Math.sin(t), cx = Math.cos(t);
      const nx = nr2 * sx, nz = nr2 * cx, ny = ny2;
      const nl = Math.hypot(nx, ny, nz) || 1;
      ring.push([r * sx, y, r * cx, nx / nl, ny / nl, nz / nl]);
    }
    rings.push(ring);
  }

  for (let i = 0; i < n - 1; i++) {
    const A = rings[i], C = rings[i + 1];
    for (let j = 0; j < seg; j++) {
      const a = b.vertex(...A[j]);
      const a1 = b.vertex(...A[j + 1]);
      const c = b.vertex(...C[j]);
      const c1 = b.vertex(...C[j + 1]);
      b.tri(a, a1, c);
      b.tri(a1, c1, c);
    }
  }

  const cap = (ring, normalY, outward, apexR) => {
    const normal = [0, normalY, 0];
    if (apexR === 0) {
      // cone apex at axis
      const apex = b.vertex(0, ring[0][1], 0, ...normal);
      for (let j = 0; j < seg; j++) {
        const a = b.vertex(...ring[j]);
        const a1 = b.vertex(...ring[j + 1]);
        if (outward) b.tri(apex, a, a1); else b.tri(apex, a1, a);
      }
    } else {
      // flat disc cap
      const c = b.vertex(0, ring[0][1], 0, ...normal);
      for (let j = 0; j < seg; j++) {
        const a = b.vertex(...ring[j]);
        const a1 = b.vertex(...ring[j + 1]);
        if (outward) b.tri(c, a, a1); else b.tri(c, a1, a);
      }
    }
  };
  if (capTop) cap(rings[n - 1], 1, true, profile[n - 1][0]);
  if (capBottom) cap(rings[0], -1, false, profile[0][0]);

  return b.build();
}

// Prism extruded along Z from -t/2..+t/2 whose X-Y cross section is the polar curve r(theta).
// theta measured from +Y toward +X. Used for cam lobes.
export function extrudePolar(rFunc, seg, thickness) {
  const b = new Builder();
  const hz = thickness / 2;
  const pts = [];
  const nrm2 = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pts.push([rFunc(t) * Math.sin(t), rFunc(t) * Math.cos(t)]);
  }
  for (let i = 0; i < seg; i++) {
    const p0 = pts[(i - 1 + seg) % seg];
    const p1 = pts[(i + 1) % seg];
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1];
    // outward (left) normal for CCW polygon = (-ey, ex)
    const l = Math.hypot(ex, ey) || 1;
    nrm2.push([-ey / l, ex / l]);
  }
  const bot = [], top = [];
  for (let i = 0; i < seg; i++) {
    bot.push([pts[i][0], pts[i][1], -hz, nrm2[i][0], nrm2[i][1], 0]);
    top.push([pts[i][0], pts[i][1], hz, nrm2[i][0], nrm2[i][1], 0]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const a = b.vertex(...bot[i]);
    const a1 = b.vertex(...bot[j]);
    const c = b.vertex(...top[i]);
    const c1 = b.vertex(...top[j]);
    b.tri(a, c, a1);
    b.tri(a1, c, c1);
  }
  // caps: fan from origin (0,0)
  const cap = (ring, z, normal, outward) => {
    const c = b.vertex(0, 0, z, 0, 0, normal);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = b.vertex(...ring[i]);
      const a1 = b.vertex(...ring[j]);
      if (outward) b.tri(c, a, a1); else b.tri(c, a1, a);
    }
  };
  cap(top, hz, 1, false);
  cap(bot, -hz, -1, true);
  return b.build();
}

// Tube following an open polyline path. radius in world units.
export function tubeAlongPath(pts, radius, seg) {
  const n = pts.length;
  const tang = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(n - 1, i + 1)];
    const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    tang.push([d[0] / l, d[1] / l, d[2] / l]);
  }
  // parallel-transport frames
  const norm = [], bin = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = tang[i];
    if (!prevN) {
      let ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      prevN = [ref[0] - t[0] * (ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2]),
               ref[1] - t[1] * (ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2]),
               ref[2] - t[2] * (ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2])];
      const l = Math.hypot(...prevN) || 1;
      prevN = [prevN[0] / l, prevN[1] / l, prevN[2] / l];
    } else {
      const dot = prevN[0] * t[0] + prevN[1] * t[1] + prevN[2] * t[2];
      prevN = [prevN[0] - t[0] * dot, prevN[1] - t[1] * dot, prevN[2] - t[2] * dot];
      const l = Math.hypot(...prevN) || 1;
      prevN = [prevN[0] / l, prevN[1] / l, prevN[2] / l];
    }
    const bi = [t[1] * prevN[2] - t[2] * prevN[1], t[2] * prevN[0] - t[0] * prevN[2], t[0] * prevN[1] - t[1] * prevN[0]];
    norm.push(prevN);
    bin.push(bi);
  }

  const b = new Builder();
  const rings = [];
  for (let i = 0; i < n; i++) {
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const w = (j / seg) * Math.PI * 2;
      const cw = Math.cos(w), sw = Math.sin(w);
      const nx = norm[i][0] * cw + bin[i][0] * sw;
      const ny = norm[i][1] * cw + bin[i][1] * sw;
      const nz = norm[i][2] * cw + bin[i][2] * sw;
      ring.push([pts[i][0] + radius * nx, pts[i][1] + radius * ny, pts[i][2] + radius * nz, nx, ny, nz]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    const A = rings[i], C = rings[i + 1];
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = b.vertex(...A[j]);
      const a1 = b.vertex(...A[j2]);
      const c = b.vertex(...C[j]);
      const c1 = b.vertex(...C[j2]);
      b.tri(a, a1, c);
      b.tri(a1, c1, c);
    }
  }
  return b.build();
}

// Helix spring along +Y. Returns tube geometry for a coil of given height/turns/wire radius.
export function helix(height, turns, coilRadius, wireRadius, seg = 10, stepsPerTurn = 24) {
  const pts = [];
  const steps = Math.max(3, Math.round(turns * stepsPerTurn));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const y = height * f;
    const a = f * turns * Math.PI * 2;
    pts.push([coilRadius * Math.cos(a), y, coilRadius * Math.sin(a)]);
  }
  return tubeAlongPath(pts, wireRadius, seg);
}
