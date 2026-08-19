// layers.test.mjs — verify the layered explosion metadata + interpolation.
import { buildEngine, layerAmount, LAYER_INFO, computeState, animate } from '../public/js/parts.js';
import { ENGINE } from '../public/js/kinematics.js';
import { mat4Translation, mat4Mul } from '../public/js/math3d.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const e = buildEngine();
const byName = (n) => e.parts.find((p) => p.name === n);

// layer assignments
ok(byName('气缸盖罩').layer === 1, 'valve cover -> layer 1');
ok(byName('凸轮轴').layer === 2, 'cam -> layer 2');
ok(byName('进气门1').layer === 2, 'intake valve -> layer 2');
ok(byName('气缸盖').layer === 3, 'head -> layer 3');
ok(byName('活塞1').layer === 4, 'piston -> layer 4');
ok(byName('连杆1').layer === 4, 'rod -> layer 4');
ok(byName('缸体').layer === 5, 'block -> layer 5');
ok(byName('气缸1').layer === 5, 'liner -> layer 5');
ok(byName('曲轴').layer === 6, 'crank -> layer 6');
ok(byName('油底壳').layer === 7, 'oil pan -> layer 7');
ok(byName('机油泵').layer === 7, 'oil pump -> layer 7');

// children should NOT have their own explode (they follow parents)
ok(byName('主轴颈1').explode === undefined || byName('主轴颈1').explode === null, 'main journal has no own explode');

// layerAmount: monotonic, 0 at start, 1 at threshold, smooth
ok(layerAmount(1, 0) === 0, 'layer1 at s=0 -> 0');
ok(approx(layerAmount(1, 0.15), 1), 'layer1 at s=0.15 -> 1');
ok(layerAmount(1, 0.03) === 0, 'layer1 at s=0.03 -> 0 (start)');
ok(layerAmount(6, 0.87) === 1, 'layer6 at s=0.87 -> 1');
ok(layerAmount(6, 0.75) === 0, 'layer6 at s=0.75 -> 0');
ok(layerAmount(6, 0.81) > 0 && layerAmount(6, 0.81) < 1, 'layer6 mid-window partial');
ok(layerAmount(7, 1) === 1, 'layer7 at s=1 -> 1');
// monotonic increasing across s
let prev = 0, mono = true;
for (let s = 0; s <= 1.001; s += 0.01) { const v = layerAmount(4, s); if (v < prev - 1e-9) mono = false; prev = v; }
ok(mono, 'layer4 amount monotonic');

// all roots have a layer in 0..7
let bad = 0;
for (const r of e.roots) if (r.layer < 0 || r.layer > 7) bad++;
ok(bad === 0, 'all roots have valid layer');

// every root except layer-0 has a nonzero explode
let noExplode = 0;
for (const r of e.roots) if (r.layer > 0 && !(r.explode && r.explode.length === 3)) noExplode++;
ok(noExplode === 0, 'all separated roots have explode vector (' + noExplode + ' missing)');

// motion metadata present
ok(byName('曲轴').motion && byName('曲轴').motion.includes('旋转'), 'crank motion text');
ok(byName('连杆1').motion && byName('连杆1').motion.includes('摆动'), 'rod motion text');
ok(byName('进气门1').motion && byName('进气门1').motion.includes('开闭'), 'valve motion text');

// --- CORE: mechanical motion persists at 100% explosion ---
// world = explode(translation) * local(animated pose): the two coordinate frames are decoupled.
function worldY(part, s) {
  const amt = layerAmount(part.layer, s);
  const ex = mat4Translation(part.explode[0] * amt, part.explode[1] * amt, part.explode[2] * amt);
  const w = mat4Mul(ex, part.local);
  return w[13];
}
const piston = byName('活塞1');
animate(e, computeState(0));   const y0 = worldY(piston, 1);
animate(e, computeState(180)); const y180 = worldY(piston, 1);
ok(approx(Math.abs(y0 - y180), ENGINE.stroke, 1e-3),
  'piston stroke preserved at 100% explosion (' + Math.abs(y0 - y180) + ' vs ' + ENGINE.stroke + ')');

const crank = byName('曲轴');
animate(e, computeState(0));   const w0 = crank.local[0]; // cos(-0) = 1
animate(e, computeState(90));  const w90 = crank.local[0]; // cos(-90) = ~0
ok(approx(w0, 1) && Math.abs(w90) < 1e-6, 'crank still rotates (local rotation varies with crank angle)');

// explosion adds a constant offset while the animated Y still sweeps: piston at 0 vs 90 differ
animate(e, computeState(90)); const y90 = worldY(piston, 1);
ok(approx(y90, layerAmount(4, 1) * 100 + Math.sqrt(ENGINE.rodLength ** 2 - ENGINE.crankRadius ** 2), 1e-2),
  'piston exploded Y = offset + slider-crank Y at 90deg');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
