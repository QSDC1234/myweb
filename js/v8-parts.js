// v8-parts.js — 90° cross-plane V8 engine: kinematics + geometry + build (independent module).
// Reuses the shared renderer/geometry/material/explosion infrastructure from parts.js.

import {
  mat4Identity, mat4Translation, mat4RotZ, mat4Scale, mat4MulAll, DEG, deg,
} from './math3d.js';
import * as G from './geometry.js';
import { bumpShape, camLobeRadius, STROKE_KEYS, STROKE_NAMES, STROKE_COLORS, wrap360, wrap720 } from './kinematics.js';
import { Part, MAT, transformGeo, beltPath, pathPointAt, assignLayersAndMotion, LAYER_INFO } from './parts.js';

const T = mat4Translation;

export const V8_INFO = {
  id: 'v8',
  name: 'V8',
  title: 'V8 四冲程汽油发动机',
  cylinders: 8,
  layout: '90° V型',
  cycle: '四冲程',
  fireOrder: [1, 8, 4, 3, 6, 5, 7, 2],
  fireOrderText: '1-8-4-3-6-5-7-2',
};

const V8 = {
  bore: 90, stroke: 84, crankRadius: 42, rodLength: 140,
  boreSpacing: 104,
  bankTilt: 45,            // each bank ±45° from vertical
  compH: 30,               // pin -> crown along bank axis
  deckDist: 216,           // deck (head gasket surface) along bank axis from crank centre
  camDist: 348,            // camshaft axis along bank axis from crank centre
  stemLen: 116,            // valve stem length along bank axis
  springSeatDist: 246,     // valve spring seat along bank axis
  valveLiftMax: 8, camBaseRadius: 14, camHalfAngle: 60,
  intakeCenter: 470, exhaustCenter: 250, valveDuration: 240,
  rodZOffset: 11,          // side-by-side rod spacing on a shared pin
};

// 4 shared crank pins, front -> rear (Z), throws at 90° intervals (cross-plane).
const PIN_Z = [156, 52, -52, -156];
const PIN_THROW = [45, 135, 315, 225];
const MAIN_Z = [208, 104, 0, -104, -208];

// per-cylinder (0..7 = cylinder #1..#8)
const CYL_Z = [];
for (let k = 0; k < 4; k++) CYL_Z.push(PIN_Z[k], PIN_Z[k]);
const BANK_TILT = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i % 2 === 0 ? 45 : -45));
const PIN_THROW_OF = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => PIN_THROW[i >> 1]);
const FIRE_PHASE = [0, 630, 270, 180, 450, 360, 540, 90];

function axisX(s, beta) { return s * Math.sin(beta * DEG); }
function axisY(s, beta) { return s * Math.cos(beta * DEG); }

function valveLiftV8(crankDeg, cylIdx, which) {
  const camDeg = crankDeg / 2;
  const center = which === 'intake' ? V8.intakeCenter : V8.exhaustCenter;
  const gammaOpen = wrap360((FIRE_PHASE[cylIdx] + center) / 2);
  return V8.valveLiftMax * bumpShape(camDeg - gammaOpen);
}

export function computeV8State(crankDeg) {
  const cyl = [];
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i];
    const phi = PIN_THROW_OF[i];
    const betaR = beta * DEG;
    const theta = (crankDeg + phi) * DEG;
    const r = V8.crankRadius, L = V8.rodLength;
    const pinX = r * Math.sin(theta);
    const pinY = r * Math.cos(theta);
    const rel = theta - betaR;
    const s = r * Math.cos(rel) + Math.sqrt(Math.max(L * L - r * r * Math.sin(rel) * Math.sin(rel), 0));
    const pistonX = s * Math.sin(betaR);
    const pistonY = s * Math.cos(betaR);
    const rodAngleDeg = Math.atan2(pistonX - pinX, pistonY - pinY) / DEG;
    const ca = wrap720(crankDeg - FIRE_PHASE[i]);
    const strokeIdx = ca < 180 ? 0 : ca < 360 ? 1 : ca < 540 ? 2 : 3;
    cyl.push({
      pistonX, pistonY, pistonDist: s, pinX, pinY, rodAngleDeg, bankTiltDeg: beta,
      intakeLift: valveLiftV8(crankDeg, i, 'intake'),
      exhaustLift: valveLiftV8(crankDeg, i, 'exhaust'),
      stroke: STROKE_KEYS[strokeIdx], strokeIdx, cycleAngle: ca, firing: ca >= 0 && ca < 25,
    });
  }
  return { crankDeg, camDeg: crankDeg / 2, cyl };
}

// layer/explode vectors specific to the V layout
const V8_LAYER_DEFS = [
  { layer: 1, re: /^气缸盖罩/, explode: [0, 250, 0] },
  { layer: 1, re: /^进气歧管/, explode: [0, 90, 0] },
  { layer: 1, re: /^排气歧管/, explode: [0, 60, 0] },
  { layer: 1, re: /^节气门$/, explode: [0, 130, 90] },
  { layer: 1, re: /^空气滤清器$/, explode: [0, 180, 60] },
  { layer: 2, re: /^凸轮轴/, explode: [0, 200, 0] },
  { layer: 2, re: /^进气门/, explode: [0, 165, 0] },
  { layer: 2, re: /^排气门/, explode: [0, 165, 0] },
  { layer: 2, re: /^气门弹簧/, explode: [0, 165, 0] },
  { layer: 2, re: /^正时链条/, explode: [0, 0, 150] },
  { layer: 2, re: /^正时链条导轨/, explode: [0, 0, 140] },
  { layer: 3, re: /^气缸盖/, explode: [0, 135, 0] },
  { layer: 3, re: /^燃烧室/, explode: [0, 130, 0] },
  { layer: 3, re: /^火花塞/, explode: [0, 150, 0] },
  { layer: 3, re: /^喷油器/, explode: [0, 130, 0] },
  { layer: 4, re: /^活塞/, explode: [0, 80, 0] },
  { layer: 4, re: /^连杆/, explode: [0, 48, 0] },
  { layer: 4, re: /^缸内工质/, explode: [0, 80, 0] },
  { layer: 4, re: /^点火火焰/, explode: [0, 80, 0] },
  { layer: 5, re: /^缸体$/, explode: [0, -35, 0] },
  { layer: 5, re: /^气缸[1-8]$/, explode: [0, -35, 0] },
  { layer: 5, re: /^曲轴箱$/, explode: [0, -35, 0] },
  { layer: 5, re: /^冷却液通道/, explode: [0, -35, 0] },
  { layer: 6, re: /^曲轴$/, explode: [0, -170, 0] },
  { layer: 7, re: /^油底壳$/, explode: [0, -290, 0] },
  { layer: 7, re: /^机油泵$/, explode: [110, -250, 60] },
  { layer: 7, re: /^机油滤清器$/, explode: [120, -190, 0] },
  { layer: 7, re: /^机油通道/, explode: [0, -250, 0] },
];

const V8_MOTION_DEFS = [
  { re: /^曲轴$/, m: '绕自身轴线匀速旋转（转速 = 设定 RPM）' },
  { re: /^主轴颈/, m: '随曲轴整体旋转' },
  { re: /^飞轮/, m: '随曲轴整体旋转' },
  { re: /^活塞/, m: '沿本排气缸轴线往复运动（曲轴经连杆驱动，两排相位差 90°）' },
  { re: /^连杆/, m: '大头绕曲柄销旋转，小头随活塞往复摆动' },
  { re: /^凸轮轴/, m: '以曲轴 1/2 转速旋转' },
  { re: /^凸轮\(/, m: '随凸轮轴旋转，轮廓决定气门升程' },
  { re: /^进气门/, m: '沿本排气缸轴线往复开闭' },
  { re: /^排气门/, m: '沿本排气缸轴线往复开闭' },
  { re: /^气门弹簧/, m: '随气门开闭被压缩 / 回弹' },
  { re: /^正时链条/, m: '沿正时链轮路径循环运转' },
  { re: /^缸内工质/, m: '随活塞位置改变体积，颜色随冲程变化' },
  { re: /^点火火焰/, m: '做功冲程初期短暂出现并熄灭' },
];

export function buildV8Engine() {
  const roots = [];
  const parts = [];
  const byId = new Map();
  let nextId = 1;

  const P = (name, opts = {}) => {
    const p = new Part('v' + (nextId++), name, opts);
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
  // build a bank-tilted mesh: geometry built vertically, then tilted by beta, centred at dist along axis
  const bank = (geo, beta, dist, z) =>
    transformGeo(geo, mat4MulAll(mat4Translation(0, 0, z), mat4RotZ(beta * DEG), mat4Translation(0, dist, 0)));

  const CAT_BODY = '发动机主体', CAT_CRANK = '曲柄连杆机构', CAT_VALVE = '配气机构',
        CAT_FUEL = '燃油与点火系统', CAT_LUBE = '冷却与润滑系统';

  const deckDist = V8.deckDist, camDist = V8.camDist, stemLen = V8.stemLen;
  const springSeat = V8.springSeatDist, springH = (camDist - 14) - 8 - springSeat;

  // ===== 发动机主体 =====
  // 曲轴箱（含曲轴的 V 形箱体下部）
  body('曲轴箱', [
    [transformGeo(G.box(170, 140, 22), T(0, -25, 290)), MAT.iron],
    [transformGeo(G.box(170, 140, 22), T(0, -25, -290)), MAT.iron],
    [transformGeo(G.box(22, 140, 580), T(84, -25, 0)), MAT.iron],
    [transformGeo(G.box(22, 140, 580), T(-84, -25, 0)), MAT.iron],
  ], { category: CAT_BODY, shell: true, func: '包围并支承曲轴的下部箱体。', rel: '连接缸体与油底壳，内部安装曲轴主轴承。' });

  // 缸体：V 形两块倾斜的缸体顶面（deck）
  const block = body('缸体', [], { category: CAT_BODY, shell: true,
    func: 'V 形缸体的基础铸件，两排气缸各成 45°，中间为 V 形夹角（曲轴箱）。',
    rel: '上方安装两排气缸盖，内部压装气缸套，下方连接曲轴箱。' });
  for (const beta of [45, -45]) {
    block.addMesh(bank(G.box(120, 22, 430), beta, deckDist + 11, 0), MAT.iron);
  }
  block.addMesh(transformGeo(G.box(150, 14, 430), T(0, 30, 0)), MAT.iron); // valley floor

  // 气缸（缸套）×8
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z = CYL_Z[i];
    body(`气缸${i + 1}`, [
      [bank(G.tube(45, 52, 185, 32), beta, deckDist - 92, z), MAT.steel],
    ], { category: CAT_BODY, func: '活塞在其内部往复运动的工作腔。', rel: '安装在缸体承孔内，与活塞、活塞环配合。' });
  }

  // 气缸盖 ×2（左排 +45°、右排 -45°）
  for (const [bi, beta] of [[0, 45], [1, -45]]) {
    body(`气缸盖(${bi === 0 ? '左排' : '右排'})`, [
      [bank(G.box(120, 110, 430), beta, deckDist + 70, 0), MAT.aluminum],
    ], { category: CAT_BODY, shell: true,
      func: '封闭本排气缸顶部，布置进排气道、气门、火花塞与凸轮轴。',
      rel: '通过缸盖螺栓固定在缸体上，与本排活塞构成燃烧室。' });
  }

  // 油底壳
  body('油底壳', [
    [transformGeo(G.box(170, 8, 560), T(0, -130, 0)), MAT.iron],
    [transformGeo(G.box(170, 60, 12), T(0, -100, 278)), MAT.iron],
    [transformGeo(G.box(170, 60, 12), T(0, -100, -278)), MAT.iron],
    [transformGeo(G.box(12, 60, 560), T(84, -100, 0)), MAT.iron],
    [transformGeo(G.box(12, 60, 560), T(-84, -100, 0)), MAT.iron],
  ], { category: CAT_BODY, shell: true, func: '储存机油并收集回落的润滑油。', rel: '固定在曲轴箱下方。' });

  // 气缸盖罩 ×2
  for (const [bi, beta] of [[0, 45], [1, -45]]) {
    body(`气缸盖罩(${bi === 0 ? '左排' : '右排'})`, [
      [bank(G.box(116, 46, 410), beta, deckDist + 125, 0), MAT.aluminum],
    ], { category: CAT_BODY, shell: true, func: '封闭本排配气机构。', rel: '安装在本排气缸盖顶部。' });
  }

  // 进气歧管 ×2（V 形夹角内）
  for (const [bi, beta] of [[0, 45], [1, -45]]) {
    const m = body(`进气歧管(${bi === 0 ? '左排' : '右排'})`, [
      [bank(G.box(40, 40, 300), beta, deckDist + 80, bi === 0 ? 30 : -30), MAT.aluminum],
    ], { category: CAT_BODY, shell: true, func: '将混合气分配到本排各气缸。', rel: '位于 V 形夹角内，连接本排进气门。' });
    for (let k = 0; k < 4; k++) {
      const z = PIN_Z[k] + (bi === 0 ? 17 : -17);
      m.addMesh(transformGeo(G.tubeAlongPath(
        [[bi === 0 ? 60 : -60, deckDist + 80, z], [bi === 0 ? 40 : -40, deckDist + 60, z], [axisX(deckDist, beta), axisY(deckDist, beta), z]], 10, 12), mat4Identity()), MAT.aluminum);
    }
  }

  // 排气歧管 ×2（外侧）
  for (const [bi, beta] of [[0, 45], [1, -45]]) {
    const ex = body(`排气歧管(${bi === 0 ? '左排' : '右排'})`, [], { category: CAT_BODY, shell: true,
      func: '汇集本排各缸废气并导出。', rel: '连接本排排气门与排气管。' });
    const sx = bi === 0 ? 1 : -1;
    ex.addMesh(transformGeo(G.tubeAlongPath([[sx * 130, deckDist - 20, 0], [sx * 170, 80, 0], [sx * 170, 10, 0]], 15, 14), mat4Identity()), MAT.exhaust);
    for (let k = 0; k < 4; k++) {
      const z = PIN_Z[k] - (bi === 0 ? 17 : -17);
      ex.addMesh(transformGeo(G.tubeAlongPath([[axisX(deckDist, beta), axisY(deckDist, beta), z], [sx * 130, deckDist - 20, z], [sx * 150, deckDist - 60, z]], 10, 12), mat4Identity()), MAT.exhaust);
    }
  }

  body('节气门', [
    [transformGeo(G.tube(22, 26, 20, 24), T(0, 175, 140)), MAT.steel],
  ], { category: CAT_BODY, shell: true, func: '控制进入发动机的空气量。', rel: '安装在进气歧管入口，连接空气滤清器。' });

  body('空气滤清器', [
    [transformGeo(G.box(90, 50, 70), T(0, 220, 120)), MAT.plastic],
  ], { category: CAT_BODY, shell: true, func: '过滤进入发动机的空气。', rel: '位于进气道前端。' });

  // ===== 曲柄连杆机构 =====
  const crank = P('曲轴', { category: CAT_CRANK,
    func: '将 8 个活塞的往复运动转换为旋转运动，输出动力（十字平面曲轴，4 个连杆轴颈各 90°）。',
    rel: '每个连杆轴颈同时连接左右两排各一根连杆；由主轴承支承。',
    update: (st) => { crank.local = mat4RotZ(-st.crankDeg * DEG); } });

  for (let k = 0; k < 5; k++) {
    child(crank, `主轴颈${k + 1}`, { category: CAT_CRANK, func: '曲轴支承在曲轴箱主轴承上的轴颈。', rel: '与主轴承（轴瓦）配合。' })
      .addMesh(transformGeo(G.cylinder(30, 30, 22, 24), T(0, 0, MAIN_Z[k])), MAT.steel);
  }
  for (let k = 0; k < 4; k++) {
    const z = PIN_Z[k], th = PIN_THROW[k] * DEG;
    const px = V8.crankRadius * Math.sin(th), py = V8.crankRadius * Math.cos(th);
    crank.addMesh(transformGeo(G.cylinder(24, 24, 44, 24), T(px, py, z)), MAT.steel); // shared pin (wide)
    for (const dz of [-30, 30]) {
      const wz = z + dz;
      crank.addMesh(transformGeo(G.cylinder(46, 46, 16, 26), T(0, 0, wz)), MAT.steel);
      crank.addMesh(transformGeo(G.box(62, 56, 16), T(-px / V8.crankRadius * 34, -py / V8.crankRadius * 34, wz)), MAT.steelDark);
    }
  }
  crank.addMesh(transformGeo(G.cylinder(16, 16, 40, 20), T(0, 0, 320)), MAT.steel);
  crank.addMesh(transformGeo(G.cylinder(38, 38, 14, 24), T(0, 0, -292)), MAT.steel);
  const flywheel = child(crank, '飞轮', { category: CAT_CRANK, func: '储存旋转动能，输出动力。', rel: '固定在曲轴后端。' });
  flywheel.addMesh(transformGeo(G.cylinder(110, 110, 20, 36), T(0, 0, -310)), MAT.steelDark);
  const crankSprocket = child(crank, '曲轴正时链轮', { category: CAT_CRANK, func: '驱动正时链条。', rel: '安装在曲轴前端，齿数为凸轮轴链轮一半。' });
  crankSprocket.addMesh(transformGeo(G.cylinder(23, 23, 12, 26), T(0, 0, 300)), MAT.steelDark);

  // 连杆 ×8
  const rods = [];
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i];
    const z = CYL_Z[i] + (i % 2 === 0 ? -V8.rodZOffset : V8.rodZOffset);
    const rod = P(`连杆${i + 1}`, { category: CAT_CRANK,
      func: '连接活塞与曲轴，将往复运动与旋转运动相互转换。',
      rel: `大头连接曲柄销（与对排连杆共用），小头经活塞销连接活塞。`,
      update: (st) => {
        const c = st.cyl[i];
        rod.local = mat4MulAll(mat4Translation(c.pinX, c.pinY, z), mat4RotZ(-c.rodAngleDeg * DEG));
      } });
    rod.addMesh(transformGeo(G.box(14, V8.rodLength - 44, 9), T(0, 30 + (V8.rodLength - 44) / 2, 0)), MAT.steel);
    child(rod, `连杆大头${i + 1}`, { category: CAT_CRANK, func: '连杆连接曲柄销的轴承端。', rel: '套装在曲柄销上。' })
      .addMesh(transformGeo(G.tube(25, 31, 20, 24), T(0, 0, 0)), MAT.steelDark);
    child(rod, `连杆小头${i + 1}`, { category: CAT_CRANK, func: '连杆连接活塞销的衬套端。', rel: '通过活塞销与活塞相连。' })
      .addMesh(transformGeo(G.tube(11, 14, 18, 20), T(0, V8.rodLength, 0)), MAT.brass);
    rods.push(rod);
  }

  // 活塞 ×8
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i];
    const z = CYL_Z[i] + (i % 2 === 0 ? -V8.rodZOffset : V8.rodZOffset);
    const piston = P(`活塞${i + 1}`, { category: CAT_CRANK,
      func: '承受燃气压力并经连杆传给曲轴，其往复运动构成四冲程循环。',
      rel: `沿本排（${beta > 0 ? '左' : '右'}排）气缸轴线滑动，经活塞销与连杆小头相连。`,
      update: (st) => {
        const c = st.cyl[i];
        piston.local = mat4MulAll(mat4Translation(c.pistonX, c.pistonY, z), mat4RotZ(-beta * DEG));
      } });
    const crown = child(piston, `活塞冠${i + 1}`, { category: CAT_CRANK, func: '活塞顶部，直接承受高温高压燃气。', rel: '与气缸、缸盖构成燃烧室。' });
    crown.addMesh(transformGeo(G.lathe([
      [2, 44.5], [3.5, 42.4], [6, 42.4], [7.5, 44.5],
      [9, 44.5], [10.5, 42.4], [13, 42.4], [14.5, 44.5],
      [16, 44.5], [17.5, 42.4], [20, 42.4], [21.5, 44.5],
      [26, 44.0], [28, 43.0], [30, 42.0],
    ], 36, { capTop: true, capBottom: false }), mat4Identity()), MAT.aluminum);
    child(piston, `活塞裙${i + 1}`, { category: CAT_CRANK, func: '活塞下部导向部分。', rel: '与气缸壁滑动接触。' })
      .addMesh(transformGeo(G.tube(42, 44.5, 36, 32), T(0, -18, 0)), MAT.aluminum);
    const rings = child(piston, `活塞环${i + 1}`, { category: CAT_CRANK, func: '密封活塞与气缸壁间隙。', rel: '装在活塞环槽内。' });
    for (const gy of [4.75, 11.75, 18.75]) rings.addMesh(transformGeo(G.tube(43.5, 45, 2.4, 32), T(0, gy, 0)), MAT.steelDark);
    child(piston, `活塞销${i + 1}`, { category: CAT_CRANK, func: '连接活塞与连杆小头。', rel: '穿过活塞销孔与连杆小头衬套。' })
      .addMesh(transformGeo(G.cylinder(11, 11, 46, 18), mat4RotZ(Math.PI / 2)), MAT.steel);
  }

  // ===== 配气机构 =====
  // 每排一个 SOHC 凸轮轴，直驱桶式挺柱（无摇臂）
  for (const [bi, beta] of [[0, 45], [1, -45]]) {
    const bankLabel = bi === 0 ? '左排' : '右排';
    const cam = P(`凸轮轴(${bankLabel})`, { category: CAT_VALVE,
      func: `通过凸轮廓线按时开闭${bankLabel}气门，转速为曲轴的一半。`,
      rel: `由正时链条驱动，直驱${bankLabel}各缸气门挺柱。`,
      update: (st) => { cam.local = mat4MulAll(mat4Translation(axisX(camDist, beta), axisY(camDist, beta), 0), mat4RotZ(-st.camDeg * DEG)); } });
    cam.addMesh(transformGeo(G.cylinder(12, 12, 470, 20), mat4Identity()), MAT.steel);
    for (const zj of [-160, 0, 160]) cam.addMesh(transformGeo(G.cylinder(15, 15, 16, 20), T(0, 0, zj)), MAT.steelDark);
    for (let k = 0; k < 4; k++) {
      const cylIdx = bi === 0 ? 2 * k : 2 * k + 1;
      for (const which of ['intake', 'exhaust']) {
        const zLobe = CYL_Z[cylIdx] + (which === 'intake' ? 17 : -17);
        const gammaOpen = wrap360((FIRE_PHASE[cylIdx] + (which === 'intake' ? V8.intakeCenter : V8.exhaustCenter)) / 2);
        const noseLocal = 180 + beta + gammaOpen;
        const lobe = child(cam, `凸轮(${bankLabel}${k + 1}缸${which === 'intake' ? '进' : '排'})`, { category: CAT_VALVE,
          func: `控制${bankLabel}第${k + 1}缸${which === 'intake' ? '进气' : '排气'}门的开闭。`,
          rel: `随凸轮轴旋转，推动${bankLabel}气门挺柱。` });
        lobe.addMesh(transformGeo(G.extrudePolar((t) => camLobeRadius(deg(t) - noseLocal), 44, 12), T(0, 0, zLobe)), MAT.steelDark);
      }
    }
    const sprocket = child(cam, `凸轮轴链轮(${bankLabel})`, { category: CAT_VALVE, func: '由正时链条驱动。', rel: '齿数为曲轴链轮 2 倍。' });
    sprocket.addMesh(transformGeo(G.cylinder(46, 46, 12, 32), T(0, 0, 300)), MAT.steelDark);
  }

  // 气门 ×16（每缸 1 进 1 排），沿本排轴线运动
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z0 = CYL_Z[i];
    for (const which of ['intake', 'exhaust']) {
      const vz = z0 + (which === 'intake' ? 17 : -17);
      const vHeadR = which === 'intake' ? 18 : 16;
      const valve = P(`${which === 'intake' ? '进气门' : '排气门'}${i + 1}`, { category: CAT_VALVE,
        func: `控制第${i + 1}缸${which === 'intake' ? '进气' : '排气'}道的开闭。`,
        rel: `由本排凸轮直驱挺柱，气门弹簧使其回位。`,
        update: (st) => {
          const lift = which === 'intake' ? st.cyl[i].intakeLift : st.cyl[i].exhaustLift;
          valve.local = mat4MulAll(mat4Translation(axisX(deckDist - lift, beta), axisY(deckDist - lift, beta), vz), mat4RotZ(-beta * DEG));
        } });
      valve.addMesh(transformGeo(G.lathe([[0, 0], [vHeadR, 4], [vHeadR, 8], [4, 12], [3, stemLen]], 28, { capTop: false, capBottom: true }), mat4Identity()),
        which === 'intake' ? MAT.steel : MAT.exhaust);
      valve.addMesh(transformGeo(G.cylinder(11, 11, 5, 18), T(0, stemLen - 8, 0)), MAT.steelDark); // bucket tappet
    }
  }

  // 气门弹簧 ×16
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z0 = CYL_Z[i];
    for (const which of ['intake', 'exhaust']) {
      const vz = z0 + (which === 'intake' ? 17 : -17);
      const spring = P(`气门弹簧(${i + 1}缸${which === 'intake' ? '进' : '排'})`, { category: CAT_VALVE,
        func: '使气门迅速回位关闭并保持密封。', rel: '套在气门杆上，一端压在缸盖弹簧座上。',
        update: (st) => {
          const lift = which === 'intake' ? st.cyl[i].intakeLift : st.cyl[i].exhaustLift;
          spring.local = mat4MulAll(mat4Translation(axisX(springSeat, beta), axisY(springSeat, beta), vz),
            mat4RotZ(-beta * DEG), mat4Scale(1, 1 - lift / springH, 1));
        } });
      spring.addMesh(transformGeo(G.helix(springH, 5.5, 10, 2, 10, 26), mat4Identity()), MAT.steel);
    }
  }

  // 正时链条（曲轴链轮 -> 左排凸轮轴链轮）
  const crankR = 23, camR = 46, chainZ = 300;
  const path = beltPath([0, 0], crankR, [axisX(camDist, 45), axisY(camDist, 45)], camR, 22, 12);
  const chain = P('正时链条', { category: CAT_VALVE,
    func: '将曲轴旋转按 2:1 速比传给凸轮轴，保证配气相位。',
    rel: '环绕曲轴正时链轮与凸轮轴链轮。',
    update: (st) => {
      const n = chain.links.length, spacing = path.total / n, off = crankR * st.crankDeg * DEG;
      for (let k = 0; k < n; k++) {
        const pt = pathPointAt(path, k * spacing + off);
        chain.links[k].local = mat4MulAll(mat4Translation(pt.x, pt.y, chainZ), mat4RotZ(pt.ang));
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
  body('正时链条导轨', [
    [transformGeo(G.box(8, 150, 10), T(-20, camDist / 2, chainZ)), MAT.plastic],
    [transformGeo(G.box(8, 150, 10), T(20, camDist / 2, chainZ)), MAT.plastic],
  ], { category: CAT_VALVE, func: '引导并张紧正时链条。', rel: '安装在链条松边一侧。' });

  // ===== 燃油与点火系统 =====
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z = CYL_Z[i];
    body(`燃烧室${i + 1}`, [
      [bank(G.lathe([[0, 0], [42, 3], [42, 6]], 36, { capTop: true, capBottom: true }), beta, deckDist - 4, z),
        { color: [0.12, 0.13, 0.15], spec: 0.25, shininess: 22, opacity: 0.45 }],
    ], { category: CAT_FUEL, transparent: true, func: '活塞顶部与缸盖之间的空间，燃油在此燃烧。', rel: '由缸盖、气缸壁与活塞顶围成。' });
  }
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z = CYL_Z[i];
    const plug = P(`火花塞${i + 1}`, { category: CAT_FUEL, func: '在压缩冲程末产生电火花点燃混合气。', rel: '安装在缸盖上，电极伸入燃烧室。' });
    plug.addMesh(bank(G.lathe([[0, 0], [2, 6], [2, 12], [8, 16], [8, 26], [6, 30]], 18, { capTop: false, capBottom: true }), beta, deckDist + 4, z), MAT.steel);
    plug.addMesh(bank(G.lathe([[5, 30], [5, 80], [3, 90], [1.5, 96]], 18, { capTop: true, capBottom: false }), beta, deckDist + 4, z), MAT.ceramic);
  }
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z = CYL_Z[i];
    body(`喷油器${i + 1}`, [
      [bank(G.cylinder(7, 7, 36, 16), beta, deckDist + 60, z + 14), MAT.plastic],
    ], { category: CAT_FUEL, func: '将燃油以雾状喷入进气道。', rel: '安装在进气道处，朝向进气门。' });
  }

  // ===== 冷却与润滑系统 =====
  body('水泵', [
    [transformGeo(G.box(40, 40, 34), T(100, 40, 300)), MAT.steel],
    [transformGeo(G.cylinder(30, 30, 10, 22), T(135, 40, 300)), MAT.steelDark],
  ], { category: CAT_LUBE, shell: true, func: '强制循环冷却液。', rel: '由曲轴皮带驱动，连接缸体水道。' });
  const coolant = body('冷却液通道', [], { category: CAT_LUBE, transparent: true, func: '冷却液流通通道，带走热量。', rel: '环绕气缸套与燃烧室。' });
  for (const beta of [45, -45]) {
    coolant.addMesh(bank(G.tubeAlongPath([[0, -60, 260], [0, 60, 260], [0, 60, -260], [0, -60, -260]], 7, 10), beta, 0, 0),
      { color: [0.2, 0.5, 0.9], spec: 0.4, shininess: 40, opacity: 0.5 });
  }
  body('机油泵', [
    [transformGeo(G.box(44, 30, 30), T(0, -60, 230)), MAT.steel],
    [transformGeo(G.tubeAlongPath([[0, -80, 230], [0, -110, 230]], 9, 12), mat4Identity()), MAT.steel],
  ], { category: CAT_LUBE, shell: true, func: '将机油加压输送到各摩擦副。', rel: '由曲轴驱动，从油底壳吸油。' });
  body('机油滤清器', [
    [transformGeo(G.cylinder(30, 30, 60, 22), T(95, 10, -120)), MAT.red],
  ], { category: CAT_LUBE, shell: true, func: '过滤机油杂质。', rel: '安装在缸体上，位于主油道中。' });
  const oil = body('机油通道', [], { category: CAT_LUBE, transparent: true, func: '把机油送到曲轴、连杆与气门机构。', rel: '从机油泵出发分配到各轴承。' });
  oil.addMesh(transformGeo(G.tubeAlongPath([[0, -40, 210], [0, -40, -210], [0, 60, -210], [0, 180, -210]], 6, 12), mat4Identity()),
    { color: [0.72, 0.60, 0.30], spec: 0.5, shininess: 50, opacity: 0.5 });

  // ===== 工作循环可视化 =====
  const gasParts = [], flameParts = [];
  for (let i = 0; i < 8; i++) {
    const beta = BANK_TILT[i], z = CYL_Z[i];
    const gasMat = { color: [0.5, 0.6, 1.0], emissive: [0, 0, 0], spec: 0.1, shininess: 10, opacity: 0.25 };
    const gas = P(`缸内工质${i + 1}`, { category: '工作循环', pickable: false, transparent: true,
      update: (st) => {
        const c = st.cyl[i];
        const crownDist = c.pistonDist + V8.compH;
        const h = Math.max(1, V8.deckDist - crownDist);
        gas.local = mat4MulAll(mat4Translation(axisX(crownDist, beta), axisY(crownDist, beta), z),
          mat4RotZ(-beta * DEG), mat4Scale(1, h, 1));
        const col = STROKE_COLORS[c.stroke];
        gasMat.color[0] = col[0]; gasMat.color[1] = col[1]; gasMat.color[2] = col[2];
        gasMat.opacity = (c.stroke === 'power' ? 0.5 : 0.26);
        gasMat.emissive[0] = c.stroke === 'power' ? 0.5 : 0;
        gasMat.emissive[1] = c.stroke === 'power' ? 0.12 : 0;
        gasMat.emissive[2] = 0;
      } });
    gas.addMesh(transformGeo(G.cylinder(42, 42, 1, 22), T(0, 0.5, 0)), gasMat);
    gasParts.push(gas);

    const flameMat = { color: [1, 0.55, 0.1], emissive: [1, 0.4, 0.05], spec: 0.1, shininess: 10, opacity: 0 };
    const flame = P(`点火火焰${i + 1}`, { category: '工作循环', pickable: false, transparent: true,
      update: (st) => {
        const c = st.cyl[i];
        flameMat.opacity = (c.stroke === 'power') ? Math.max(0, 1 - c.cycleAngle / 120) : 0;
      } });
    flame.addMesh(bank(G.lathe([[0, 0], [24, 10], [20, 16], [0, 22]], 22, { capTop: true, capBottom: true }), beta, deckDist, z), flameMat);
    flameParts.push(flame);
  }

  assignLayersAndMotion(parts, roots, V8_LAYER_DEFS, V8_MOTION_DEFS);

  return { roots, parts, byId, dynamicParts: parts.filter((p) => p.update), chain, gasParts, flameParts };
}

export { FIRE_PHASE as V8_FIRE_PHASE, LAYER_INFO, STROKE_NAMES };
