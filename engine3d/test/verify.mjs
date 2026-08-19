// verify.mjs — node test harness for the pure modules (math, geometry, kinematics).
import * as M from '../public/js/math3d.js';
import * as G from '../public/js/geometry.js';
import * as K from '../public/js/kinematics.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ---------- math ----------
{
  const I = M.mat4Identity();
  const t = M.mat4Translation(3, 4, 5);
  ok(approx(M.mat4Point(t, [0, 0, 0])[0], 3), 'translation x');
  const r90 = M.mat4RotZ(Math.PI / 2);
  const p = M.mat4Point(r90, [1, 0, 0]);
  ok(approx(p[0], 0) && approx(p[1], 1), 'rotZ 90 maps +X to +Y');

  // inverse-transpose of a rotation = itself
  const m3 = M.mat3FromMat4(r90);
  const it = M.mat3InverseTranspose(m3);
  ok(approx(it[0], m3[0]) && approx(it[4], m3[4]) && approx(it[8], m3[8]), 'invT(rot)=rot');
  // inverse-transpose of scale(2,2,2) = 1/2
  const s3 = M.mat3FromMat4(M.mat4Scale(2, 2, 2));
  const its = M.mat3InverseTranspose(s3);
  ok(approx(its[0], 0.5), 'invT(scale)=1/s');
}

// ---------- geometry: winding / index sanity ----------
function faceNormals(geo) {
  const p = geo.positions, ix = geo.indices;
  const out = [];
  for (let i = 0; i < ix.length; i += 3) {
    const a = [p[ix[i] * 3], p[ix[i] * 3 + 1], p[ix[i] * 3 + 2]];
    const b = [p[ix[i + 1] * 3], p[ix[i + 1] * 3 + 1], p[ix[i + 1] * 3 + 2]];
    const c = [p[ix[i + 2] * 3], p[ix[i + 2] * 3 + 1], p[ix[i + 2] * 3 + 2]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cent = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    out.push({ n, cent });
  }
  return out;
}
function checkOutward(geo, name) {
  const fn = faceNormals(geo);
  const nv = geo.positions.length / 3;
  ok(nv > 0 && geo.indices.length > 0, name + ' non-empty');
  let bad = 0;
  for (const f of fn) {
    const d = f.n[0] * f.cent[0] + f.n[1] * f.cent[1] + f.n[2] * f.cent[2];
    if (d <= 0) bad++;
  }
  ok(bad === 0, name + ' outward winding (' + bad + ' bad of ' + fn.length + ')');
  // indices in range
  let rangeBad = 0;
  for (const ix of geo.indices) if (ix >= nv) rangeBad++;
  ok(rangeBad === 0, name + ' indices in range');
}

checkOutward(G.box(10, 20, 30), 'box');
checkOutward(G.cylinder(5, 5, 20, 24), 'cylinder');
checkOutward(G.cylinder(5, 3, 20, 24), 'cylinder-tapered');
{
  // tube is hollow: outer side outward, inner side inward, annulus +/-Y
  const g = G.tube(4, 6, 20, 24);
  const fn = faceNormals(g);
  let outer = 0, inner = 0, capTop = 0, capBot = 0;
  for (const f of fn) {
    const rad = Math.hypot(f.cent[0], f.cent[2]);
    if (Math.abs(f.cent[1]) > 9.9) {
      // annulus
      if (f.cent[1] > 0) { if (f.n[1] > 0) capTop++; }
      else { if (f.n[1] < 0) capBot++; }
    } else if (rad > 5) {
      if (f.n[0] * f.cent[0] + f.n[2] * f.cent[2] > 0) outer++;
    } else {
      if (f.n[0] * f.cent[0] + f.n[2] * f.cent[2] < 0) inner++;
    }
  }
  ok(outer === 48 && inner === 48 && capTop === 48 && capBot === 48,
    'tube outer/inner/caps (' + outer + ',' + inner + ',' + capTop + ',' + capBot + ')');
}
checkOutward(G.lathe([[2, -10], [3, 0], [2, 10]], 24, { capTop: true, capBottom: true }), 'lathe');
checkOutward(G.extrudePolar((t) => 5 + 2 * Math.cos(t), 40, 8), 'extrudePolar');

// tubeAlongPath straight: normals should be perpendicular to path (Y) and winding outward
{
  const pts = [[0, 0, 0], [0, 10, 0], [0, 20, 0]];
  const g = G.tubeAlongPath(pts, 2, 16);
  const fn = faceNormals(g);
  let bad = 0;
  for (const f of fn) {
    const radial = [f.cent[0], 0, f.cent[2]];
    const rl = Math.hypot(...radial);
    if (rl < 1e-6) { bad++; continue; }
    const d = f.n[0] * radial[0] + f.n[2] * radial[2];
    if (d <= 0) bad++;
  }
  ok(bad === 0, 'tubeAlongPath outward (' + bad + ' bad)');
}

// ---------- kinematics ----------
{
  const r = K.ENGINE.crankRadius, L = K.ENGINE.rodLength;
  let k = K.pistonKinematics(0, 0);
  ok(approx(k.pistonY, r + L), 'piston TDC = r+L');
  ok(approx(k.pinX, 0) && approx(k.pinY, r), 'pin at TDC top');
  k = K.pistonKinematics(180, 0);
  ok(approx(k.pistonY, L - r), 'piston BDC = L-r');
  k = K.pistonKinematics(90, 0);
  ok(approx(k.pistonY, Math.sqrt(L * L - r * r), 1e-4), 'piston at 90deg = sqrt(L^2-r^2)');
  ok(approx(k.rodAngleDeg, Math.atan2(r, Math.sqrt(L * L - r * r)) / K.DEG), 'rod angle at 90deg');

  // firing order / stroke mapping at crank=0
  const s0 = [0, 1, 2, 3].map((i) => K.strokeKey(i, 0));
  ok(s0[0] === 'power' && s0[1] === 'exhaust' && s0[2] === 'compression' && s0[3] === 'intake',
    'stroke mapping at crank=0: ' + s0.join(','));

  // every cylinder reaches each stroke exactly once per 720deg
  for (const cyl of [0, 1, 2, 3]) {
    const seen = new Set();
    for (let a = 0; a < 720; a += 20) seen.add(K.strokeKey(cyl, a));
    ok(seen.size === 4, 'cyl' + (cyl + 1) + ' cycles through all 4 strokes');
  }
  // all four fire within one 720deg cycle, in order 1-3-4-2
  const fireOrder = [];
  for (let a = 0; a < 720; a += 1) {
    for (const cyl of [0, 1, 2, 3]) {
      if (K.isFiring(cyl, a, 1)) { fireOrder.push(cyl + 1); break; }
    }
  }
  ok(JSON.stringify(fireOrder) === JSON.stringify([1, 3, 4, 2]), 'fire order 1-3-4-2 got ' + fireOrder.join('-'));

  // valve lift
  ok(approx(K.valveLift(470, 0, 'intake'), K.ENGINE.valveLiftMax, 1e-4), 'intake peak at 470');
  ok(approx(K.valveLift(250, 0, 'exhaust'), K.ENGINE.valveLiftMax, 1e-4), 'exhaust peak at 250');
  ok(K.valveLift(230, 0, 'intake') === 0, 'intake closed at 230');
  ok(K.valveLift(100, 0, 'exhaust') === 0, 'exhaust closed at 100');
  ok(K.valveLift(390, 0, 'exhaust') === 0, 'exhaust closed at 390');
  // intake opens ~350, closed ~590 (crank deg)
  ok(K.valveLift(351, 0, 'intake') > 0 && K.valveLift(349, 0, 'intake') === 0, 'intake opens at 350');
  ok(K.valveLift(589, 0, 'intake') > 0 && K.valveLift(591, 0, 'intake') === 0, 'intake closes at 590');

  // cam lobe radius
  ok(approx(K.camLobeRadius(0), 22) && approx(K.camLobeRadius(60), 14) && approx(K.camLobeRadius(90), 14), 'cam lobe profile');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
