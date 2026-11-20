// World Forge map engine: terrain. Generating landscapes, choosing ground types,
// scattering trees, zooming into detail maps, and working out shadows.

import { Noise, rng, hash2, smoothstep, clamp, lerp } from './noise.js';
import type { GenParams, MapObject, MapPath, MapArea, Rect, Sun } from './types.js';

export interface Material { id: number; name: string; top: [number, number, number]; side: [number, number, number] }

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const MATERIALS: Material[] = [
  { id: 0, name: 'Grass', top: hex('#6a9a3c'), side: hex('#7a5a36') },
  { id: 1, name: 'Forest floor', top: hex('#3f6d2c'), side: hex('#5e4a2e') },
  { id: 2, name: 'Sand', top: hex('#dcc88e'), side: hex('#b8a06a') },
  { id: 3, name: 'Rock', top: hex('#8d877c'), side: hex('#6c675e') },
  { id: 4, name: 'Snow', top: hex('#f0f3f5'), side: hex('#9aa3a8') },
  { id: 5, name: 'Dirt', top: hex('#8f6c45'), side: hex('#6b4f32') },
  { id: 6, name: 'Farmland', top: hex('#b19a45'), side: hex('#7a5f36') },
  { id: 7, name: 'Marsh', top: hex('#566f45'), side: hex('#4a3d2a') },
  { id: 8, name: 'Steppe', top: hex('#aea65e'), side: hex('#7f6f44') },
  { id: 9, name: 'Ash', top: hex('#5d5752'), side: hex('#45403c') },
  { id: 10, name: 'Paving', top: hex('#a29a8d'), side: hex('#7a7368') },
  { id: 11, name: 'Mud', top: hex('#6d5a40'), side: hex('#4f4030') },
];
export const MAT = { grass: 0, forest: 1, sand: 2, rock: 3, snow: 4, dirt: 5, farm: 6, marsh: 7, steppe: 8, ash: 9, paving: 10, mud: 11 };

export const OVERLAY = { none: 0, road: 1, river: 2, wall: 3 };
export const ROAD_COLOR = hex('#9b8664');
export const RIVER_COLOR = hex('#3f7499');

// ---------- generation ----------

function thermalErode(h: Float32Array, n: number, passes: number, talus: number): void {
  const tmp = new Float32Array(h.length);
  for (let p = 0; p < passes; p++) {
    tmp.set(h);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      let maxD = 0, mi = -1;
      for (const j of [i - 1, i + 1, i - n, i + n]) { const d = h[i] - h[j]; if (d > maxD) { maxD = d; mi = j; } }
      if (mi >= 0 && maxD > talus) { const move = (maxD - talus) * 0.25; tmp[i] -= move; tmp[mi] += move; }
    }
    h.set(tmp);
  }
}

export function generateHeights(n: number, seed: number, g: GenParams): { heights: Float32Array; waterLevel: number } {
  const noise = new Noise(seed), warp = new Noise(seed + 101), mtn = new Noise(seed + 202);
  const h = new Float32Array(n * n);
  const freq = (g.shape === 'islands' ? 3.2 : 2.2) * (0.8 + g.roughness * 0.6);
  const gain = 0.42 + g.roughness * 0.18;
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const nx = x / n, ny = y / n;
    const wx = nx + 0.22 * warp.fbm(nx * 2 + 5.2, ny * 2 + 1.3, 4);
    const wy = ny + 0.22 * warp.fbm(nx * 2 + 9.7, ny * 2 + 7.1, 4);
    let v = noise.fbm(wx * freq, wy * freq, 6, 2, gain) * 0.5 + 0.5;
    const mask = smoothstep(0.42, 0.72, mtn.fbm(nx * 1.4 + 3.3, ny * 1.4 + 8.8, 3) * 0.5 + 0.5);
    v += mtn.ridged(wx * freq * 1.3, wy * freq * 1.3, 5) * mask * g.mountains * 0.75;
    if (g.shape !== 'inland') {
      const dx = nx - 0.5, dy = ny - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const edge = g.shape === 'islands' ? smoothstep(0.75, 1.05, d) : smoothstep(0.5, 1.0, d);
      v = v * (1 - edge * 0.85) - edge * 0.25;
    }
    h[y * n + x] = v;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo || 1);
  thermalErode(h, n, 3, 1.6 / n);
  const sorted = Float32Array.from(h).sort();
  const waterLevel = sorted[Math.floor(clamp(1 - g.land, 0.02, 0.98) * (sorted.length - 1))];
  return { heights: h, waterLevel };
}

// Ground type from height, slope and moisture. `ox, oy, scale` place this grid in its parent's space,
// so a detail map gets the same moisture pattern as the map it zooms into.
export function deriveMaterials(h: Float32Array, n: number, wl: number, seed: number, g: GenParams, heightScale: number,
  ox = 0, oy = 0, scale = 1): Uint8Array {
  const m = new Uint8Array(n * n);
  const moistN = new Noise(seed + 303);
  const snowLine = 0.78 - g.cold * 0.4;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const v = h[i];
    const e = (v - wl) / (1 - wl || 1);
    const px = (ox + x * scale) / n, py = (oy + y * scale) / n;
    const moist = moistN.fbm(px * 3 + 11, py * 3 + 4, 4) * 0.5 + 0.5 + g.moisture;
    let slope = 0;
    if (x > 0) slope = Math.max(slope, Math.abs(v - h[i - 1]));
    if (x < n - 1) slope = Math.max(slope, Math.abs(v - h[i + 1]));
    if (y > 0) slope = Math.max(slope, Math.abs(v - h[i - n]));
    if (y < n - 1) slope = Math.max(slope, Math.abs(v - h[i + n]));
    slope *= heightScale;
    let mat = MAT.grass;
    if (v < wl) mat = e > -0.06 ? MAT.sand : MAT.mud;
    else if (e < 0.02) mat = MAT.sand;
    else if (e > snowLine + (hash2(x, y, seed) - 0.5) * 0.04) mat = MAT.snow;
    else if (slope > 1.4 || e > snowLine - 0.12) mat = MAT.rock;
    else if (e < 0.07 && moist > 0.68) mat = MAT.marsh;
    else if (moist > 0.66 - g.forests * 0.22) mat = MAT.forest;
    else if (moist < 0.34) mat = MAT.steppe;
    m[i] = mat;
  }
  return m;
}

export function scatterTrees(h: Float32Array, m: Uint8Array, n: number, wl: number, seed: number, g: GenParams, density = 1): MapObject[] {
  const r = rng(seed + 404);
  const out: MapObject[] = [];
  const cap = 9000;
  const chance = (0.18 + g.forests * 0.4) * density;
  for (let y = 0; y < n && out.length < cap; y++) for (let x = 0; x < n && out.length < cap; x++) {
    const i = y * n + x;
    if (h[i] < wl) continue;
    const e = (h[i] - wl) / (1 - wl || 1);
    const mat = m[i];
    let t = -1;
    if (mat === MAT.forest && r() < chance) t = e > 0.32 ? 0 : (r() < 0.25 ? 0 : 1);
    else if (mat === MAT.grass && r() < 0.012 * density) t = r() < 0.5 ? 1 : 3;
    else if (mat === MAT.marsh && r() < 0.05 * density) t = 5;
    else if (mat === MAT.rock && r() < 0.02 * density) t = 4;
    else if (mat === MAT.steppe && r() < 0.01 * density) t = 3;
    if (t >= 0) out.push({ t, x: x + 0.15 + r() * 0.7, y: y + 0.15 + r() * 0.7, r: r() * Math.PI * 2, s: 0.8 + r() * 0.45 });
  }
  return out;
}

// ---------- detail maps ----------

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}
export function sampleBicubic(h: Float32Array, n: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const at = (i: number, j: number) => h[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  const row = (j: number) => cubic(at(xi - 1, j), at(xi, j), at(xi + 1, j), at(xi + 2, j), tx);
  return cubic(row(yi - 1), row(yi), row(yi + 1), row(yi + 2), ty);
}

export interface DetailResult { heights: Float32Array; materials: Uint8Array; objects: MapObject[]; paths: MapPath[]; areas: MapArea[] }

export function makeDetail(parent: { heights: Float32Array; materials: Uint8Array; size: number; waterLevel: number; gen: GenParams; seed: number;
  paths: MapPath[]; areas: MapArea[]; heightScale: number }, rect: Rect, n: number, seed: number): DetailResult {
  const P = parent.size;
  const sx = rect.w / n, sy = rect.h / n;
  const detail = new Noise(seed + 505);
  const amp = 0.006 + parent.gen.roughness * 0.01;
  const h = new Float32Array(n * n);
  const m = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = rect.x + (x + 0.5) * sx - 0.5, py = rect.y + (y + 0.5) * sy - 0.5;
    let v = sampleBicubic(parent.heights, P, px, py);
    v += detail.fbm(x / n * 6, y / n * 6, 5) * amp + detail.fbm(x / n * 24, y / n * 24, 3) * amp * 0.35;
    h[y * n + x] = clamp(v, 0, 1);
    const jx = px + (detail.simplex(x * 0.15, y * 0.15) * 0.5), jy = py + (detail.simplex(y * 0.15 + 40, x * 0.15) * 0.5);
    m[y * n + x] = parent.materials[clamp(Math.round(jy), 0, P - 1) * P + clamp(Math.round(jx), 0, P - 1)];
  }
  // Coastlines get re-checked at the finer scale.
  const wl = parent.waterLevel;
  for (let i = 0; i < h.length; i++) {
    const e = (h[i] - wl) / (1 - wl || 1);
    if (h[i] < wl && m[i] !== MAT.mud) m[i] = e > -0.06 ? MAT.sand : MAT.mud;
    else if (h[i] >= wl && e < 0.012 && m[i] !== MAT.paving) m[i] = MAT.sand;
    else if (h[i] >= wl && (m[i] === MAT.mud)) m[i] = MAT.grass;
  }
  const tx = (p: [number, number]): [number, number] => [(p[0] - rect.x) / sx, (p[1] - rect.y) / sy];
  const inside = (pts: [number, number][]) => pts.some(([x, y]) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
  const paths = parent.paths.filter(p => inside(p.pts)).map(p => ({ ...p, id: p.id + '-d', pts: p.pts.map(tx), width: p.width / sx }));
  const areas = parent.areas.filter(a => inside(a.pts)).map(a => ({ ...a, id: a.id + '-d', pts: a.pts.map(tx) }));
  const objects = scatterTrees(h, m, n, wl, seed, parent.gen, 0.8);
  return { heights: h, materials: m, objects, paths, areas };
}

// ---------- derived layers ----------

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Roads and rivers become a per-cell overlay (the saved lines stay editable).
export function rasterizePaths(paths: MapPath[], n: number): Uint8Array {
  const o = new Uint8Array(n * n);
  const order: Record<string, number> = { road: 1, river: 2, wall: 3 };
  for (const p of [...paths].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (p.kind === 'wall') continue; // walls are drawn as objects
    const w = Math.max(0.5, p.width / 2);
    const val = p.kind === 'river' ? OVERLAY.river : OVERLAY.road;
    for (let k = 0; k < p.pts.length - 1; k++) {
      const [ax, ay] = p.pts[k], [bx, by] = p.pts[k + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - w - 1)), x1 = Math.min(n - 1, Math.ceil(Math.max(ax, bx) + w + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - w - 1)), y1 = Math.min(n - 1, Math.ceil(Math.max(ay, by) + w + 1));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by) <= w) o[y * n + x] = val;
      }
    }
  }
  return o;
}

// Each cell gets the number (1-based) of the area it falls in.
export function rasterizeAreas(areas: MapArea[], n: number): Uint8Array {
  const out = new Uint8Array(n * n);
  areas.slice(0, 31).forEach((a, ai) => {
    const pts = a.pts;
    if (pts.length < 3) return;
    for (let y = 0; y < n; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > cy) !== (yj > cy)) xs.push(xi + (cy - yi) / (yj - yi) * (xj - xi));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(n - 1, Math.floor(xs[k + 1] - 0.5)); x++) out[y * n + x] = ai + 1;
      }
    }
  });
  return out;
}

// Column heights, in world units, stepped so the land reads as stacked blocks.
export const STEPS_PER_UNIT = 2;
export function columnHeights(h: Float32Array, n: number, heightScale: number, overlay: Uint8Array): Float32Array {
  const c = new Float32Array(n * n);
  for (let i = 0; i < c.length; i++) {
    let v = Math.round(h[i] * heightScale * STEPS_PER_UNIT) / STEPS_PER_UNIT;
    if (overlay[i] === OVERLAY.river) v -= 1 / STEPS_PER_UNIT;
    c[i] = Math.max(0, v);
  }
  return c;
}

// Cells hidden from the sun by taller land get darker (0.55..1).
export function computeShadows(col: Float32Array, n: number, sun: Sun): Float32Array {
  const s = new Float32Array(n * n).fill(1);
  const az = sun.az * Math.PI / 180, el = Math.max(3, sun.el) * Math.PI / 180;
  const dx = Math.sin(az), dy = -Math.cos(az);
  const rise = Math.tan(el);
  const maxH = col.reduce((a, b) => Math.max(a, b), 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const base = col[y * n + x] + 0.05;
    let px = x + 0.5, py = y + 0.5, hgt = base;
    for (let step = 0; step < 160; step++) {
      px += dx * 0.7; py += dy * 0.7; hgt += rise * 0.7;
      if (hgt > maxH || px < 0 || py < 0 || px >= n || py >= n) break;
      if (col[(py | 0) * n + (px | 0)] > hgt) { s[y * n + x] = 0.55; break; }
    }
  }
  return s;
}

export const lerpColor = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
