// math3d.js — minimal 3D math (column-major 4x4 matrices, WebGL convention).
// No dependencies. Vectors are plain JS arrays [x, y, z].

export const DEG = Math.PI / 180;
export const rad = (d) => d * DEG;
export const deg = (r) => r / DEG;

// ---------- vec3 helpers ----------
export function v3(x = 0, y = 0, z = 0) { return [x, y, z]; }
export function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3norm(a) {
  const l = v3len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// ---------- mat4 ----------
export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// out = a * b  (column-major)
export function mat4Mul(a, b) {
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

// Multiply a chain of matrices left-to-right: mat4MulAll(m1, m2, m3) = m1*m2*m3
export function mat4MulAll(...ms) {
  let out = ms[0];
  for (let i = 1; i < ms.length; i++) out = mat4Mul(out, ms[i]);
  return out;
}

export function mat4Translation(x, y, z) {
  const o = mat4Identity();
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}

export function mat4Scale(x, y, z) {
  const o = new Float32Array(16);
  o[0] = x; o[5] = y; o[10] = z; o[15] = 1;
  return o;
}

export function mat4RotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = new Float32Array(16);
  o[0] = 1; o[5] = c; o[6] = s; o[9] = -s; o[10] = c; o[15] = 1;
  return o;
}
export function mat4RotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = new Float32Array(16);
  o[0] = c; o[2] = -s; o[8] = s; o[5] = 1; o[10] = c; o[15] = 1;
  return o;
}
export function mat4RotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = new Float32Array(16);
  o[0] = c; o[1] = s; o[4] = -s; o[5] = c; o[10] = 1; o[15] = 1;
  return o;
}

// Rotation matrix (column-major) about a normalized axis by angle a (Rodrigues).
export function mat4AxisAngle(axis, a) {
  const x = axis[0], y = axis[1], z = axis[2];
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const o = new Float32Array(16);
  o[0] = c + x * x * t;  o[4] = x * y * t - z * s; o[8]  = x * z * t + y * s; o[12] = 0;
  o[1] = y * x * t + z * s; o[5] = c + y * y * t;     o[9]  = y * z * t - x * s; o[13] = 0;
  o[2] = z * x * t - y * s; o[6] = z * y * t + x * s; o[10] = c + z * z * t;   o[14] = 0;
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  return o;
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf;
  o[11] = -1; o[14] = 2 * far * near * nf;
  return o;
}

export function mat4LookAt(eye, center, up) {
  const z = v3norm(v3sub(eye, center));
  const x = v3norm(v3cross(up, z));
  const y = v3cross(z, x);
  const o = new Float32Array(16);
  o[0] = x[0]; o[1] = y[0]; o[2] = z[0];
  o[4] = x[1]; o[5] = y[1]; o[6] = z[1];
  o[8] = x[2]; o[9] = y[2]; o[10] = z[2];
  o[12] = -v3dot(x, eye); o[13] = -v3dot(y, eye); o[14] = -v3dot(z, eye);
  o[15] = 1;
  return o;
}

// Transform a point by a 4x4 matrix (w=1).
export function mat4Point(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

// upper-left 3x3 of a mat4, column-major 3x3
export function mat3FromMat4(m) {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
}

// inverse-transpose of a column-major 3x3 (for normal matrix under arbitrary linear transform)
export function mat3InverseTranspose(m) {
  const a = m[0], d = m[1], g = m[2];
  const b = m[3], e = m[4], h = m[5];
  const c = m[6], f = m[7], i = m[8];
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  let det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) det = 1e-12;
  const inv = 1 / det;
  // inverse (column-major) then transpose => inverse-transpose.
  // inverse entries (column-major): col0=(A,D,G), col1=(B,E,H), col2=(C,F,I) * inv
  const invColMajor = [A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv];
  // transpose of that (column-major)
  return [invColMajor[0], invColMajor[3], invColMajor[6],
          invColMajor[1], invColMajor[4], invColMajor[7],
          invColMajor[2], invColMajor[5], invColMajor[8]];
}
