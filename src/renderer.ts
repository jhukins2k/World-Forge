// World Forge map engine: the pixel renderer. Draws the world at a low resolution with WebGL,
// then scales it up with hard edges so everything stays crisp, retro pixel art.

import { Camera, type Mat4 } from './camera.js';
import { MATERIALS, OVERLAY, ROAD_COLOR, RIVER_COLOR } from './terrain.js';
import { buildModels, SLICE, WALL_TYPE, type ModelInfo } from './models.js';
import { hash2 } from './noise.js';
import type { MapObject, MapPath } from './types.js';

const CH = 32;              // cells per chunk side
const SKIRT = -2;           // depth of the "diorama" block under the map edge
const FLOATS = 10;          // pos3 nrm3 col3 shade1

export interface TerrainInput {
  n: number;
  col: Float32Array;        // column heights (world units)
  materials: Uint8Array;
  overlay: Uint8Array;
  shadows: Float32Array;
  areaIds: Uint8Array;
  areaColors: string[];
  waterY: number;
  seed: number;
}

export interface RenderOptions {
  time: number;
  sunDir: [number, number, number];
  brush: { x: number; z: number; r: number } | null;
  retro: boolean;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  return p;
}

const TERRAIN_VS = `#version 300 es
in vec3 a_pos; in vec3 a_nrm; in vec3 a_col; in float a_shade;
uniform mat4 u_vp;
out vec3 v_col; out vec3 v_nrm; out float v_shade; out vec3 v_world;
void main() { v_col = a_col; v_nrm = a_nrm; v_shade = a_shade; v_world = a_pos; gl_Position = u_vp * vec4(a_pos, 1.0); }`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 v_col; in vec3 v_nrm; in float v_shade; in vec3 v_world;
uniform vec3 u_sun; uniform float u_amb; uniform float u_n;
uniform sampler2D u_area; uniform vec4 u_areaCol[32];
uniform vec4 u_brush;
out vec4 o;
float areaAt(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= u_n || cell.y >= u_n) return 0.0;
  return floor(texture(u_area, (cell + 0.5) / u_n).r * 255.0 + 0.5);
}
void main() {
  vec3 n = normalize(v_nrm);
  float diff = max(dot(n, u_sun), 0.0);
  vec3 c = v_col * (u_amb + (1.0 - u_amb) * diff * v_shade);
  if (n.y > 0.5) {
    vec2 cell = floor(v_world.xz);
    float id = areaAt(cell);
    if (id > 0.0) {
      vec4 ac = u_areaCol[int(id)];
      c = mix(c, ac.rgb, 0.2);
      vec2 f = fract(v_world.xz);
      bool edge = (f.x < 0.2 && areaAt(cell - vec2(1.0, 0.0)) != id) || (f.x > 0.8 && areaAt(cell + vec2(1.0, 0.0)) != id)
               || (f.y < 0.2 && areaAt(cell - vec2(0.0, 1.0)) != id) || (f.y > 0.8 && areaAt(cell + vec2(0.0, 1.0)) != id);
      if (edge) c = mix(c, ac.rgb * 0.9, 0.85);
    }
  }
  if (u_brush.w > 0.5) {
    float d = distance(v_world.xz, u_brush.xy);
    if (abs(d - u_brush.z) < 0.3 + u_brush.z * 0.03) c = mix(c, vec3(1.0, 0.92, 0.6), 0.75);
  }
  o = vec4(c, 1.0);
}`;

const WATER_VS = `#version 300 es
in vec3 a_pos;
uniform mat4 u_vp;
out vec3 v_world;
void main() { v_world = a_pos; gl_Position = u_vp * vec4(a_pos, 1.0); }`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 v_world;
uniform sampler2D u_height; uniform float u_n; uniform float u_waterY; uniform float u_time; uniform float u_light;
out vec4 o;
void main() {
  bool side = v_world.y < u_waterY - 0.01;
  float th = side ? -10.0 : texture(u_height, v_world.xz / u_n).r;
  float depth = u_waterY - th;
  if (!side && depth <= 0.0) discard;
  vec3 shallow = vec3(0.32, 0.58, 0.64), deep = vec3(0.10, 0.23, 0.38);
  vec3 c = mix(shallow, deep, clamp(depth / 5.0, 0.0, 1.0));
  if (!side) {
    vec2 p = floor(v_world.xz * 2.0) / 2.0;
    float s = sin(p.x * 1.7 + u_time * 1.2) * sin(p.y * 1.3 - u_time * 0.9);
    c += step(0.86, s) * 0.10;
    c = mix(c, vec3(0.86, 0.92, 0.92), step(depth, 0.3) * 0.55);
  } else {
    c *= 0.6;
  }
  o = vec4(c * u_light, side ? 0.95 : 0.82);
}`;

const OBJ_VS = `#version 300 es
in vec2 a_corner;
in vec4 a_inst;   // x, y, z, rotation
in vec3 a_inst2;  // size, layer, shade
uniform mat4 u_vp;
out vec3 v_uvl; out float v_shade;
void main() {
  float c = cos(a_inst.w), s = sin(a_inst.w);
  vec2 p = vec2(a_corner.x * c - a_corner.y * s, a_corner.x * s + a_corner.y * c) * a_inst2.x;
  v_uvl = vec3(a_corner + 0.5, a_inst2.y);
  v_shade = a_inst2.z;
  gl_Position = u_vp * vec4(a_inst.x + p.x, a_inst.y, a_inst.z + p.y, 1.0);
}`;

const OBJ_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 v_uvl; in float v_shade;
uniform sampler2DArray u_tex; uniform float u_amb; uniform float u_sunk;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uvl);
  if (t.a < 0.5) discard;
  o = vec4(t.rgb * (u_amb + (1.0 - u_amb) * u_sunk * v_shade), 1.0);
}`;

const POST_VS = `#version 300 es
out vec2 v_uv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const POST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_img; uniform float u_retro; uniform vec2 u_res;
out vec4 o;
const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  vec3 c = texture(u_img, v_uv).rgb;
  if (u_retro > 0.5) {
    ivec2 p = ivec2(floor(v_uv * u_res)) & 3;
    float d = (B[p.y * 4 + p.x] / 16.0 - 0.5) / 10.0;
    c = floor((c + d) * 10.0 + 0.5) / 10.0;
  }
  o = vec4(c, 1.0);
}`;

interface Chunk { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly models: ModelInfo[];
  pixelScale = 3;
  fbW = 1; fbH = 1;
  private terrainProg: WebGLProgram; private waterProg: WebGLProgram; private objProg: WebGLProgram; private postProg: WebGLProgram;
  private chunks = new Map<number, Chunk>();
  private data: TerrainInput | null = null;
  private fb: WebGLFramebuffer; private fbTex: WebGLTexture; private fbDepth: WebGLRenderbuffer;
  private heightTex: WebGLTexture; private areaTex: WebGLTexture; private modelTex: WebGLTexture;
  private waterVao: WebGLVertexArrayObject; private waterVbo: WebGLBuffer; private waterCount = 0;
  private objVao: WebGLVertexArrayObject; private objInst: WebGLBuffer; private objCount = 0;
  private postVao: WebGLVertexArrayObject;
  private loc = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This browser cannot draw forged maps (WebGL 2 is not available).');
    this.gl = gl;
    this.terrainProg = compile(gl, TERRAIN_VS, TERRAIN_FS);
    this.waterProg = compile(gl, WATER_VS, WATER_FS);
    this.objProg = compile(gl, OBJ_VS, OBJ_FS);
    this.postProg = compile(gl, POST_VS, POST_FS);

    this.fb = gl.createFramebuffer()!; this.fbTex = gl.createTexture()!; this.fbDepth = gl.createRenderbuffer()!;
    this.heightTex = this.makeTex(); this.areaTex = this.makeTex();

    // Object slices: one stack of 16×16 layers.
    const m = buildModels();
    this.models = m.info;
    this.modelTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.modelTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, SLICE, SLICE, m.layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.pixels);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.waterVao = gl.createVertexArray()!; this.waterVbo = gl.createBuffer()!;
    this.objVao = gl.createVertexArray()!; this.objInst = gl.createBuffer()!;
    gl.bindVertexArray(this.objVao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    const aC = gl.getAttribLocation(this.objProg, 'a_corner');
    gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.objInst);
    const a1 = gl.getAttribLocation(this.objProg, 'a_inst'), a2 = gl.getAttribLocation(this.objProg, 'a_inst2');
    gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 4, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(a1, 1);
    gl.enableVertexAttribArray(a2); gl.vertexAttribPointer(a2, 3, gl.FLOAT, false, 28, 16); gl.vertexAttribDivisor(a2, 1);
    this.postVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private u(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = (p === this.terrainProg ? 't' : p === this.waterProg ? 'w' : p === this.objProg ? 'o' : 'p') + name;
    if (!this.loc.has(key)) this.loc.set(key, this.gl.getUniformLocation(p, name));
    return this.loc.get(key)!;
  }

  resize(): void {
    const gl = this.gl, c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(c.clientWidth * dpr)), chh = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== cw || c.height !== chh) { c.width = cw; c.height = chh; }
    const w = Math.max(1, Math.floor(c.clientWidth / this.pixelScale)), h = Math.max(1, Math.floor(c.clientHeight / this.pixelScale));
    if (w === this.fbW && h === this.fbH) return;
    this.fbW = w; this.fbH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.fbTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fbDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fbDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------- terrain ----------

  setTerrain(d: TerrainInput): void {
    const gl = this.gl;
    for (const c of this.chunks.values()) { gl.deleteVertexArray(c.vao); gl.deleteBuffer(c.vbo); gl.deleteBuffer(c.ibo); }
    this.chunks.clear();
    this.data = d;
    const per = Math.ceil(d.n / CH);
    for (let cj = 0; cj < per; cj++) for (let ci = 0; ci < per; ci++) this.buildChunk(ci, cj);
    this.uploadHeightTex();
    this.uploadAreas();
    this.buildWater();
  }

  // Rebuild only the chunks touching a block of cells.
  updateCells(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.data) return;
    const per = Math.ceil(this.data.n / CH);
    for (let cj = Math.max(0, Math.floor((y0 - 1) / CH)); cj <= Math.min(per - 1, Math.floor((y1 + 1) / CH)); cj++)
      for (let ci = Math.max(0, Math.floor((x0 - 1) / CH)); ci <= Math.min(per - 1, Math.floor((x1 + 1) / CH)); ci++) this.buildChunk(ci, cj);
    this.uploadHeightTex();
  }

  uploadAreas(): void {
    if (!this.data) return;
    const gl = this.gl, d = this.data;
    gl.bindTexture(gl.TEXTURE_2D, this.areaTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, d.n, d.n, 0, gl.RED, gl.UNSIGNED_BYTE, d.areaIds);
  }

  private uploadHeightTex(): void {
    if (!this.data) return;
    const gl = this.gl, d = this.data;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, d.n, d.n, 0, gl.RED, gl.FLOAT, d.col);
  }

  setWater(y: number): void { if (this.data) { this.data.waterY = y; this.buildWater(); } }

  private buildWater(): void {
    if (!this.data) return;
    const gl = this.gl, n = this.data.n, y = this.data.waterY, b = SKIRT;
    const v = [0, y, 0, n, y, 0, n, y, n, 0, y, 0, n, y, n, 0, y, n,
      0, b, 0, n, b, 0, n, y, 0, 0, b, 0, n, y, 0, 0, y, 0,
      0, b, n, n, b, n, n, y, n, 0, b, n, n, y, n, 0, y, n,
      0, b, 0, 0, b, n, 0, y, n, 0, b, 0, 0, y, n, 0, y, 0,
      n, b, 0, n, b, n, n, y, n, n, b, 0, n, y, n, n, y, 0];
    gl.bindVertexArray(this.waterVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waterVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(this.waterProg, 'a_pos');
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.waterCount = v.length / 3;
  }

  private topColor(i: number, j: number): [number, number, number] {
    const d = this.data!, idx = j * d.n + i;
    const ov = d.overlay[idx];
    let c: [number, number, number] = ov === OVERLAY.road ? ROAD_COLOR : ov === OVERLAY.river ? RIVER_COLOR : MATERIALS[d.materials[idx]]?.top ?? MATERIALS[0].top;
    const k = 0.93 + hash2(i, j, d.seed) * 0.12;
    const under = d.col[idx] < d.waterY ? 0.85 : 1;
    return [c[0] * k * under, c[1] * k * under, c[2] * k * under];
  }

  private buildChunk(ci: number, cj: number): void {
    const gl = this.gl, d = this.data!, n = d.n;
    const verts: number[] = [], idx: number[] = [];
    const quad = (p: number[][], nrm: number[], col: number[], shade: number) => {
      const base = verts.length / FLOATS;
      for (const q of p) verts.push(q[0], q[1], q[2], nrm[0], nrm[1], nrm[2], col[0], col[1], col[2], shade);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const H = (i: number, j: number) => (i < 0 || j < 0 || i >= n || j >= n) ? SKIRT : d.col[j * n + i];
    for (let j = cj * CH; j < Math.min(n, (cj + 1) * CH); j++) for (let i = ci * CH; i < Math.min(n, (ci + 1) * CH); i++) {
      const k = j * n + i, h = d.col[k];
      const top = this.topColor(i, j);
      quad([[i, h, j], [i, h, j + 1], [i + 1, h, j + 1], [i + 1, h, j]], [0, 1, 0], top, d.shadows[k]);
      const mat = MATERIALS[d.materials[k]] ?? MATERIALS[0];
      const sideC = d.overlay[k] === OVERLAY.river ? RIVER_COLOR : mat.side;
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      const sides: [number, number, number[], (a: number, b: number) => number[][]][] = [
        [i - 1, j, [-1, 0, 0], (lo, hi) => [[i, lo, j + 1], [i, hi, j + 1], [i, hi, j], [i, lo, j]]],
        [i + 1, j, [1, 0, 0], (lo, hi) => [[i + 1, lo, j], [i + 1, hi, j], [i + 1, hi, j + 1], [i + 1, lo, j + 1]]],
        [i, j - 1, [0, 0, -1], (lo, hi) => [[i, lo, j], [i, hi, j], [i + 1, hi, j], [i + 1, lo, j]]],
        [i, j + 1, [0, 0, 1], (lo, hi) => [[i + 1, lo, j + 1], [i + 1, hi, j + 1], [i, hi, j + 1], [i, lo, j + 1]]],
      ];
      for (const [ni, nj, nrm, face] of sides) {
        const nh = H(ni, nj);
        if (nh >= h) continue;
        const lip = Math.min(0.25, h - nh);
        const dark = edge && nh === SKIRT ? 0.75 : 1;
        quad(face(h - lip, h), nrm, [top[0] * 0.9, top[1] * 0.9, top[2] * 0.9], 1);
        if (h - lip > nh) quad(face(nh, h - lip), nrm, [sideC[0] * dark, sideC[1] * dark, sideC[2] * dark], 1);
      }
    }
    const key = cj * 1000 + ci;
    let c = this.chunks.get(key);
    if (!c) {
      c = { vao: gl.createVertexArray()!, vbo: gl.createBuffer()!, ibo: gl.createBuffer()!, count: 0 };
      gl.bindVertexArray(c.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
      const S = FLOATS * 4;
      const attr = (name: string, size: number, off: number) => {
        const a = gl.getAttribLocation(this.terrainProg, name);
        gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, S, off * 4);
      };
      attr('a_pos', 3, 0); attr('a_nrm', 3, 3); attr('a_col', 3, 6); attr('a_shade', 1, 9);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);
      gl.bindVertexArray(null);
      this.chunks.set(key, c);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(c.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    c.count = idx.length;
  }

  // ---------- objects ----------

  setObjects(objects: MapObject[], paths: MapPath[], objScale: number): void {
    if (!this.data) return;
    const d = this.data, n = d.n, vox = objScale / 8;
    const all: MapObject[] = [...objects];
    for (const p of paths) {
      if (p.kind !== 'wall') continue;
      const seg = 10 * vox;
      for (let k = 0; k < p.pts.length - 1; k++) {
        const [ax, ay] = p.pts[k], [bx, by] = p.pts[k + 1];
        const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.round(len / seg));
        const rot = Math.atan2(by - ay, bx - ax);
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          all.push({ t: WALL_TYPE, x: ax + (bx - ax) * t, y: ay + (by - ay) * t, r: rot, s: len / steps / seg });
        }
      }
    }
    const inst: number[] = [];
    for (const o of all) {
      const m = this.models[o.t];
      if (!m) continue;
      const ci = Math.min(n - 1, Math.max(0, Math.floor(o.x))), cj = Math.min(n - 1, Math.max(0, Math.floor(o.y)));
      const base = d.col[cj * n + ci];
      if (base < d.waterY - 0.01 && o.t !== WALL_TYPE) continue;
      const shade = d.shadows[cj * n + ci];
      const sizeX = SLICE * vox * o.s;
      for (let z = 0; z < m.slices; z++) {
        for (const sub of [0, 0.5]) inst.push(o.x, base + (z + sub) * vox * (o.t === WALL_TYPE ? 1 : o.s), o.y, o.r, sizeX, m.layer + z, shade);
      }
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.objInst);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.DYNAMIC_DRAW);
    this.objCount = inst.length / 7;
  }

  // ---------- drawing ----------

  render(cam: Camera, o: RenderOptions): Mat4 {
    const gl = this.gl, d = this.data;
    this.resize();
    const vp = cam.viewProj(this.fbW, this.fbH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.fbW, this.fbH);
    gl.clearColor(0.085, 0.063, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    const amb = 0.5;
    const sunk = Math.max(0.15, o.sunDir[1]);
    if (d) {
      gl.useProgram(this.terrainProg);
      gl.uniformMatrix4fv(this.u(this.terrainProg, 'u_vp'), false, vp);
      gl.uniform3fv(this.u(this.terrainProg, 'u_sun'), o.sunDir);
      gl.uniform1f(this.u(this.terrainProg, 'u_amb'), amb);
      gl.uniform1f(this.u(this.terrainProg, 'u_n'), d.n);
      const cols = new Float32Array(32 * 4);
      d.areaColors.forEach((hex, i) => {
        if (i >= 31) return;
        cols.set([parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1], (i + 1) * 4);
      });
      gl.uniform4fv(this.u(this.terrainProg, 'u_areaCol[0]'), cols);
      gl.uniform4f(this.u(this.terrainProg, 'u_brush'), o.brush?.x ?? 0, o.brush?.z ?? 0, o.brush?.r ?? 0, o.brush ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.areaTex);
      gl.uniform1i(this.u(this.terrainProg, 'u_area'), 0);
      for (const c of this.chunks.values()) { gl.bindVertexArray(c.vao); gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0); }

      if (this.objCount) {
        gl.disable(gl.CULL_FACE);
        gl.useProgram(this.objProg);
        gl.uniformMatrix4fv(this.u(this.objProg, 'u_vp'), false, vp);
        gl.uniform1f(this.u(this.objProg, 'u_amb'), amb + 0.1);
        gl.uniform1f(this.u(this.objProg, 'u_sunk'), sunk);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.modelTex);
        gl.uniform1i(this.u(this.objProg, 'u_tex'), 1);
        gl.bindVertexArray(this.objVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.objCount);
      }

      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.waterProg);
      gl.uniformMatrix4fv(this.u(this.waterProg, 'u_vp'), false, vp);
      gl.uniform1f(this.u(this.waterProg, 'u_n'), d.n);
      gl.uniform1f(this.u(this.waterProg, 'u_waterY'), d.waterY);
      gl.uniform1f(this.u(this.waterProg, 'u_time'), o.time);
      gl.uniform1f(this.u(this.waterProg, 'u_light'), amb + (1 - amb) * sunk);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.uniform1i(this.u(this.waterProg, 'u_height'), 2);
      gl.bindVertexArray(this.waterVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.waterCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.postProg);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.fbTex);
    gl.uniform1i(this.u(this.postProg, 'u_img'), 3);
    gl.uniform1f(this.u(this.postProg, 'u_retro'), o.retro ? 1 : 0);
    gl.uniform2f(this.u(this.postProg, 'u_res'), this.fbW, this.fbH);
    gl.bindVertexArray(this.postVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return vp;
  }

  // Where a screen point (CSS pixels within the canvas) meets the ground.
  pick(cam: Camera, cssX: number, cssY: number): { x: number; y: number; z: number } | null {
    const d = this.data;
    if (!d) return null;
    const { o, d: dir } = cam.ray(cssX / this.pixelScale, cssY / this.pixelScale, this.fbW, this.fbH);
    let maxH = d.waterY;
    for (let i = 0; i < d.col.length; i += 7) maxH = Math.max(maxH, d.col[i]);
    maxH += 2;
    if (dir[1] >= 0) return null;
    let t = (o[1] - maxH) / -dir[1];
    for (let step = 0; step < 4000; step++, t += 0.2) {
      const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t, z = o[2] + dir[2] * t;
      if (y < SKIRT) return null;
      const inside = x >= 0 && z >= 0 && x < d.n && z < d.n;
      if (inside) {
        const ground = Math.max(d.col[Math.floor(z) * d.n + Math.floor(x)], d.waterY);
        if (y <= ground) return { x, y: ground, z };
      }
    }
    return null;
  }

  destroy(): void {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}
