// renderer.js — minimal WebGL1 renderer (no dependencies).
// Draws meshes with a Phong-style shader, supports alpha blending, a clip plane
// (cutaway), emissive highlights, and an offscreen color-picking pass.

import { mat3InverseTranspose } from './math3d.js';

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uWorld;
uniform mat4 uProjView;
uniform mat3 uNormalMat;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec4 wp = uWorld * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = uNormalMat * aNormal;
  gl_Position = uProjView * wp;
}`;

const FRAG = `
precision mediump float;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform float uSpec;
uniform float uShininess;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform vec3 uCamPos;
uniform vec4 uClipPlane;
uniform float uClipOn;
uniform float uPickMode;
void main() {
  if (uClipOn > 0.5) {
    float d = dot(vWorldPos, uClipPlane.xyz) - uClipPlane.w;
    if (d < 0.0) discard;
  }
  if (uPickMode > 0.5) { gl_FragColor = vec4(uColor, 1.0); return; }
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 col = uColor * 0.30;
  float dk = max(dot(N, uKeyDir), 0.0);
  col += uColor * uKeyCol * dk * 0.85;
  vec3 Hk = normalize(uKeyDir + V);
  col += uKeyCol * uSpec * pow(max(dot(N, Hk), 0.0), uShininess);
  float df = max(dot(N, uFillDir), 0.0);
  col += uColor * uFillCol * df * 0.30;
  col += uEmissive;
  gl_FragColor = vec4(col, uOpacity);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader compile: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl');
    if (!this.gl) {
      throw new Error('当前浏览器不支持 WebGL 或已禁用硬件加速，无法渲染 3D 模型。请更换浏览器或在系统设置中开启硬件加速。');
    }
    const gl = this.gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;

    this.loc = {};
    for (const n of ['aPos', 'aNormal', 'uWorld', 'uProjView', 'uNormalMat', 'uColor', 'uEmissive',
      'uOpacity', 'uSpec', 'uShininess', 'uKeyDir', 'uKeyCol', 'uFillDir', 'uFillCol', 'uCamPos',
      'uClipPlane', 'uClipOn', 'uPickMode']) {
      this.loc[n] = gl.getUniformLocation(prog, n);
      if (n.startsWith('a')) this.loc[n] = gl.getAttribLocation(prog, n);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.055, 0.065, 0.085, 1);

    this.geoCache = new Map();

    // pick framebuffer
    this.pickFb = gl.createFramebuffer();
    this.pickTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _cache(geo) {
    let c = this.geoCache.get(geo);
    if (c) return c;
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);
    const nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
    c = { vbo, nbo, ibo, count: geo.indices.length };
    this.geoCache.set(geo, c);
    return c;
  }

  resize(w, h, dpr) {
    dpr = dpr || 1;
    this.dpr = dpr;
    this.cssW = w; this.cssH = h;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.gl.viewport(0, 0, bw, bh);
    this._w = bw; this._h = bh;
  }

  setCamera(projView, camPos) {
    this.projView = projView;
    this.camPos = camPos;
  }

  setLights(keyDir, keyCol, fillDir, fillCol) {
    this.keyDir = keyDir; this.keyCol = keyCol;
    this.fillDir = fillDir; this.fillCol = fillCol;
  }

  clear() {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  // Draw one mesh. mat = world matrix (Float32Array 16).
  drawMesh(mat, geo, material, opts = {}) {
    const gl = this.gl;
    const opacity = (opts.opacity != null) ? opts.opacity : ((material.opacity != null) ? material.opacity : 1);
    const emissive = (opts.emissive != null) ? opts.emissive : ((material.emissive != null) ? material.emissive : [0, 0, 0]);
    const clip = (opts.clip != null) ? opts.clip : null;          // [nx,ny,nz,d]
    const pickMode = (opts.pickMode != null) ? opts.pickMode : false;
    const pickColor = (opts.pickColor != null) ? opts.pickColor : [1, 1, 1];

    const c = this._cache(geo);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
    gl.enableVertexAttribArray(this.loc.aPos);
    gl.vertexAttribPointer(this.loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.nbo);
    gl.enableVertexAttribArray(this.loc.aNormal);
    gl.vertexAttribPointer(this.loc.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);

    gl.uniformMatrix4fv(this.loc.uWorld, false, mat);
    gl.uniformMatrix4fv(this.loc.uProjView, false, this.projView);
    gl.uniformMatrix3fv(this.loc.uNormalMat, false, mat3InverseTranspose([
      mat[0], mat[1], mat[2], mat[4], mat[5], mat[6], mat[8], mat[9], mat[10],
    ]));
    if (pickMode) {
      gl.uniform3fv(this.loc.uColor, pickColor);
      gl.uniform1f(this.loc.uPickMode, 1);
      gl.uniform1f(this.loc.uClipOn, 0);
    } else {
      gl.uniform3fv(this.loc.uColor, material.color);
      gl.uniform3fv(this.loc.uEmissive, emissive);
      gl.uniform1f(this.loc.uOpacity, opacity);
      gl.uniform1f(this.loc.uSpec, (material.spec != null) ? material.spec : 0.5);
      gl.uniform1f(this.loc.uShininess, (material.shininess != null) ? material.shininess : 40);
      gl.uniform1f(this.loc.uPickMode, 0);
      gl.uniform3fv(this.loc.uKeyDir, this.keyDir);
      gl.uniform3fv(this.loc.uKeyCol, this.keyCol);
      gl.uniform3fv(this.loc.uFillDir, this.fillDir);
      gl.uniform3fv(this.loc.uFillCol, this.fillCol);
      gl.uniform3fv(this.loc.uCamPos, this.camPos);
      if (clip) {
        gl.uniform4fv(this.loc.uClipPlane, clip);
        gl.uniform1f(this.loc.uClipOn, 1);
      } else {
        gl.uniform1f(this.loc.uClipOn, 0);
      }
    }
    gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_SHORT, 0);
  }

  // ---- color picking ----
  _ensurePickSize() {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if (this._pickW === w && this._pickH === h) return;
    this._pickW = w; this._pickH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  beginPick() {
    const gl = this.gl;
    this._ensurePickSize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearColor(0.055, 0.065, 0.085, 1);
  }

  endPick() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  pickColor(id) {
    const b = id & 255, g = (id >> 8) & 255, r = (id >> 16) & 255;
    return [r / 255, g / 255, b / 255];
  }

  readPickId(cssX, cssY) {
    const gl = this.gl;
    const dpr = this.dpr || 1;
    const x = Math.max(0, Math.min(this.canvas.width - 1, Math.round(cssX * dpr)));
    const y = Math.max(0, Math.min(this.canvas.height - 1, Math.round((this.cssH - cssY) * dpr)));
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[0] === 0 && px[1] === 0 && px[2] === 0) return -1;
    return (px[0] << 16) | (px[1] << 8) | px[2];
  }
}
