// parts.js — builds the inline-4 engine as a scene graph of Parts (no GL/DOM deps).
// Each Part has meshes (in part-local frame) + an optional update(state) animator.

import {
  mat4Identity, mat4Translation, mat4RotX, mat4RotZ, mat4Scale, mat4Point,
  mat3InverseTranspose, DEG, rad, deg,
} from './math3d.js';
import * as G from './geometry.js';
import {
  ENGINE, PIN_OFFSET, FIRE_PHASE, FIRE_ORDER, STROKE_NAMES, pistonKinematics, valveLift, valveOpenCamDeg,
  strokeKey, strokeIndex, cycleAngleOf, isFiring, camLobeRadius, STROKE_COLORS,
} from './kinematics.js';

// ---------------- materials ----------------
export const MAT = {
  iron:     { color: [0.42, 0.42, 0.45], spec: 0.55, shininess: 42 },
  steel:    { color: [0.63, 0.65, 0.69], spec: 0.90, shininess: 95 },
  steelDark:{ color: [0.35, 0.36, 0.40], spec: 0.70, shininess: 70 },
  aluminum: { color: [0.71, 0.72, 0.75], spec: 0.80, shininess: 80 },
  brass:    { color: [0.73, 0.58, 0.25], spec: 0.85, shininess: 70 },
  copper:   { color: [0.72, 0.42, 0.20], spec: 0.60, shininess: 60 },
  rubber:   { color: [0.16, 0.16, 0.18], spec: 0.20, shininess: 18 },
  plastic:  { color: [0.20, 0.22, 0.27], spec: 0.30, shininess: 28 },
  red:      { color: [0.72, 0.18, 0.15], spec: 0.50, shininess: 50 },
  ceramic:  { color: [0.90, 0.88, 0.83], spec: 0.20, shininess: 18 },
  blue:     { color: [0.22, 0.45, 0.78], spec: 0.55, shininess: 50 },
  green:    { color: [0.28, 0.52, 0.28], spec: 0.40, shininess: 40 },
  oil:      { color: [0.58, 0.52, 0.30], spec: 0.60, shininess: 60 },
  exhaust:  { color: [0.45, 0.40, 0.40], spec: 0.45, shininess: 38 },
  carbon:   { color: [0.10, 0.11, 0.12], spec: 0.25, shininess: 22 },
};

// ---------------- helpers ----------------
export function transformGeo(g, mat) {
  const np = new Float32Array(g.positions.length);
  for (let i = 0; i < g.positions.length; i += 3) {
    const p = mat4Point(mat, [g.positions[i], g.positions[i + 1], g.positions[i + 2]]);
    np[i] = p[0]; np[i + 1] = p[1]; np[i + 2] = p[2];
  }
  const m3 = mat3InverseTranspose([mat[0], mat[1], mat[2], mat[4], mat[5], mat[6], mat[8], mat[9], mat[10]]);
  const nn = new Float32Array(g.normals.length);
  for (let i = 0; i < g.normals.length; i += 3) {
    const nx = g.normals[i], ny = g.normals[i + 1], nz = g.normals[i + 2];
    nn[i]     = m3[0] * nx + m3[3] * ny + m3[6] * nz;
    nn[i + 1] = m3[1] * nx + m3[4] * ny + m3[7] * nz;
    nn[i + 2] = m3[2] * nx + m3[5] * ny + m3[8] * nz;
  }
  return { positions: np, normals: nn, indices: g.indices };
}

const T = mat4Translation;
const RX = mat4RotX, RZ = mat4RotZ;

export class Part {
  constructor(id, name, opts = {}) {
    this.id = id;
    this.name = name;
    this.category = opts.category || '';
    this.func = opts.func || '';
    this.rel = opts.rel || '';
    this.local = opts.local ? opts.local.slice() : mat4Identity();
    this.meshes = [];
    this.children = [];
    this.parent = null;
    this.explode = opts.explode || null;         // [x,y,z] full-explode offset
    this.shell = !!opts.shell;                   // translucent in x-ray mode
    this.visible = true;
    this.pickable = opts.pickable !== false;
    this.transparent = !!opts.transparent;       // always alpha-blended
    this.update = opts.update || null;
  }
  addMesh(geo, material) { this.meshes.push({ geometry: geo, material }); }
  addChild(p) { p.parent = this; this.children.push(p); return p; }
}

// ---------------- timing belt path (external-tangent loop) ----------------
export function beltPath(c1, r1, c2, r2, arcSeg = 24, lineSeg = 14) {
  const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const u = [(c2[0] - c1[0]) / d, (c2[1] - c1[1]) / d];
  const v = [-u[1], u[0]];
  const cb = (r2 - r1) / d;
  const sb = Math.sqrt(Math.max(0, 1 - cb * cb));
  const nA = [u[0] * cb - v[0] * sb, u[1] * cb - v[1] * sb];
  const nB = [u[0] * cb + v[0] * sb, u[1] * cb + v[1] * sb];
  const t1a = [c1[0] + r1 * nA[0], c1[1] + r1 * nA[1]];
  const t2a = [c2[0] + r2 * nA[0], c2[1] + r2 * nA[1]];
  const t1b = [c1[0] + r1 * nB[0], c1[1] + r1 * nB[1]];
  const t2b = [c2[0] + r2 * nB[0], c2[1] + r2 * nB[1]];
  const ang = (cx, cy, px, py) => Math.atan2(py - cy, px - cx);
  const pts = [];
  // line t1a -> t2a
  for (let i = 0; i <= lineSeg; i++) {
    pts.push([t1a[0] + (t2a[0] - t1a[0]) * i / lineSeg, t1a[1] + (t2a[1] - t1a[1]) * i / lineSeg]);
  }
  // arc around c2 from t2a to t2b, CCW (over the top for vertical layout)
  let a2a = ang(c2[0], c2[1], t2a[0], t2a[1]);
  let a2b = ang(c2[0], c2[1], t2b[0], t2b[1]);
  let d2 = a2b - a2a; while (d2 <= 0) d2 += Math.PI * 2;
  for (let i = 1; i <= arcSeg; i++) {
    const a = a2a + d2 * i / arcSeg;
    pts.push([c2[0] + r2 * Math.cos(a), c2[1] + r2 * Math.sin(a)]);
  }
  // line t2b -> t1b
  for (let i = 1; i <= lineSeg; i++) {
    pts.push([t2b[0] + (t1b[0] - t2b[0]) * i / lineSeg, t2b[1] + (t1b[1] - t2b[1]) * i / lineSeg]);
  }
  // arc around c1 from t1b to t1a, CCW (under the bottom)
  let a1b = ang(c1[0], c1[1], t1b[0], t1b[1]);
  let a1a = ang(c1[0], c1[1], t1a[0], t1a[1]);
  let d1 = a1a - a1b; while (d1 <= 0) d1 += Math.PI * 2;
  for (let i = 1; i <= arcSeg; i++) {
    const a = a1b + d1 * i / arcSeg;
    pts.push([c1[0] + r1 * Math.cos(a), c1[1] + r1 * Math.sin(a)]);
  }
  // cumulative lengths
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cum.push(total);
  }
  return { pts, cum, total };
}

export function pathPointAt(path, s) {
  const { pts, cum, total } = path;
  s = ((s % total) + total) % total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (s - cum[i - 1]) / seg;
  const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
  const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
  const tx = pts[i][0] - pts[i - 1][0], ty = pts[i][1] - pts[i - 1][1];
  return { x, y, ang: Math.atan2(ty, tx) };
}

// ---------------- layered explosion system ----------------
// Layer 0 = fully assembled; each layer separates progressively as the slider passes its threshold.
export const LAYER_INFO = [
  { name: '完整发动机', at: 0.00 },
  { name: '第1层 · 外部附件', at: 0.15 },
  { name: '第2层 · 配气机构', at: 0.30 },
  { name: '第3层 · 气缸盖', at: 0.45 },
  { name: '第4层 · 活塞与连杆', at: 0.60 },
  { name: '第5层 · 发动机缸体', at: 0.74 },
  { name: '第6层 · 曲轴', at: 0.87 },
  { name: '第7层 · 油底壳与润滑系统', at: 1.00 },
];

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// Separation amount (0..1) of a layer at slider value s (0..1), smooth within a window.
export function layerAmount(layer, s) {
  if (!layer || layer <= 0) return 0;
  const at = LAYER_INFO[layer].at;
  const start = at - 0.12;
  return smoothstep((s - start) / (at - start));
}

// Layer / explode-vector / motion descriptions, matched by part name.
const LAYER_DEFS = [
  { layer: 1, re: /^气缸盖罩$/, explode: [0, 300, 0] },
  { layer: 1, re: /^进气歧管$/, explode: [170, 60, 0] },
  { layer: 1, re: /^排气歧管$/, explode: [-170, 60, 0] },
  { layer: 1, re: /^节气门$/, explode: [200, 110, 120] },
  { layer: 1, re: /^空气滤清器$/, explode: [170, 170, 60] },
  { layer: 2, re: /^凸轮轴$/, explode: [0, 230, 0] },
  { layer: 2, re: /^摇臂轴$/, explode: [0, 205, 0] },
  { layer: 2, re: /^摇臂\(/, explode: [0, 205, 0] },
  { layer: 2, re: /^进气门/, explode: [0, 190, 0] },
  { layer: 2, re: /^排气门/, explode: [0, 190, 0] },
  { layer: 2, re: /^气门弹簧/, explode: [0, 190, 0] },
  { layer: 2, re: /^正时链条$/, explode: [0, 0, 150] },
  { layer: 2, re: /^正时链条导轨$/, explode: [0, 0, 140] },
  { layer: 3, re: /^气缸盖$/, explode: [0, 150, 0] },
  { layer: 3, re: /^气缸垫$/, explode: [0, 120, 0] },
  { layer: 3, re: /^燃烧室/, explode: [0, 145, 0] },
  { layer: 3, re: /^火花塞/, explode: [0, 165, 0] },
  { layer: 3, re: /^喷油器/, explode: [130, 140, 0] },
  { layer: 4, re: /^活塞/, explode: [0, 100, 0] },
  { layer: 4, re: /^连杆/, explode: [0, 60, 0] },
  { layer: 4, re: /^缸内工质/, explode: [0, 100, 0] },
  { layer: 4, re: /^点火火焰/, explode: [0, 100, 0] },
  { layer: 5, re: /^缸体$/, explode: [0, -40, 0] },
  { layer: 5, re: /^气缸[1-4]$/, explode: [0, -40, 0] },
  { layer: 5, re: /^曲轴箱$/, explode: [0, -40, 0] },
  { layer: 5, re: /^冷却液通道$/, explode: [0, -40, 0] },
  { layer: 6, re: /^曲轴$/, explode: [0, -180, 0] },
  { layer: 7, re: /^油底壳$/, explode: [0, -300, 0] },
  { layer: 7, re: /^机油泵$/, explode: [110, -260, 60] },
  { layer: 7, re: /^机油滤清器$/, explode: [120, -200, 0] },
  { layer: 7, re: /^机油通道$/, explode: [0, -260, 0] },
  { layer: 7, re: /^水泵$/, explode: [90, -60, 140] },
];

const MOTION_DEFS = [
  { re: /^曲轴$/, m: '绕自身轴线匀速旋转（转速 = 设定 RPM）' },
  { re: /^主轴颈/, m: '随曲轴整体旋转' },
  { re: /^飞轮/, m: '随曲轴整体旋转' },
  { re: /^活塞/, m: '沿气缸轴线往复运动（由曲轴经连杆驱动）' },
  { re: /^连杆/, m: '大头绕曲柄销旋转，小头随活塞往复，作平面摆动' },
  { re: /^凸轮轴$/, m: '以曲轴 1/2 的转速旋转' },
  { re: /^凸轮\(/, m: '随凸轮轴旋转，轮廓决定气门升程' },
  { re: /^进气门/, m: '沿气门轴线往复开闭（凸轮经摇臂驱动）' },
  { re: /^排气门/, m: '沿气门轴线往复开闭（凸轮经摇臂驱动）' },
  { re: /^气门弹簧/, m: '随气门开闭被压缩 / 回弹' },
  { re: /^摇臂/, m: '绕摇臂轴摆动，传递凸轮运动' },
  { re: /^正时链条/, m: '沿正时链轮路径循环运转' },
  { re: /^缸内工质/, m: '随活塞位置改变体积，颜色随冲程变化' },
  { re: /^点火火焰/, m: '做功冲程初期短暂出现并熄灭' },
];

export function assignLayersAndMotion(parts, roots, layerDefs = LAYER_DEFS, motionDefs = MOTION_DEFS) {
  for (const p of parts) {
    // motion
    p.motion = '固定不动（随所属总成运动）';
    for (const d of motionDefs) if (d.re.test(p.name)) { p.motion = d.m; break; }
    // layer + explode (only top-level roots get their own explode offset)
    if (p.parent) continue;
    p.layer = 0; p.explode = null;
    for (const d of layerDefs) {
      if (d.re.test(p.name)) { p.layer = d.layer; p.explode = d.explode.slice(); break; }
    }
  }
}

// ---------------- model construction ----------------
export function buildEngine() {
  const E = ENGINE;
  const bore = E.bore, r = E.crankRadius, L = E.rodLength;
  const cylZ = [150, 50, -50, -150];
  const deckY = 222, headTopY = 345, coverTopY = 390;
  const blockBottomY = 45, crankBottomY = -95, panBottomY = -150;
  const camAxisY = 352, rockerShaftY = 334, valveTipY = 330, valveSeatY = 222;
  const stemLen = valveTipY - valveSeatY;
  const springSeatY = 252, springH = valveTipY - 8 - springSeatY;
  const compH = 30;                    // pin -> crown
  const armLen = 22;                   // rocker arm length
  const HB = 240, HL = 520;            // head/block half-width, half-length

  const roots = [];
  const parts = [];
  const byId = new Map();
  let nextId = 1;

  const P = (name, opts = {}) => {
    const p = new Part('p' + (nextId++), name, opts);
    parts.push(p);
    byId.set(p.id, p);
    if (!opts.child) roots.push(p);
    return p;
  };
  const child = (parent, name, opts = {}) => {
    const p = P(name, { ...opts, child: true });
    return parent.addChild(p);
  };

  const body = (name, meshes, opts = {}) => {
    const p = P(name, opts);
    for (const [g, m] of meshes) p.addMesh(g, m);
    return p;
  };

  // ===== 发动机主体 =====
  const CAT_BODY = '发动机主体';

  // 缸体（外壁 + 顶面）
  const block = body('缸体', [
    [transformGeo(G.box(HB, deckY - blockBottomY, 16), T(0, (blockBottomY + deckY) / 2, HL / 2 - 8)), MAT.iron],     // front
    [transformGeo(G.box(HB, deckY - blockBottomY, 16), T(0, (blockBottomY + deckY) / 2, -HL / 2 + 8)), MAT.iron],    // rear
    [transformGeo(G.box(16, deckY - blockBottomY, HL), T(HB / 2 - 8, (blockBottomY + deckY) / 2, 0)), MAT.iron],      // left
    [transformGeo(G.box(16, deckY - blockBottomY, HL), T(-HB / 2 + 8, (blockBottomY + deckY) / 2, 0)), MAT.iron],     // right
    [transformGeo(G.box(HB, 18, HL), T(0, deckY - 9, 0)), MAT.iron],                                                  // deck
  ], { category: CAT_BODY, shell: true, func: '发动机的基础铸件，容纳气缸、冷却水道与曲轴箱，是整机骨架。',
       rel: '上方安装气缸盖，内部压装气缸套，下方连接曲轴箱与油底壳。' });

  // 气缸（缸套）x4
  const linerParts = cylZ.map((z, i) => body(`气缸${i + 1}`,
    [[transformGeo(G.tube(43, 50, deckY - blockBottomY, 36), T(0, (blockBottomY + deckY) / 2, z)), MAT.steel]],
    { category: CAT_BODY, func: '活塞在其内部往复运动的圆柱形工作腔，内壁经过精密加工。',
      rel: '安装在缸体承孔内，与活塞、活塞环配合构成密封的燃烧空间。' }));

  // 气缸盖
  body('气缸盖', [
    [transformGeo(G.box(HB, headTopY - deckY, HL), T(0, (deckY + headTopY) / 2, 0)), MAT.aluminum],
  ], { category: CAT_BODY, shell: true, explode: [0, 60, 0],
       func: '封闭气缸顶部，布置进排气道、燃烧室、气门与火花塞，承受高温高压。',
       rel: '通过缸盖螺栓固定在缸体上，与缸体、缸垫共同形成密封的燃烧室。' });

  // 缸垫
  body('气缸垫', [
    [transformGeo(G.box(HB - 4, 4, HL - 4), T(0, deckY - 2, 0)), MAT.copper],
  ], { category: CAT_BODY, explode: [0, 32, 0], func: '密封缸体与缸盖之间的结合面，防止燃气、冷却液与机油互窜。',
       rel: '夹在缸体与缸盖之间，由缸盖螺栓压紧。' });

  // 曲轴箱
  body('曲轴箱', [
    [transformGeo(G.box(HB, 140, 18), T(0, -25, HL / 2 - 9)), MAT.iron],    // front
    [transformGeo(G.box(HB, 140, 18), T(0, -25, -HL / 2 + 9)), MAT.iron],   // rear
    [transformGeo(G.box(18, 140, HL), T(HB / 2 - 9, -25, 0)), MAT.iron],
    [transformGeo(G.box(18, 140, HL), T(-HB / 2 + 9, -25, 0)), MAT.iron],
  ], { category: CAT_BODY, shell: true, explode: [0, -35, 0],
       func: '包围并支承曲轴的下半部箱体，构成曲柄旋转的密闭空间。',
       rel: '连接缸体与油底壳，内部安装曲轴主轴承。' });

  // 油底壳
  body('油底壳', [
    [transformGeo(G.box(HB, 8, HL), T(0, panBottomY + 4, 0)), MAT.iron],                                   // bottom
    [transformGeo(G.box(HB, 55, 10), T(0, (crankBottomY + panBottomY) / 2, HL / 2 - 5)), MAT.iron],         // front
    [transformGeo(G.box(HB, 55, 10), T(0, (crankBottomY + panBottomY) / 2, -HL / 2 + 5)), MAT.iron],        // rear
    [transformGeo(G.box(10, 55, HL), T(HB / 2 - 5, (crankBottomY + panBottomY) / 2, 0)), MAT.iron],
    [transformGeo(G.box(10, 55, HL), T(-HB / 2 + 5, (crankBottomY + panBottomY) / 2, 0)), MAT.iron],
  ], { category: CAT_BODY, shell: true, explode: [0, -130, 0],
       func: '储存机油，收集回落的润滑油并含有集滤器。',
       rel: '通过螺栓固定在曲轴箱下方。' });

  // 气缸盖罩
  body('气缸盖罩', [
    [transformGeo(G.box(220, 8, 500), T(0, coverTopY - 4, 0)), MAT.aluminum],
    [transformGeo(G.box(220, 45, 8), T(0, (headTopY + coverTopY) / 2, 246)), MAT.aluminum],
    [transformGeo(G.box(220, 45, 8), T(0, (headTopY + coverTopY) / 2, -246)), MAT.aluminum],
    [transformGeo(G.box(8, 45, 500), T(106, (headTopY + coverTopY) / 2, 0)), MAT.aluminum],
    [transformGeo(G.box(8, 45, 500), T(-106, (headTopY + coverTopY) / 2, 0)), MAT.aluminum],
  ], { category: CAT_BODY, shell: true, explode: [0, 170, 0],
       func: '封闭配气机构，防止机油外漏并隔音。',
       rel: '安装在气缸盖顶部，罩住凸轮轴、摇臂与气门机构。' });

  // 进气歧管（稳压腔 + 4 根歧管）
  const intakeMan = body('进气歧管', [
    [transformGeo(G.box(70, 60, 240), T(185, 265, 0)), MAT.aluminum],  // plenum
  ], { category: CAT_BODY, shell: true, explode: [150, 40, 0],
       func: '将空气/燃油混合气均匀分配到各气缸。',
       rel: '通过节气门与进气道相连，连接各缸进气门。' });
  cylZ.forEach((z, i) => {
    const run = [[180, 280, z], [140, 300, z], [128, 300, z + 17]];
    intakeMan.addMesh(transformGeo(G.tubeAlongPath(run, 12, 16), mat4Identity()), MAT.aluminum);
  });

  // 排气歧管（4 合 1）
  const exhMan = body('排气歧管', [
    [transformGeo(G.tubeAlongPath([[-120, 280, 0], [-170, 220, 0], [-170, 170, 0]], 16, 16), mat4Identity()), MAT.exhaust],
  ], { category: CAT_BODY, shell: true, explode: [-150, 40, 0],
       func: '汇集各缸排出的高温废气并导向排气管。',
       rel: '连接各缸排气门与三元催化器/排气管。' });
  cylZ.forEach((z, i) => {
    const run = [[-128, 300, z - 17], [-140, 280, z], [-150, 260, z]];
    exhMan.addMesh(transformGeo(G.tubeAlongPath(run, 11, 16), mat4Identity()), MAT.exhaust);
  });

  // 节气门
  body('节气门', [
    [transformGeo(G.tube(22, 26, 20, 24), T(185, 265, 150)), MAT.steel],
    [transformGeo(G.box(50, 3, 4), T(185, 265, 150)), MAT.steel],  // butterfly plate
  ], { category: CAT_BODY, shell: true, explode: [180, 60, 120],
       func: '控制进入发动机的空气量，从而调节发动机输出功率。',
       rel: '安装在进气歧管入口，连接空气滤清器与进气歧管。' });

  // 空气滤清器
  body('空气滤清器', [
    [transformGeo(G.box(90, 50, 70), T(200, 320, 120)), MAT.plastic],
    [transformGeo(G.tubeAlongPath([[200, 300, 120], [185, 280, 150]], 12, 14), mat4Identity()), MAT.rubber],
  ], { category: CAT_BODY, shell: true, explode: [150, 120, 60],
       func: '过滤进入发动机的空气，防止灰尘磨损气缸。',
       rel: '位于进气道最前端，通过软管连接节气门。' });

  // ===== 曲柄连杆机构 =====
  const CAT_CRANK = '曲柄连杆机构';

  // 曲轴（整体旋转）
  const crank = P('曲轴', { category: CAT_CRANK, explode: [0, -80, 0],
    func: '将活塞的往复运动转换为旋转运动，输出动力。',
    rel: '通过连杆与活塞相连，由主轴承支承，前端驱动正时与附件，后端连接飞轮。',
    update: (st) => { crank.local = RZ(-st.crankDeg * DEG); } });

  // 主轴颈 x5
  for (let i = 0; i < 5; i++) {
    const z = 200 - i * 100;
    child(crank, `主轴颈${i + 1}`, { category: CAT_CRANK,
      func: '曲轴支承在曲轴箱主轴承上的轴颈。', rel: '与主轴承（轴瓦）配合，承受曲轴径向载荷。' })
      .addMesh(transformGeo(G.cylinder(30, 30, 26, 26), T(0, 0, z)), MAT.steel);
  }
  // 曲柄销 + 曲柄臂（连杆轴颈）+ 配重
  const throws = [0, 180, 180, 0];
  cylZ.forEach((z, i) => {
    const th = throws[i] * DEG;
    const px = r * Math.sin(th), py = r * Math.cos(th);
    // crank pin
    crank.addMesh(transformGeo(G.cylinder(24, 24, 26, 24), T(px, py, z)), MAT.steel);
    // webs (front + rear of each pin) + counterweights
    for (const dz of [-16, 16]) {
      const wz = z + dz;
      crank.addMesh(transformGeo(G.cylinder(46, 46, 14, 30), T(0, 0, wz)), MAT.steel);
      // counterweight opposite the pin
      const cwx = -px / r, cwy = -py / r;
      crank.addMesh(transformGeo(G.box(64, 58, 14), T(cwx * 34, cwy * 34, wz)), MAT.steelDark);
    }
  });
  // front snout + rear flange
  crank.addMesh(transformGeo(G.cylinder(16, 16, 40, 20), T(0, 0, 245)), MAT.steel);
  crank.addMesh(transformGeo(G.cylinder(38, 38, 14, 24), T(0, 0, -222)), MAT.steel);
  // 飞轮
  const flywheel = child(crank, '飞轮', { category: CAT_CRANK,
    func: '储存旋转动能，使曲轴运转平稳，并通过齿圈连接起动机。',
    rel: '用螺栓固定在曲轴后端，输出动力到离合器/变速箱。' });
  flywheel.addMesh(transformGeo(G.cylinder(115, 115, 20, 40), T(0, 0, -240)), MAT.steelDark);
  flywheel.addMesh(transformGeo(G.cylinder(30, 30, 30, 24), T(0, 0, -240)), MAT.steel);
  // 曲轴正时链轮
  const crankSprocket = child(crank, '曲轴正时链轮', { category: CAT_CRANK,
    func: '驱动正时链条，与凸轮轴链轮保持 2:1 的速比。', rel: '安装在曲轴前端，齿数为凸轮轴链轮的一半。' });
  crankSprocket.addMesh(transformGeo(G.cylinder(23, 23, 12, 30), T(0, 0, 228)), MAT.steelDark);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    crankSprocket.addMesh(transformGeo(G.box(6, 7, 12), T(23 * Math.cos(a), 23 * Math.sin(a), 228)), MAT.steel);
  }

  // 连杆 x4
  const rodParts = cylZ.map((z, i) => {
    const rod = P(`连杆${i + 1}`, { category: CAT_CRANK, explode: [0, 25, 0],
      func: '连接活塞与曲轴，将活塞的往复运动转换为曲轴的旋转运动，反之亦然。',
      rel: '大头连接曲柄销，小头通过活塞销连接活塞。',
      update: (st) => {
        const c = st.cyl[i];
        rod.local = T(c.pinX, c.pinY, z);
        rod.local = matMulLocal(rod.local, RZ(-c.rodAngleDeg * DEG));
      } });
    rod.addMesh(transformGeo(G.box(16, L - 44, 10), T(0, 30 + (L - 44) / 2, 0)), MAT.steel);
    child(rod, `连杆大头${i + 1}`, { category: CAT_CRANK, func: '连杆连接曲柄销的轴承端。', rel: '套装在曲柄销上，与连杆盖配合。' })
      .addMesh(transformGeo(G.tube(25, 31, 26, 26), T(0, 0, 0)), MAT.steelDark);
    child(rod, `连杆小头${i + 1}`, { category: CAT_CRANK, func: '连杆连接活塞销的衬套端。', rel: '通过活塞销与活塞相连。' })
      .addMesh(transformGeo(G.tube(11, 14, 22, 22), T(0, L, 0)), MAT.brass);
    return rod;
  });

  // 活塞 x4
  const pistonParts = cylZ.map((z, i) => {
    const piston = P(`活塞${i + 1}`, { category: CAT_CRANK, explode: [0, 45, 0],
      func: '承受燃气压力并通过连杆传给曲轴；其往复运动构成四冲程循环。',
      rel: '在气缸内滑动，通过活塞销与连杆小头相连。',
      update: (st) => { piston.local = T(0, st.cyl[i].pistonY, z); } });

    // 活塞冠（含环槽）
    const crown = child(piston, `活塞冠${i + 1}`, { category: CAT_CRANK,
      func: '活塞顶部，直接承受高温高压燃气，加工有活塞环槽。', rel: '与气缸、缸盖共同构成燃烧室。' });
    crown.addMesh(transformGeo(G.lathe([
      [2, 42.5], [3.5, 40.4], [6, 40.4], [7.5, 42.5],
      [9, 42.5], [10.5, 40.4], [13, 40.4], [14.5, 42.5],
      [16, 42.5], [17.5, 40.4], [20, 40.4], [21.5, 42.5],
      [26, 42.0], [28, 41.0], [30, 40.0],
    ], 40, { capTop: true, capBottom: false }), mat4Identity()), MAT.aluminum);

    // 活塞裙
    child(piston, `活塞裙${i + 1}`, { category: CAT_CRANK,
      func: '活塞下部导向部分，保持活塞在气缸内的姿态并承受侧向力。', rel: '与气缸壁滑动接触。' })
      .addMesh(transformGeo(G.tube(40, 42.5, 38, 36), T(0, -19, 0)), MAT.aluminum);

    // 活塞环 x3
    const ringPart = child(piston, `活塞环${i + 1}`, { category: CAT_CRANK,
      func: '密封活塞与气缸壁之间的间隙，刮除缸壁多余机油并传热。', rel: '装在活塞环槽内，紧贴气缸壁。' });
    for (const gy of [4.75, 11.75, 18.75]) {
      ringPart.addMesh(transformGeo(G.tube(41.5, 43, 2.4, 36), T(0, gy, 0)), MAT.steelDark);
    }

    // 活塞销
    child(piston, `活塞销${i + 1}`, { category: CAT_CRANK,
      func: '连接活塞与连杆小头的销轴，传递作用力。', rel: '穿过活塞销孔与连杆小头衬套。' })
      .addMesh(transformGeo(G.cylinder(11, 11, 52, 20), RZ(Math.PI / 2)), MAT.steel);
    return piston;
  });

  // ===== 配气机构 =====
  const CAT_VALVE = '配气机构';

  // 凸轮轴（SOHC，单轴，8 凸轮）
  const cam = P('凸轮轴', { category: CAT_VALVE, explode: [0, 120, 0],
    func: '通过凸轮廓线按时开启/关闭气门，控制进排气。转速为曲轴的一半。',
    rel: '由正时链条驱动，凸轮推动摇臂，摇臂驱动气门。',
    update: (st) => { cam.local = matMulLocal(T(0, camAxisY, 0), RZ(-st.camDeg * DEG)); } });
  cam.addMesh(transformGeo(G.cylinder(12, 12, 470, 22), mat4Identity()), MAT.steel);
  for (const zj of [-160, 0, 160]) {
    cam.addMesh(transformGeo(G.cylinder(15, 15, 16, 22), T(0, 0, zj)), MAT.steelDark);
  }
  // 凸轮 x8
  for (let i = 0; i < 4; i++) {
    for (const which of ['intake', 'exhaust']) {
      const zLobe = cylZ[i] + (which === 'intake' ? 17 : -17);
      const gammaOpen = valveOpenCamDeg(i, which);
      const noseLocal = 180 + gammaOpen;
      const lobe = child(cam, `凸轮(${i + 1}缸${which === 'intake' ? '进' : '排'})`, { category: CAT_VALVE,
        func: `控制第${i + 1}缸${which === 'intake' ? '进气' : '排气'}门的开闭时刻与升程。`,
        rel: `随凸轮轴旋转，推动第${i + 1}缸的摇臂。` });
      lobe.addMesh(transformGeo(G.extrudePolar(
        (t) => camLobeRadius(deg(t) - noseLocal), 44, 12), T(0, 0, zLobe)), MAT.steelDark);
    }
  }
  // 凸轮轴链轮
  const camSprocket = child(cam, '凸轮轴链轮', { category: CAT_VALVE,
    func: '由正时链条驱动，保证凸轮轴与曲轴的相位关系。', rel: '齿数为曲轴链轮的 2 倍，实现 2:1 减速。' });
  camSprocket.addMesh(transformGeo(G.cylinder(46, 46, 12, 36), T(0, 0, 228)), MAT.steelDark);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    camSprocket.addMesh(transformGeo(G.box(6, 7, 12), T(46 * Math.cos(a), 46 * Math.sin(a), 228)), MAT.steel);
  }

  // 摇臂轴 + 摇臂 x8
  const rockerShaft = body('摇臂轴', [
    [transformGeo(G.cylinder(7, 7, 360, 18), T(0, rockerShaftY, 0)), MAT.steel],
  ], { category: CAT_VALVE, explode: [0, 105, 0], func: '支承摇臂的固定轴。', rel: '安装在气缸盖上，摇臂绕其摆动。' });

  const rockerParts = [];
  for (let i = 0; i < 4; i++) {
    for (const which of ['intake', 'exhaust']) {
      const vz = cylZ[i] + (which === 'intake' ? 17 : -17);
      const rocker = P(`摇臂(${i + 1}缸${which === 'intake' ? '进' : '排'})`, { category: CAT_VALVE, explode: [0, 105, 0],
        func: `将凸轮的下压力传递给第${i + 1}缸${which === 'intake' ? '进气' : '排气'}门，使其开启。`,
        rel: `绕摇臂轴摆动，一端受凸轮驱动，另一端压开${which === 'intake' ? '进气' : '排气'}门。`,
        update: (st) => {
          const lift = which === 'intake' ? st.cyl[i].intakeLift : st.cyl[i].exhaustLift;
          rocker.local = matMulLocal(T(0, rockerShaftY, vz + armLen), RX(-Math.asin(lift / armLen)));
        } });
      rocker.addMesh(transformGeo(G.box(8, 8, armLen), T(0, 0, -armLen / 2)), MAT.steel);
      rocker.addMesh(transformGeo(G.cylinder(9, 9, 12, 18), RZ(Math.PI / 2)), MAT.steel);          // pivot boss
      rocker.addMesh(transformGeo(G.box(12, 5, 14), T(0, 1.5, -armLen + 7)), MAT.steelDark);        // cam pad
      rockerParts.push(rocker);
    }
  }

  // 气门 x8（4 进 + 4 排）
  const valveParts = [];
  for (let i = 0; i < 4; i++) {
    for (const which of ['intake', 'exhaust']) {
      const vz = cylZ[i] + (which === 'intake' ? 17 : -17);
      const vHeadR = which === 'intake' ? 17 : 15;
      const valve = P(`${which === 'intake' ? '进气门' : '排气门'}${i + 1}`, { category: CAT_VALVE, explode: [0, 95, 0],
        func: `控制第${i + 1}缸${which === 'intake' ? '进气' : '排气'}道的开启与关闭。`,
        rel: `由${which === 'intake' ? '进气' : '排气'}凸轮经摇臂驱动，气门弹簧使其回位。`,
        update: (st) => {
          const lift = which === 'intake' ? st.cyl[i].intakeLift : st.cyl[i].exhaustLift;
          valve.local = T(0, valveSeatY - lift, vz);
        } });
      valve.addMesh(transformGeo(G.lathe([
        [0, 0], [vHeadR, 4], [vHeadR, 8], [4, 12], [3, stemLen],
      ], 32, { capTop: false, capBottom: true }), mat4Identity()), which === 'intake' ? MAT.steel : MAT.exhaust);
      // 气门弹簧锁片/弹簧座（固定在杆上端）
      valve.addMesh(transformGeo(G.cylinder(10, 10, 4, 20), T(0, stemLen - 8, 0)), MAT.steelDark);
      valveParts.push(valve);
    }
  }

  // 气门弹簧 x8
  for (let i = 0; i < 4; i++) {
    for (const which of ['intake', 'exhaust']) {
      const vz = cylZ[i] + (which === 'intake' ? 17 : -17);
      const spring = P(`气门弹簧(${i + 1}缸${which === 'intake' ? '进' : '排'})`, { category: CAT_VALVE, explode: [0, 95, 0],
        func: '在凸轮释放气门后使气门迅速回位关闭并保持密封。',
        rel: '套在气门杆上，一端压在缸盖弹簧座上，一端顶住弹簧座。',
        update: (st) => {
          const lift = which === 'intake' ? st.cyl[i].intakeLift : st.cyl[i].exhaustLift;
          spring.local = matMulLocal(T(0, springSeatY, vz), mat4Scale(1, 1 - lift / springH, 1));
        } });
      spring.addMesh(transformGeo(G.helix(springH, 5.5, 10, 2, 10, 28), mat4Identity()), MAT.steel);
    }
  }

  // 正时链条 + 导轨
  const crankR = 23, camR = 46, chainZ = 228;
  const path = beltPath([0, 0], crankR, [0, camAxisY], camR, 22, 12);
  const chain = P('正时链条', { category: CAT_VALVE, explode: [0, 0, 130],
    func: '将曲轴的旋转按 2:1 速比传递给凸轮轴，保证配气相位。',
    rel: '环绕曲轴正时链轮与凸轮轴链轮，由导轨与张紧器导向。',
    update: (st) => {
      const n = chain.links.length;
      const spacing = path.total / n;
      const off = crankR * st.crankDeg * DEG;
      for (let k = 0; k < n; k++) {
        const s = k * spacing + off;
        const pt = pathPointAt(path, s);
        const link = chain.links[k];
        link.local = matMulLocal(T(pt.x, pt.y, chainZ), RZ(pt.ang));
      }
    } });
  chain.links = [];
  {
    const nLinks = Math.round(path.total / 13);
    for (let k = 0; k < nLinks; k++) {
      const link = child(chain, `链条节${k + 1}`, { category: CAT_VALVE, func: '正时链条的链节。', rel: '相互串联构成正时链条。' });
      link.addMesh(transformGeo(G.box(12, 5, 9), mat4Identity()), MAT.steelDark);
      chain.links.push(link);
    }
  }
  // 导轨
  body('正时链条导轨', [
    [transformGeo(G.box(8, 150, 10), T(-20, (camAxisY / 2), chainZ)), MAT.plastic],
    [transformGeo(G.box(8, 150, 10), T(20, (camAxisY / 2), chainZ)), MAT.plastic],
  ], { category: CAT_VALVE, explode: [0, 0, 120], func: '引导并张紧正时链条，防止跳动。', rel: '安装在链条松边与张紧器一侧。' });

  // ===== 燃油与点火系统 =====
  const CAT_FUEL = '燃油与点火系统';

  // 燃烧室 x4
  for (let i = 0; i < 4; i++) {
    const z = cylZ[i];
    body(`燃烧室${i + 1}`, [
      [transformGeo(G.lathe([[0, 0], [40, 3], [40, 6]], 40, { capTop: true, capBottom: true }), T(0, 216, z)),
        { color: [0.12, 0.13, 0.15], spec: 0.25, shininess: 22, opacity: 0.45 }],
    ], { category: CAT_FUEL, explode: [0, 55, 0], transparent: true,
         func: '活塞顶部与气缸盖之间的空间，燃油在此与空气混合并被点燃燃烧。',
         rel: '由缸盖、缸垫、气缸壁与活塞顶共同围成。' });
  }

  // 火花塞 x4
  for (let i = 0; i < 4; i++) {
    const z = cylZ[i];
    const plug = P(`火花塞${i + 1}`, { category: CAT_FUEL, explode: [0, 70, 0],
      func: '在压缩冲程末产生电火花，点燃混合气。',
      rel: '安装在气缸盖上，电极伸入燃烧室，由点火线圈供电。' });
    plug.addMesh(transformGeo(G.lathe([
      [0, 0], [2, 6], [2, 12], [8, 16], [8, 26], [6, 30],
    ], 20, { capTop: false, capBottom: true }), T(0, 224, z)), MAT.steel);
    plug.addMesh(transformGeo(G.lathe([
      [5, 30], [5, 80], [3, 90], [1.5, 96],
    ], 20, { capTop: true, capBottom: false }), T(0, 224, z)), MAT.ceramic);
  }

  // 喷油器 x4
  for (let i = 0; i < 4; i++) {
    const z = cylZ[i] + 17;
    body(`喷油器${i + 1}`, [
      [transformGeo(G.cylinder(8, 8, 40, 18), T(60, 300, z)), MAT.plastic],
      [transformGeo(G.cylinder(4, 6, 10, 16), T(60, 272, z)), MAT.steel],
    ], { category: CAT_FUEL, explode: [130, 60, 0],
         func: '将燃油以雾状喷入进气道，与空气混合后进入气缸。',
         rel: '安装在进气歧管/缸盖进气道处，朝向进气门。' });
  }

  // ===== 冷却与润滑系统 =====
  const CAT_LUBE = '冷却与润滑系统';

  // 水泵
  const waterPump = body('水泵', [
    [transformGeo(G.box(40, 40, 34), T(95, 45, 230)), MAT.steel],
    [transformGeo(G.cylinder(30, 30, 10, 24), T(130, 45, 230)), MAT.steelDark],   // pulley
    [transformGeo(G.tubeAlongPath([[95, 20, 230], [95, -10, 230]], 10, 14), mat4Identity()), MAT.steel], // inlet
  ], { category: CAT_LUBE, shell: true, explode: [90, 30, 120],
       func: '强制循环冷却液，带走发动机热量。', rel: '由曲轴皮带驱动，连接散热器与缸体水道。' });

  // 冷却液通道（水套示意）
  const coolant = body('冷却液通道', [], { category: CAT_LUBE, transparent: true,
    func: '冷却液在缸体与缸盖内的流通通道，吸收燃烧室附近的热量。', rel: '环绕气缸套与燃烧室，连接水泵与散热器。' });
  const coolGeo = G.tubeAlongPath([[0, 60, 200], [0, 150, 200], [0, 150, -200], [0, 60, -200]], 8, 12);
  coolant.addMesh(transformGeo(coolGeo, mat4Identity()), { color: [0.2, 0.5, 0.9], spec: 0.4, shininess: 40, opacity: 0.5 });
  coolant.addMesh(transformGeo(coolGeo, T(0, 60, 0)), { color: [0.2, 0.5, 0.9], spec: 0.4, shininess: 40, opacity: 0.5 });

  // 机油泵
  body('机油泵', [
    [transformGeo(G.box(44, 30, 30), T(0, -60, 170)), MAT.steel],
    [transformGeo(G.cylinder(16, 16, 14, 20), T(0, -60, 158)), MAT.steelDark],
    [transformGeo(G.tubeAlongPath([[0, -80, 170], [0, -110, 170]], 9, 12), mat4Identity()), MAT.steel],
  ], { category: CAT_LUBE, shell: true, explode: [100, -70, 60],
       func: '将机油加压输送到各摩擦副，形成润滑油膜。', rel: '由曲轴直接驱动，从油底壳经集滤器吸油。' });

  // 机油滤清器
  body('机油滤清器', [
    [transformGeo(G.cylinder(30, 30, 60, 24), T(95, 15, -80)), MAT.red],
    [transformGeo(G.cylinder(26, 26, 8, 24), T(95, 45, -80)), MAT.steel],
  ], { category: CAT_LUBE, shell: true, explode: [110, -20, 0],
       func: '过滤机油中的杂质，保护运动件。', rel: '安装在缸体上，位于机油泵之后的主油道中。' });

  // 机油通道
  const oil = body('机油通道', [], { category: CAT_LUBE, transparent: true,
    func: '机油在发动机内的输送通道，把润滑油送到曲轴、连杆与气门机构。', rel: '从机油泵出发，经主油道分配到各轴承。' });
  const oilGeo = G.tubeAlongPath([[0, -40, 160], [0, -40, -160], [0, 60, -160], [0, 200, -160]], 6, 12);
  oil.addMesh(transformGeo(oilGeo, mat4Identity()), { color: [0.72, 0.60, 0.30], spec: 0.5, shininess: 50, opacity: 0.5 });

  // ===== 工作循环可视化（气体 + 火焰）=====
  const gasParts = [], flameParts = [];
  for (let i = 0; i < 4; i++) {
    const z = cylZ[i];
    const gasMat = { color: [0.5, 0.6, 1.0], emissive: [0, 0, 0], spec: 0.1, shininess: 10, opacity: 0.25 };
    const gas = P(`缸内工质${i + 1}`, { category: '工作循环', pickable: false, transparent: true,
      update: (st) => {
        const c = st.cyl[i];
        const crownY = c.pistonY + compH;
        const h = Math.max(1, deckY - crownY);
        gas.local = matMulLocal(T(0, crownY, z), mat4Scale(1, h, 1));
        const col = STROKE_COLORS[c.stroke];
        gasMat.color[0] = col[0]; gasMat.color[1] = col[1]; gasMat.color[2] = col[2];
        gasMat.opacity = (c.stroke === 'power' ? 0.5 : 0.26);
        gasMat.emissive[0] = c.stroke === 'power' ? 0.5 : 0;
        gasMat.emissive[1] = c.stroke === 'power' ? 0.12 : 0;
        gasMat.emissive[2] = 0;
      } });
    gas.addMesh(transformGeo(G.cylinder(40, 40, 1, 24), T(0, 0.5, 0)), gasMat);
    gasParts.push(gas);

    const flameMat = { color: [1, 0.55, 0.1], emissive: [1, 0.4, 0.05], spec: 0.1, shininess: 10, opacity: 0 };
    const flame = P(`点火火焰${i + 1}`, { category: '工作循环', pickable: false, transparent: true,
      update: (st) => {
        const c = st.cyl[i];
        const ca = c.cycleAngle;
        let o = 0;
        if (c.stroke === 'power') o = Math.max(0, 1 - ca / 120);
        flameMat.opacity = o;
      } });
    flame.addMesh(transformGeo(G.lathe([[0, 0], [24, 10], [20, 16], [0, 22]], 24, { capTop: true, capBottom: true }), T(0, 220, z)), flameMat);
    flameParts.push(flame);
  }

  // 气缸发光光柱（科技能量轨迹）
  for (let i = 0; i < 4; i++) {
    const z = cylZ[i];
    const beam = P(`气缸光柱${i + 1}`, { category: '', pickable: false, transparent: true,
      func: '气缸轴线发光光柱，指示活塞运动轨迹。', rel: '沿气缸轴线从曲轴延伸至缸盖。' });
    beam.addMesh(transformGeo(G.cylinder(2.5, 2.5, deckY, 16), T(0, deckY / 2, z)),
      { color: [0.0, 0.12, 0.30], spec: 0.2, shininess: 10, opacity: 0.32, emissive: [0.05, 0.28, 0.70] });
  }

  assignLayersAndMotion(parts, roots);

  return { roots, parts, byId, dynamicParts: parts.filter((p) => p.update), chain, gasParts, flameParts };
}

function matMulLocal(a, b) {
  // small helper to compose matrices
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const c4 = c * 4;
    const b0 = b[c4], b1 = b[c4 + 1], b2 = b[c4 + 2], b3 = b[c4 + 3];
    o[c4]     = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}

// ---------------- kinematics state ----------------
export function computeState(crankDeg) {
  const cyl = [];
  for (let i = 0; i < 4; i++) {
    const k = pistonKinematics(crankDeg, PIN_OFFSET[i]);
    cyl.push({
      pistonY: k.pistonY, pinX: k.pinX, pinY: k.pinY, rodAngleDeg: k.rodAngleDeg,
      intakeLift: valveLift(crankDeg, i, 'intake'),
      exhaustLift: valveLift(crankDeg, i, 'exhaust'),
      stroke: strokeKey(i, crankDeg),
      strokeIdx: strokeIndex(i, crankDeg),
      cycleAngle: cycleAngleOf(i, crankDeg),
      firing: isFiring(i, crankDeg),
    });
  }
  return { crankDeg, camDeg: crankDeg / 2, cyl };
}

export function animate(engine, state) {
  for (const p of engine.dynamicParts) if (p.update) p.update(state);
}

export { FIRE_ORDER, STROKE_NAMES, STROKE_COLORS };
