// app.js — main application: camera, interaction, animation, rendering, UI.
import { mat4Identity, mat4Translation, mat4Mul, mat4Perspective, mat4LookAt, mat4Scale, mat4RotX, mat4AxisAngle, mat4MulAll, v3norm, v3cross, v3sub, v3len } from './math3d.js';
import { Renderer } from './renderer.js';
import { cylinder, tube } from './geometry.js';
import { buildEngine, computeState, animate, Part, FIRE_ORDER, STROKE_NAMES, layerAmount, LAYER_INFO, transformGeo } from './parts.js';
import { buildV8Engine, computeV8State, V8_INFO } from './v8-parts.js';

// surface runtime errors visibly with full detail (not a masked "Script error.")
function showFatal(msg) {
  try {
    let d = document.getElementById('fatal');
    if (!d) {
      d = document.createElement('div');
      d.id = 'fatal';
      d.style.cssText = 'position:fixed;inset:0;z-index:999;background:#170a0a;color:#ff9d9d;padding:42px;font:13px/1.6 monospace;white-space:pre-wrap;overflow:auto';
      document.body.appendChild(d);
    }
    d.textContent = '模型加载错误：\n' + msg;
  } catch (_) { /* ignore */ }
}
function fullDetail(e) {
  if (e && e.stack) return e.stack;
  if (e && e.message) return e.message;
  return String(e);
}
// Uncaught exceptions: prefer the raw Error object (never masked), else message + location.
window.addEventListener('error', (e) => {
  if (e.error && (e.error.stack || e.error.message)) {
    showFatal(fullDetail(e.error));
  } else {
    const loc = e.filename ? ('\n@ ' + e.filename + ':' + e.lineno + ':' + e.colno) : '';
    showFatal((e.message || '未知错误') + loc);
  }
});
// Resource load failures (script/css): capture phase, show the exact URL + hint.
window.addEventListener('error', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
    showFatal('资源加载失败：' + (t.src || t.href) + '\n（请检查文件是否存在、路径与大小写是否一致）');
  }
}, true);

const canvas = document.getElementById('c');
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  showFatal(fullDetail(e));
  throw e;
}

// ---------------- engine registry / manager ----------------
const ENGINES = {
  i4: {
    id: 'i4', name: '直列四缸', title: '直列四缸四冲程汽油发动机',
    cylinders: 4, layout: '直列', cycle: '四冲程', fireOrderText: '1-3-4-2',
    build: buildEngine, computeState, animate,
    labels: [
      { name: '曲轴', text: 'Crankshaft' },
      { name: '活塞1', text: 'Piston #1' },
      { name: '连杆1', text: 'Connecting Rod' },
      { name: '凸轮轴', text: 'Camshaft' },
      { name: '进气门1', text: 'Intake Valve' },
      { name: '火花塞1', text: 'Spark Plug' },
      { name: '气缸盖', text: 'Cylinder Head' },
      { name: '缸体', text: 'Engine Block' },
      { name: '飞轮', text: 'Flywheel' },
      { name: '排气歧管', text: 'Exhaust Manifold' },
    ],
  },
  v8: {
    id: 'v8', name: 'V8', title: 'V8 四冲程汽油发动机',
    cylinders: 8, layout: '90° V型', cycle: '四冲程', fireOrderText: '1-8-4-3-6-5-7-2',
    build: buildV8Engine, computeState: computeV8State, animate,
    labels: [
      { name: '曲轴', text: 'Crankshaft' },
      { name: '活塞1', text: 'Piston #1' },
      { name: '连杆1', text: 'Connecting Rod' },
      { name: '凸轮轴(左排)', text: 'Camshaft (L)' },
      { name: '进气门1', text: 'Intake Valve' },
      { name: '火花塞1', text: 'Spark Plug' },
      { name: '气缸盖(左排)', text: 'Cylinder Head (L)' },
      { name: '缸体', text: 'Engine Block' },
      { name: '飞轮', text: 'Flywheel' },
      { name: '排气歧管(左排)', text: 'Exhaust Header (L)' },
    ],
  },
};
const engineStates = {
  i4: { rpm: 1200, crankDeg: 0, explode: 0, targetExplode: 0, currentLayer: 0, playing: true },
  v8: { rpm: 1000, crankDeg: 0, explode: 0, targetExplode: 0, currentLayer: 0, playing: true },
};
let current = ENGINES.i4;
let engine, parts, roots, byId;
const guides = [];
const pickToPart = new Map();
const labelEls = [];

// guide lines: one per exploded top-level assembly
function createGuides() {
  const guideGeo = cylinder(1.5, 1.5, 1, 8);      // unit-length thin rod along Y
  const guideMat = { color: [0.62, 0.72, 0.85], spec: 0.15, shininess: 8, opacity: 0.30 };
  for (const r of roots) {
    if (!r.explode || !r.layer) continue;
    const g = new Part('g_' + r.id, '引导线', { category: '', pickable: false, transparent: true });
    g.src = r;
    g.addMesh(guideGeo, guideMat);
    g.visible = false;
    parts.push(g);
    roots.push(g);
    guides.push(g);
  }
}

// 视觉风格：曲轴与连杆 → 青铜暖色金属；展示台 → 深色圆盘 + 发光青蓝圆环
function applyVizStyle() {
  const bronze = { color: [0.60, 0.44, 0.22], spec: 0.80, shininess: 95 };
  for (const p of parts) {
    if (/^曲轴$|^主轴颈|^飞轮|^连杆\d|^连杆大头/.test(p.name)) {
      for (const m of p.meshes) m.material = bronze;
    }
  }
}
function createPlatform() {
  const p = new Part('platform', '', { category: '', pickable: false });
  p.addMesh(transformGeo(cylinder(330, 330, 6, 48), mat4Translation(0, -204, 0)),
    { color: [0.05, 0.07, 0.10], spec: 0.45, shininess: 60 });
  p.addMesh(transformGeo(tube(325, 332, 5, 48), mat4Translation(0, -200, 0)),
    { color: [0.0, 0.10, 0.20], spec: 0.6, shininess: 60, emissive: [0.08, 0.45, 1.0] });
  parts.push(p);
  roots.push(p);
}

function setupEngine(id) {
  current = ENGINES[id];
  guides.length = 0;
  pickToPart.clear();
  try {
    engine = current.build();
  } catch (e) {
    showFatal(fullDetail(e));
    throw e;
  }
  parts = engine.parts;
  roots = engine.roots;
  byId = engine.byId;
  applyVizStyle();
  createPlatform();
  createGuides();
  buildLabels();
  parts.forEach((p, i) => { p.pickIndex = i + 1; pickToPart.set(i + 1, p); });
}

setupEngine('i4');

// ---------------- 3D part labels (dot + line + glass tag) ----------------
function buildLabels() {
  const layer = document.getElementById('labelLayer');
  layer.innerHTML = '';
  labelEls.length = 0;
  for (const it of current.labels) {
    const p = parts.find((q) => q.name === it.name);
    if (!p) continue;
    const el = document.createElement('div');
    el.className = 'plabel';
    el.innerHTML = '<span class="pdot"></span><span class="pline"></span><span class="ptext">' + it.text + '</span>';
    layer.appendChild(el);
    labelEls.push({ el, p });
  }
}
function projectToScreen(p) {
  const m = projView();
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0.0001) return null;
  const sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  const sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return {
    x: (sx * 0.5 + 0.5) * canvas.clientWidth,
    y: (0.5 - sy * 0.5) * canvas.clientHeight,
  };
}
function updateLabels() {
  for (const it of labelEls) {
    if (!view.labels || !it.p.visible) { it.el.style.display = 'none'; continue; }
    const s = projectToScreen([it.p.world[12], it.p.world[13], it.p.world[14]]);
    if (!s) { it.el.style.display = 'none'; continue; }
    it.el.style.display = 'flex';
    it.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
  }
}

function updateGuides() {
  for (const g of guides) {
    if (!view.guides) { g.visible = false; continue; }
    const p = g.src;
    const home = [p.local[12], p.local[13], p.local[14]];
    const cur = p.world ? [p.world[12], p.world[13], p.world[14]] : home;
    const dx = cur[0] - home[0], dy = cur[1] - home[1], dz = cur[2] - home[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) { g.visible = false; continue; }
    g.visible = true;
    const dir = [dx / len, dy / len, dz / len];
    const axis = v3cross([0, 1, 0], dir);
    const cosang = dir[1];
    let rot;
    if (Math.abs(cosang) > 0.9999) {
      rot = dir[1] > 0 ? mat4Identity() : mat4RotX(Math.PI);
    } else {
      rot = mat4AxisAngle(v3norm(axis), Math.acos(Math.max(-1, Math.min(1, cosang))));
    }
    g.local = mat4MulAll(mat4Translation((home[0] + cur[0]) / 2, (home[1] + cur[1]) / 2, (home[2] + cur[2]) / 2),
      rot, mat4Scale(1, len, 1));
  }
}

// pick id -> part (populated in setupEngine)


// ---------------- state ----------------
const view = {
  theta: 0.75, phi: 0.36, dist: 1020,
  target: [0, 115, 0],
  playing: true,
  rpm: 1200,
  crankDeg: 0,
  explode: 0,           // actual (eased) separation 0..1
  targetExplode: 0,     // slider/step target
  currentLayer: 0,      // 0..7
  cutaway: false,
  cutX: 0,
  cutFlip: false,
  xray: true,
  xrayLevel: 0.28,      // shell opacity in x-ray
  cycle: true,
  isolatedId: null,
  selectedId: null,
  goal: null,           // camera auto-focus { target, dist }
  guides: false,        // guide lines toggle
  labels: true,         // 3D part labels toggle
};
const anim = { last: 0 };

// ---------------- camera ----------------
function eyePos() {
  const { theta, phi, dist, target } = view;
  const ce = Math.cos(phi);
  return [
    target[0] + dist * ce * Math.sin(theta),
    target[1] + dist * Math.sin(phi),
    target[2] + dist * ce * Math.cos(theta),
  ];
}
function projView() {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const P = mat4Perspective(45 * Math.PI / 180, aspect, 10, 6000);
  return mat4Mul(P, mat4LookAt(eyePos(), view.target, [0, 1, 0]));
}

// ---------------- world matrices ----------------
function computeWorld(part, parentWorld) {
  let m;
  if (part.parent) {
    m = mat4Mul(parentWorld, part.local);
  } else {
    let ex = mat4Identity();
    const amt = part.layer ? layerAmount(part.layer, view.explode) : 0;
    if (part.explode && amt > 0) {
      ex = mat4Translation(part.explode[0] * amt, part.explode[1] * amt, part.explode[2] * amt);
    }
    m = mat4Mul(ex, part.local);
  }
  part.world = m;
  for (const c of part.children) computeWorld(c, m);
}

// ---------------- opacity / highlight ----------------
function partOpacity(p) {
  let o = 1;
  const m = p.meshes.length ? p.meshes[0].material : null;
  if (p.transparent || (m && m.opacity !== undefined && m.opacity < 1)) o = (m && m.opacity != null) ? m.opacity : 1;
  else if (view.xray && p.shell) o = view.xrayLevel;
  return o;
}

// ---------------- render ----------------
const clipPlane = () => view.cutaway
  ? [view.cutFlip ? -1 : 1, 0, 0, view.cutX] : null;

function drawPart(p, out) {
  if (!p.visible) return;
  if (view.isolatedId && !p._inSelectedSubtree) return;
  const clip = clipPlane();
  const op = partOpacity(p);
  const selected = p.id === view.selectedId;
  for (const mesh of p.meshes) {
    const emissive = selected ? [0.30, 0.22, 0.05] : (mesh.material.emissive || [0, 0, 0]);
    const alpha = Math.min(op, mesh.material.opacity !== undefined ? mesh.material.opacity : 1);
    out.push({ mat: p.world, geo: mesh.geometry, material: mesh.material, opacity: alpha, clip, emissive, dist: drawDist(p) });
  }
  for (const c of p.children) drawPart(c, out);
}
function drawDist(p) {
  const e = eyePos();
  const w = p.world;
  const dx = w[12] - e[0], dy = w[13] - e[1], dz = w[14] - e[2];
  return dx * dx + dy * dy + dz * dz;
}
function markSubtree(p) {
  p._inSelectedSubtree = true;
  for (const c of p.children) markSubtree(c);
}

function render() {
  computeWorldForAll();
  const eye = eyePos();
  renderer.setCamera(projView(), eye);
  renderer.setLights(
    v3norm([0.50, 0.80, 0.45]), [1.0, 0.98, 0.94],   // key: warm white
    v3norm([-0.70, 0.15, -0.45]), [0.55, 0.68, 1.0], // fill: cool blue
    [0.30, 0.55, 1.0],                                // rim: tech blue
    [0.34, 0.42, 0.55],                               // env top: cool sky
    [0.03, 0.04, 0.06]                                // env bottom: near-black floor
  );
  renderer.clear();
  updateLabels();

  // mark selected subtree for isolate mode
  for (const p of parts) p._inSelectedSubtree = false;
  if (view.isolatedId) {
    const sel = byId.get(view.isolatedId);
    if (sel) markSubtree(sel);
  }

  const all = [];
  for (const r of roots) drawPart(r, all);
  const opaqueList = all.filter((d) => d.opacity >= 0.999);
  const transparent = all.filter((d) => d.opacity < 0.999);

  const gl = renderer.gl;
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  for (const d of opaqueList) {
    renderer.drawMesh(d.mat, d.geo, d.material, { opacity: d.opacity, clip: d.clip, emissive: d.emissive });
  }
  transparent.sort((a, b) => b.dist - a.dist);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  for (const d of transparent) {
    renderer.drawMesh(d.mat, d.geo, d.material, { opacity: d.opacity, clip: d.clip, emissive: d.emissive });
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

function computeWorldForAll() {
  for (const r of roots) computeWorld(r, mat4Identity());
}

// ---------------- picking ----------------
function pickPart(cx, cy) {
  renderer.beginPick();
  for (const p of parts) {
    if (!p.visible || !p.pickable) continue;
    if (view.isolatedId && !p._inSelectedSubtree) continue;
    for (const mesh of p.meshes) {
      renderer.drawMesh(p.world, mesh.geometry, mesh.material, { pickMode: true, pickColor: renderer.pickColor(p.pickIndex) });
    }
  }
  const id = renderer.readPickId(cx, cy);
  renderer.endPick();
  return id;
}

// ---------------- animation loop ----------------
function step(dt) {
  if (view.playing) {
    const degPerSec = (view.rpm / 60) * 360;
    view.crankDeg += degPerSec * dt;
  }
  // smooth separation easing
  const k = 1 - Math.exp(-dt * 4);
  view.explode += (view.targetExplode - view.explode) * k;
  if (Math.abs(view.targetExplode - view.explode) < 0.0005) view.explode = view.targetExplode;
  // camera auto-focus easing
  if (view.goal) {
    const kc = 1 - Math.exp(-dt * 3.2);
    view.target[0] += (view.goal.target[0] - view.target[0]) * kc;
    view.target[1] += (view.goal.target[1] - view.target[1]) * kc;
    view.target[2] += (view.goal.target[2] - view.target[2]) * kc;
    view.dist += (view.goal.dist - view.dist) * kc;
    if (Math.abs(view.goal.dist - view.dist) < 2) view.goal = null;
  }
  const st = current.computeState(view.crankDeg);
  animate(engine, st);
  updateGuides();
  render();
  updateCyclePanel(st);
  return st;
}

function loop(t) {
  try {
    const dt = Math.min(0.1, (t - anim.last) / 1000 || 0.016);
    anim.last = t;
    step(dt);
  } catch (e) {
    showFatal(fullDetail(e));
    return; // stop the loop so the error stays visible
  }
  requestAnimationFrame(loop);
}

// ---------------- orbit controls ----------------
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* some browsers throw here */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button });
  pinchDist = 0;
  view.goal = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = pointers.get(e.pointerId);
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;

  if (pointers.size === 1) {
    if (p.btn === 2 || e.shiftKey) {
      pan(dx, dy);
    } else if (p.btn === 0) {
      view.theta -= dx * 0.005;
      view.phi -= dy * 0.005;
      view.phi = Math.max(-1.45, Math.min(1.45, view.phi));
    }
  } else if (pointers.size === 2) {
    const arr = [...pointers.values()];
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    if (pinchDist > 0) {
      view.dist = Math.max(350, Math.min(2400, view.dist * (pinchDist / d)));
    }
    pinchDist = d;
  }
});
canvas.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  pinchDist = 0;
  if (e.button === 0 && Math.abs(e.clientX - (canvas._downX || 0)) < 4) {
    // click -> pick
    const r = canvas.getBoundingClientRect();
    const id = pickPart(e.clientX - r.left, e.clientY - r.top);
    if (id > 0 && pickToPart.has(id)) selectPart(pickToPart.get(id));
  }
});
canvas.addEventListener('pointerdown', (e) => { canvas._downX = e.clientX; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.goal = null;
  view.dist = Math.max(350, Math.min(2400, view.dist * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function pan(dx, dy) {
  const eye = eyePos();
  const fwd = v3norm(v3sub(view.target, eye));
  const right = v3norm(v3cross(fwd, [0, 1, 0]));
  const up = v3cross(right, fwd);
  const s = view.dist * 0.0016;
  view.target[0] -= right[0] * dx * s + up[0] * dy * s;
  view.target[1] -= right[1] * dx * s + up[1] * dy * s;
  view.target[2] -= right[2] * dx * s + up[2] * dy * s;
}

// ---------------- selection ----------------
function selectPart(p, focus = true) {
  view.selectedId = p.id;
  view.isolatedId = null;
  updateInfo(p);
  syncTreeSelection();
  if (focus && p.world) {
    // smoothly move the camera to observe the selected part (no jump)
    view.goal = {
      target: [p.world[12], p.world[13], p.world[14]],
      dist: (p.meshes.length === 0 || p.children.length > 3) ? 620 : 460,
    };
  }
}

// ---------------- UI: tree ----------------
const CATS = ['发动机主体', '曲柄连杆机构', '配气机构', '燃油与点火系统', '冷却与润滑系统'];
function buildTree() {
  const tree = document.getElementById('tree');
  tree.innerHTML = '';
  for (const cat of CATS) {
    const hdr = document.createElement('div');
    hdr.className = 'cat';
    hdr.textContent = cat;
    tree.appendChild(hdr);
    for (const r of roots) {
      if (r.category !== cat) continue;
      treeItem(r, 0);
    }
  }
}
function treeItem(p, depth) {
  const row = document.createElement('div');
  row.className = 'node';
  row.style.paddingLeft = (8 + depth * 14) + 'px';
  row.dataset.id = p.id;
  row.addEventListener('click', (e) => { e.stopPropagation(); selectPart(p); });

  const eye = document.createElement('button');
  eye.className = 'eye' + (p.visible ? ' on' : '');
  eye.textContent = p.visible ? '◉' : '○';
  eye.title = '显示/隐藏';
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    p.visible = !p.visible;
    eye.className = 'eye' + (p.visible ? ' on' : '');
    eye.textContent = p.visible ? '◉' : '○';
  });
  row.appendChild(eye);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = p.name;
  row.appendChild(label);

  if (p.meshes.length === 0) row.classList.add('group');

  const iso = document.createElement('button');
  iso.className = 'iso';
  iso.textContent = '⊞';
  iso.title = '单独显示';
  iso.addEventListener('click', (e) => {
    e.stopPropagation();
    view.isolatedId = (view.isolatedId === p.id) ? null : p.id;
    view.selectedId = p.id;
    updateInfo(p);
  });
  row.appendChild(iso);

  tree.appendChild(row);

  // children (hide tiny repetitive ones from the tree)
  for (const c of p.children) {
    if (/链条节|缸内工质|点火火焰/.test(c.name)) continue;
    treeItem(c, depth + 1);
  }
}

function syncTreeSelection() {
  const nodes = document.querySelectorAll('#tree .node');
  for (const n of nodes) {
    n.classList.toggle('sel', n.dataset.id === view.selectedId);
  }
}

// ---------------- UI: info panel ----------------
function updateInfo(p) {
  document.getElementById('infoName').textContent = p.name;
  document.getElementById('infoFunc').textContent = p.func || '（无描述）';
  document.getElementById('infoRel').textContent = p.rel || '（无）';
  document.getElementById('infoMotion').textContent = p.motion || '';
}

// ---------------- UI: cycle panel ----------------
const STROKE_ZH = { power: '做功', exhaust: '排气', intake: '进气', compression: '压缩' };
function buildCyclePanel() {
  const list = document.getElementById('cylList');
  list.innerHTML = '';
  for (let i = 0; i < current.cylinders; i++) {
    const el = document.createElement('div');
    el.className = 'cyl';
    el.id = 'cyl' + (i + 1);
    list.appendChild(el);
  }
  syncEngineInfo();
}
function syncEngineInfo() {
  document.getElementById('engName').textContent = current.name;
  document.getElementById('engCyc').textContent = current.cycle;
  document.getElementById('engCyl').textContent = current.cylinders + ' 缸';
  document.getElementById('engLayout').textContent = current.layout;
  document.getElementById('engFire').textContent = current.fireOrderText;
}
function updateCyclePanel(st) {
  const els = document.getElementById('cylList').children;
  for (let i = 0; i < current.cylinders && i < els.length; i++) {
    const el = els[i];
    const c = st.cyl[i];
    const key = c.stroke;
    const firing = (c.stroke === 'power');
    el.textContent = `${i + 1}缸 ${STROKE_ZH[key]}`;
    el.className = 'cyl cyl-' + key + (firing ? ' firing' : '');
    el.style.display = view.cycle ? '' : 'none';
  }
  document.getElementById('crankDegReadout').textContent = Math.round(view.crankDeg % 720) + '°';
}

// ---------------- UI: controls ----------------
function wireControls() {
  const $ = (id) => document.getElementById(id);
  $('btnPlay').addEventListener('click', () => { view.playing = !view.playing; $('btnPlay').textContent = view.playing ? '⏸ 暂停' : '▶ 播放'; });
  $('btnStep').addEventListener('click', () => { view.playing = false; $('btnPlay').textContent = '▶ 播放'; view.crankDeg += 10; });

  const rpm = $('rpm');
  rpm.addEventListener('input', () => { view.rpm = +rpm.value; $('rpmVal').textContent = rpm.value + ' RPM'; });
  for (const b of document.querySelectorAll('.rpmPreset')) {
    b.addEventListener('click', () => { view.rpm = +b.dataset.rpm; rpm.value = view.rpm; $('rpmVal').textContent = view.rpm + ' RPM'; });
  }

  const expl = $('explode');
  const layerLabel = $('layerLabel');
  const layerFromExplode = (s) => { let L = 0; for (let i = 1; i < LAYER_INFO.length; i++) if (s >= LAYER_INFO[i].at - 0.01) L = i; return L; };
  expl.addEventListener('input', () => {
    view.targetExplode = +expl.value / 100;
    view.currentLayer = layerFromExplode(view.targetExplode);
    $('explodeVal').textContent = Math.round(+expl.value) + '%';
    layerLabel.textContent = LAYER_INFO[view.currentLayer].name;
  });

  const LAYER_FOCUS = [
    { target: [0, 130, 0], dist: 980 },
    { target: [0, 240, 0], dist: 1120 },
    { target: [0, 320, 0], dist: 950 },
    { target: [0, 250, 0], dist: 950 },
    { target: [0, 150, 0], dist: 880 },
    { target: [0, 70, 0], dist: 900 },
    { target: [0, -70, 0], dist: 850 },
    { target: [0, -210, 0], dist: 950 },
  ];
  function focusOnLayer(layer) {
    const f = LAYER_FOCUS[layer] || LAYER_FOCUS[0];
    view.goal = { target: f.target.slice(), dist: f.dist };
  }
  function setLayer(layer) {
    layer = Math.max(0, Math.min(LAYER_INFO.length - 1, layer));
    view.currentLayer = layer;
    view.targetExplode = LAYER_INFO[layer].at;
    expl.value = Math.round(LAYER_INFO[layer].at * 100);
    $('explodeVal').textContent = expl.value + '%';
    layerLabel.textContent = LAYER_INFO[layer].name;
    focusOnLayer(layer);
  }

  $('btnStepNext').addEventListener('click', () => setLayer(view.currentLayer + 1));
  $('btnStepPrev').addEventListener('click', () => setLayer(view.currentLayer - 1));
  $('btnRestoreFull').addEventListener('click', () => setLayer(0));
  $('btnFocus').addEventListener('click', () => focusOnLayer(view.currentLayer));
  $('btnGuides').addEventListener('click', () => { view.guides = !view.guides; syncModeButtons(); });
  $('btnLabels').addEventListener('click', () => { view.labels = !view.labels; syncModeButtons(); });

  $('btnFull').addEventListener('click', () => { setLayer(0); view.xray = false; syncModeButtons(); });
  $('btnXray').addEventListener('click', () => { view.xray = !view.xray; syncModeButtons(); });
  $('btnLayer').addEventListener('click', () => { setLayer(LAYER_INFO.length - 1); syncModeButtons(); });

  $('btnCut').addEventListener('click', () => { view.cutaway = !view.cutaway; syncModeButtons(); });
  $('cut').addEventListener('input', () => { view.cutX = +$('cut').value; $('cutVal').textContent = $('cut').value + 'mm'; });
  $('btnCutFlip').addEventListener('click', () => { view.cutFlip = !view.cutFlip; });

  $('xrayLevel').addEventListener('input', () => { view.xrayLevel = +$('xrayLevel').value / 100; });

  $('btnCycle').addEventListener('click', () => { view.cycle = !view.cycle; syncModeButtons(); for (const g of engine.gasParts) g.visible = view.cycle; for (const f of engine.flameParts) f.visible = view.cycle; });

  $('btnReset').addEventListener('click', () => {
    view.playing = true; $('btnPlay').textContent = '⏸ 暂停';
    view.rpm = 1200; rpm.value = 1200; $('rpmVal').textContent = '1200 RPM';
    view.targetExplode = 0; view.explode = 0; view.currentLayer = 0;
    expl.value = 0; $('explodeVal').textContent = '0%';
    layerLabel.textContent = LAYER_INFO[0].name;
    view.cutaway = false; view.xray = false; view.cycle = true; view.guides = false; view.labels = true;
    view.isolatedId = null; view.selectedId = null; view.goal = null;
    view.theta = 0.75; view.phi = 0.36; view.dist = 1020; view.target = [0, 115, 0];
    for (const p of parts) p.visible = true;
    for (const g of engine.gasParts) g.visible = true;
    for (const f of engine.flameParts) f.visible = true;
    document.getElementById('infoName').textContent = '—';
    document.getElementById('infoFunc').textContent = '点击左侧结构树或直接点击模型上的零件查看功能与机械关系。';
    document.getElementById('infoRel').textContent = '';
    document.getElementById('infoMotion').textContent = '';
    rebuildTreePreserve();
    syncModeButtons();
  });

  // view presets
  const presets = {
    viewFront: { theta: 0, phi: 0, dist: 1400, target: [0, 120, 0] },
    viewSide: { theta: Math.PI / 2, phi: 0.05, dist: 1400, target: [0, 120, 0] },
    viewTop: { theta: 0.6, phi: 1.35, dist: 1300, target: [0, 140, 0] },
    viewIso: { theta: 0.75, phi: 0.36, dist: 1020, target: [0, 115, 0] },
  };
  for (const id of Object.keys(presets)) {
    const v = presets[id];
    $(id).addEventListener('click', () => Object.assign(view, v));
  }
}
function syncModeButtons() {
  const $ = (id) => document.getElementById(id);
  $('btnXray').classList.toggle('active', view.xray);
  $('btnCut').classList.toggle('active', view.cutaway);
  $('btnCycle').classList.toggle('active', view.cycle);
  $('btnGuides').classList.toggle('active', view.guides);
  $('btnLabels').classList.toggle('active', view.labels);
}
function rebuildTreePreserve() {
  buildTree();
  syncTreeSelection();
}

// ---------------- engine switching ----------------
function resetCameraForEngine() {
  if (current.id === 'v8') {
    view.theta = 0.75; view.phi = 0.40; view.dist = 1250; view.target = [0, 105, 0];
  } else {
    view.theta = 0.75; view.phi = 0.36; view.dist = 1020; view.target = [0, 115, 0];
  }
}
function syncUiState() {
  const $ = (id) => document.getElementById(id);
  $('rpm').value = view.rpm;
  $('rpmVal').textContent = view.rpm + ' RPM';
  $('explode').value = Math.round(view.targetExplode * 100);
  $('explodeVal').textContent = Math.round(view.targetExplode * 100) + '%';
  $('layerLabel').textContent = LAYER_INFO[view.currentLayer].name;
  $('btnPlay').textContent = view.playing ? '⏸ 暂停' : '▶ 播放';
  $('btnI4').classList.toggle('active', current.id === 'i4');
  $('btnV8').classList.toggle('active', current.id === 'v8');
  $('engTitle').textContent = current.title;
  document.title = current.title + ' · 汽车发动机3D实验室';
  for (const g of engine.gasParts) g.visible = view.cycle;
  for (const f of engine.flameParts) f.visible = view.cycle;
}
function switchEngine(id) {
  if (id === current.id) return;
  // save current runtime state so each engine keeps its own RPM/angle/explosion
  const s = engineStates[current.id];
  s.rpm = view.rpm; s.crankDeg = view.crankDeg; s.explode = view.explode;
  s.targetExplode = view.targetExplode; s.currentLayer = view.currentLayer; s.playing = view.playing;

  const vp = document.getElementById('viewport');
  vp.style.opacity = '0';
  setTimeout(() => {
    try {
      setupEngine(id);
    } catch (e) {
      showFatal(fullDetail(e));
      vp.style.opacity = '1';
      return;
    }
    const t = engineStates[id];
    view.rpm = t.rpm; view.crankDeg = t.crankDeg; view.explode = t.explode;
    view.targetExplode = t.targetExplode; view.currentLayer = t.currentLayer; view.playing = t.playing;
    view.isolatedId = null; view.selectedId = null; view.goal = null;
    resetCameraForEngine();
    buildCyclePanel();
    buildTree();
    updateInfo({ name: '—', func: '点击左侧结构树或直接点击模型上的零件查看功能与机械关系。', rel: '', motion: '' });
    syncUiState();
    syncModeButtons();
    vp.style.opacity = '1';
  }, 160);
}

// ---------------- init ----------------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR for mobile performance
  renderer.resize(w, h, dpr);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));

buildCyclePanel();
buildTree();
wireControls();
resize();
updateInfo({ name: '—', func: '点击左侧结构树或直接点击模型上的零件查看功能与机械关系。', rel: '', motion: '' });
syncUiState();
syncModeButtons();
document.getElementById('btnI4').addEventListener('click', () => switchEngine('i4'));
document.getElementById('btnV8').addEventListener('click', () => switchEngine('v8'));
document.getElementById('btnNote').addEventListener('click', () => document.getElementById('noteOverlay').classList.remove('hidden'));
document.getElementById('btnNoteClose').addEventListener('click', () => document.getElementById('noteOverlay').classList.add('hidden'));
requestAnimationFrame((t) => { anim.last = t; loop(t); });

// expose for debugging
window.__engine = { engine, view, parts, switchEngine };
