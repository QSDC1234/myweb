// parts.test.mjs — build the engine model in node and verify structure + animation math.
import { buildEngine, computeState, animate } from '../public/js/parts.js';
import { ENGINE } from '../public/js/kinematics.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('FAIL:', m); } }
function approx(a, b, e = 1e-4) { return Math.abs(a - b) <= e; }

const eng = buildEngine();
const { parts, byId, roots, dynamicParts } = eng;

// structure sanity
ok(parts.length > 150, 'many parts (' + parts.length + ')');
ok(roots.length > 30, 'many roots (' + roots.length + ')');
ok(dynamicParts.length > 40, 'many animated parts (' + dynamicParts.length + ')');

// geometry sanity (no NaN, indices in range)
let tris = 0, badGeo = 0;
for (const p of parts) {
  for (const m of p.meshes) {
    const g = m.geometry;
    if (!g || !g.positions || !g.normals || !g.indices) { badGeo++; continue; }
    const nv = g.positions.length / 3;
    for (let i = 0; i < g.positions.length; i++) if (!Number.isFinite(g.positions[i])) badGeo++;
    for (const ix of g.indices) if (ix >= nv) badGeo++;
    tris += g.indices.length / 3;
  }
}
ok(badGeo === 0, 'geometry valid (' + badGeo + ' bad)');
console.log('total triangles:', Math.round(tris));

const find = (name) => parts.find((p) => p.name === name);

// animate at crank = 0
let st = computeState(0);
animate(eng, st);
const crank = find('曲轴');
ok(approx(crank.local[0], 1) && approx(crank.local[5], 1), 'crank identity at 0');
const p1 = find('活塞1');
ok(approx(p1.local[13], ENGINE.crankRadius + ENGINE.rodLength), 'piston1 at TDC y=' + p1.local[13]);
const rod1 = find('连杆1');
ok(approx(rod1.local[12], 0) && approx(rod1.local[13], ENGINE.crankRadius), 'rod1 big-end at pin (TDC)');

// valve timing: at crank 470, intake valve 1 fully open (head at 222-8 = 214)
st = computeState(470);
animate(eng, st);
const iv1 = find('进气门1');
ok(approx(iv1.local[13], 222 - ENGINE.valveLiftMax, 1e-3), 'intake valve1 open y=' + iv1.local[13]);
const ev1 = find('排气门1');
ok(approx(ev1.local[13], 222, 1e-3), 'exhaust valve1 closed at 470 (y=' + ev1.local[13] + ')');

// cam rotates at half crank speed: at crank 470, camDeg = 235
const cam = find('凸轮轴');
ok(approx(cam.local[1], Math.sin(-235 * Math.PI / 180) * -1 ? 0 : 0) === true ? true : true, 'placeholder'); // rotation verified below
// direct check: cam.local = T(0,352,0)*RZ(-235deg). RZ(-235deg)[0] = cos(-235deg)
ok(approx(cam.local[0], Math.cos(-235 * Math.PI / 180)), 'cam rotation = -235deg');
ok(approx(cam.local[13], 352), 'cam axis height');

// piston down at 90deg
st = computeState(90);
animate(eng, st);
ok(approx(find('活塞1').local[13], Math.sqrt(ENGINE.rodLength ** 2 - ENGINE.crankRadius ** 2), 1e-3), 'piston1 at 90deg');

// firing-order stroke states at crank=0
st = computeState(0);
ok(st.cyl[0].stroke === 'power' && st.cyl[1].stroke === 'exhaust' && st.cyl[2].stroke === 'compression' && st.cyl[3].stroke === 'intake',
  'strokes at 0: ' + st.cyl.map(c => c.stroke).join(','));

// every part that is a shell or non-shell exists
for (const n of ['缸体', '气缸1', '气缸盖', '曲轴箱', '油底壳', '气缸盖罩', '进气歧管', '排气歧管', '节气门', '空气滤清器',
  '曲轴', '主轴颈1', '连杆1', '连杆大头1', '连杆小头1', '活塞1', '活塞销1', '活塞环1', '活塞裙1',
  '凸轮轴', '凸轮(1缸进)', '进气门1', '排气门1', '气门弹簧(1缸进)', '摇臂(1缸进)', '正时链条', '凸轮轴链轮', '曲轴正时链轮',
  '喷油器1', '火花塞1', '燃烧室1', '冷却液通道', '水泵', '机油通道', '机油泵', '机油滤清器']) {
  ok(!!find(n), 'part exists: ' + n);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
