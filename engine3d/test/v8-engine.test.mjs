// v8-engine.test.mjs — verify the V8 engine build + cross-plane kinematics.
import { buildV8Engine, computeV8State, V8_INFO, V8_FIRE_PHASE } from '../public/js/v8-parts.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const eng = buildV8Engine();
const { parts, roots } = eng;

ok(parts.length > 150, 'V8 has many parts (' + parts.length + ')');
ok(roots.length > 30, 'V8 has many roots (' + roots.length + ')');

let tris = 0, badGeo = 0;
for (const p of parts) {
  for (const m of p.meshes) {
    const g = m.geometry;
    const nv = g.positions.length / 3;
    for (let i = 0; i < g.positions.length; i++) if (!Number.isFinite(g.positions[i])) badGeo++;
    for (const ix of g.indices) if (ix >= nv) badGeo++;
    tris += g.indices.length / 3;
  }
}
ok(badGeo === 0, 'V8 geometry valid');
console.log('V8 triangles:', Math.round(tris));

const byName = (n) => parts.find((p) => p.name === n);
for (const n of ['曲轴', '主轴颈1', '连杆1', '连杆8', '活塞1', '活塞8', '气缸1', '气缸8',
  '气缸盖(左排)', '气缸盖(右排)', '凸轮轴(左排)', '凸轮轴(右排)', '进气门1', '排气门8', '气门弹簧(1缸进)',
  '正时链条', '油底壳', '飞轮', '喷油器1', '火花塞8', '燃烧室1']) {
  ok(!!byName(n), 'V8 part exists: ' + n);
}

// firing order 1-8-4-3-6-5-7-2
const order = [];
for (let a = 0; a < 720; a++) {
  const st = computeV8State(a);
  for (let i = 0; i < 8; i++) {
    if (st.cyl[i].cycleAngle >= 0 && st.cyl[i].cycleAngle < 1) { order.push(i + 1); break; }
  }
}
ok(JSON.stringify(order) === JSON.stringify([1, 8, 4, 3, 6, 5, 7, 2]), 'V8 firing order: ' + order.join('-'));

// every cylinder reaches TDC at its firing phase
const R = 42, L = 140;
for (let i = 0; i < 8; i++) {
  const st = computeV8State(V8_FIRE_PHASE[i]);
  ok(approx(st.cyl[i].pistonDist, R + L, 1e-3), 'cyl' + (i + 1) + ' at TDC on firing (dist=' + st.cyl[i].pistonDist.toFixed(2) + ')');
}

// strokes at crank=0 (cyl1 just fired)
const st0 = computeV8State(0);
ok(st0.cyl[0].stroke === 'power', 'cyl1 power at crank 0');
for (let i = 0; i < 8; i++) {
  const seen = new Set();
  for (let a = 0; a < 720; a += 20) seen.add(computeV8State(a).cyl[i].stroke);
  ok(seen.size === 4, 'cyl' + (i + 1) + ' cycles all 4 strokes');
}

// valve lift: intake peak at firePhase + 470, closed at +230
{
  const st = computeV8State(V8_FIRE_PHASE[0] + 470);
  ok(approx(st.cyl[0].intakeLift, 8, 1e-3), 'cyl1 intake peak 8mm');
  ok(computeV8State(V8_FIRE_PHASE[0] + 230).cyl[0].intakeLift === 0, 'cyl1 intake closed at +230');
}

// cam at half speed
ok(approx(computeV8State(200).camDeg, 100), 'camDeg = crankDeg/2');

// metadata
ok(V8_INFO.cylinders === 8 && V8_INFO.fireOrderText === '1-8-4-3-6-5-7-2', 'V8 metadata');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
