// World Forge map engine: objects built from little blocks (voxels), then cut into
// horizontal slices for sprite stacking. Every object is generated in code.

import { rng } from './noise.js';

export const SLICE = 16; // each slice is a 16 × 16 pixel image

export interface ModelInfo { name: string; group: 'Nature' | 'Buildings'; slices: number; layer: number }

class Vox {
  readonly data: Uint32Array; // 0 = empty, else 0xRRGGBB + 1<<24
  constructor(readonly w: number, readonly d: number, readonly h: number) { this.data = new Uint32Array(w * d * h); }
  set(x: number, y: number, z: number, c: number): void {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.d || z >= this.h) return;
    this.data[(z * this.d + y) * this.w + x] = (c & 0xffffff) | 0x1000000;
  }
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.d || z >= this.h) return 0;
    return this.data[(z * this.d + y) * this.w + x];
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number | ((x: number, y: number, z: number) => number)): void {
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, z, typeof c === 'number' ? c : c(x, y, z));
  }
}

const shade = (c: number, f: number) => {
  const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
  return (r << 16) | (g << 8) | b;
};

function pine(r: () => number): Vox {
  const v = new Vox(11, 11, 17), cx = 5, cy = 5;
  v.box(cx, cy, 0, cx, cy, 3, 0x5b3c22);
  for (let z = 3; z < 17; z++) {
    const t = (z - 3) / 13;
    const rad = (1 - t) * 4.6 + (z % 3 === 0 ? 0.6 : 0);
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) v.set(x, y, z, d > rad - 1 && r() < 0.45 ? 0x3f7a3c : (r() < 0.15 ? 0x23502a : 0x2d5f30));
    }
  }
  return v;
}

function oak(r: () => number): Vox {
  const v = new Vox(13, 13, 14), c = 6;
  v.box(c - 1, c - 1, 0, c, c, 6, 0x6a4a2c);
  v.set(c + 1, c, 5, 0x6a4a2c); v.set(c - 2, c - 1, 6, 0x6a4a2c);
  for (let z = 5; z < 14; z++) for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
    const d = Math.hypot((x - c) / 1.0, (y - c) / 1.0, (z - 9.2) / 0.85);
    if (d < 5.6 + (r() - 0.5) * 1.1) v.set(x, y, z, r() < 0.2 ? 0x5c9440 : r() < 0.2 ? 0x356a2a : 0x46803a);
  }
  return v;
}

function birch(r: () => number): Vox {
  const v = new Vox(9, 9, 15), c = 4;
  for (let z = 0; z < 9; z++) v.set(c, c, z, z % 3 === 1 ? 0x2b2b2b : 0xe8e4da);
  for (let z = 6; z < 15; z++) for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const d = Math.hypot(x - c, y - c, (z - 10.5) / 1.3);
    if (d < 3.6 + (r() - 0.5)) v.set(x, y, z, r() < 0.3 ? 0xa9c25a : 0x84a845);
  }
  return v;
}

function bush(r: () => number): Vox {
  const v = new Vox(7, 7, 5);
  for (let z = 0; z < 5; z++) for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    if (Math.hypot(x - 3, y - 3, (z - 1) * 1.3) < 3.3 + (r() - 0.5) * 0.8) v.set(x, y, z, r() < 0.25 ? 0x6f9c43 : 0x4f7d34);
  }
  return v;
}

function rock(r: () => number): Vox {
  const v = new Vox(8, 8, 5);
  for (let z = 0; z < 5; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (Math.hypot((x - 3.5) / 1.1, y - 3.5, z * 1.25) < 3.6 + (r() - 0.5) * 1.2) v.set(x, y, z, r() < 0.3 ? 0x9a948a : 0x7c776e);
  }
  return v;
}

function deadTree(r: () => number): Vox {
  const v = new Vox(9, 9, 13), c = 4;
  const bark = 0x6b5a48;
  v.box(c, c, 0, c, c, 9, bark);
  for (let b = 0; b < 4; b++) {
    const a = r() * Math.PI * 2, z0 = 4 + Math.floor(r() * 5);
    for (let s = 1; s < 4; s++) v.set(c + Math.cos(a) * s, c + Math.sin(a) * s, z0 + s, bark);
  }
  return v;
}

function house(r: () => number): Vox {
  const v = new Vox(12, 10, 11);
  const wall = r() < 0.5 ? 0xe8dcc0 : 0xd8c8a4, timber = 0x6a4a2c, roof = r() < 0.5 ? 0x9a3b2c : 0x6d4a35;
  v.box(1, 1, 0, 10, 8, 4, (x, y, z) => (x === 1 || x === 10 || y === 1 || y === 8) && (z === 0 || z === 4 || x % 3 === 1) ? timber : wall);
  v.box(5, 1, 0, 6, 1, 2, 0x4a3020); // door
  v.set(3, 1, 2, 0x3a5a7a); v.set(8, 1, 2, 0x3a5a7a); v.set(3, 8, 2, 0x3a5a7a); v.set(8, 8, 2, 0x3a5a7a);
  for (let z = 5; z < 11; z++) {
    const inset = z - 5;
    v.box(0, inset, z, 11, 9 - inset, z, (_x, y) => (y === inset || y === 9 - inset) ? shade(roof, 0.85) : roof);
  }
  v.box(8, 6, 6, 9, 7, 10, 0x7a7068); // chimney
  return v;
}

function tower(): Vox {
  const v = new Vox(10, 10, 20), c = 4.5;
  const stone = (x: number, y: number, z: number) => ((x + y + z * 3) % 7 === 0 ? 0x8a8478 : 0xa59f92);
  for (let z = 0; z < 15; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (Math.hypot(x - c, y - c) < 4.2) v.set(x, y, z, stone(x, y, z));
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const d = Math.hypot(x - c, y - c);
    if (d < 4.9 && d > 3.6 && (Math.round(Math.atan2(y - c, x - c) * 2.5) % 2 === 0)) v.set(x, y, 15, 0xa59f92);
  }
  for (let z = 15; z < 20; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (Math.hypot(x - c, y - c) < (20 - z) * 0.85) v.set(x, y, z, 0x3c4f6e);
  v.box(4, 0, 0, 5, 0, 2, 0x4a3020);
  v.set(4, 0, 8, 0x222222); v.set(9, 4, 11, 0x222222);
  return v;
}

function keep(): Vox {
  const v = new Vox(16, 16, 16);
  const stone = (x: number, y: number, z: number) => ((x * 3 + y + z * 5) % 9 === 0 ? 0x857f73 : 0x9e988b);
  v.box(2, 2, 0, 13, 13, 11, stone);
  for (let x = 2; x <= 13; x++) for (let y = 2; y <= 13; y++) if ((x === 2 || x === 13 || y === 2 || y === 13) && (x + y) % 2 === 0) v.set(x, y, 12, 0x9e988b);
  for (const [cx, cy] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
    v.box(cx - 2, cy - 2, 0, cx + 2, cy + 2, 14, stone);
    v.box(cx - 2, cy - 2, 15, cx + 2, cy + 2, 15, (x, y) => (x + y) % 2 ? 0x9e988b : 0);
  }
  v.box(7, 2, 0, 8, 2, 3, 0x4a3020);
  v.box(6, 6, 12, 9, 9, 13, 0x9a3b2c);
  return v;
}

function windmill(): Vox {
  const v = new Vox(14, 14, 18), c = 7;
  for (let z = 0; z < 11; z++) for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (Math.hypot(x - c, y - c) < 3.4 - z * 0.12) v.set(x, y, z, 0xe2d6bc);
  for (let z = 11; z < 14; z++) for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (Math.hypot(x - c, y - c) < (14 - z) * 1.2) v.set(x, y, z, 0x7a4a32);
  const hub = 9;
  for (let s = -6; s <= 6; s++) { v.set(c + s, 3, hub, 0x7a5a3a); v.set(c, 3, hub + s * 0.0 + (s > 0 ? s : 0), 0x7a5a3a); v.set(c, 3, Math.max(0, hub + s), 0x7a5a3a); }
  v.box(c - 6, 3, hub - 1, c - 3, 3, hub - 1, 0xd8d0c0); v.box(c + 3, 3, hub + 1, c + 6, 3, hub + 1, 0xd8d0c0);
  v.box(c - 1, 3, hub + 3, c - 1, 3, hub + 6, 0xd8d0c0); v.box(c + 1, 3, hub - 6, c + 1, 3, hub - 3, 0xd8d0c0);
  v.box(6, 3, 0, 7, 3, 2, 0x4a3020);
  return v;
}

function tent(): Vox {
  const v = new Vox(9, 7, 6);
  for (let z = 0; z < 6; z++) v.box(1, 3 - (5 - z) * 0.6, z, 7, 3 + (5 - z) * 0.6, z, (x) => (x === 1 || x === 7) ? 0xa8875a : 0xc9b48a);
  v.box(4, 3, 0, 4, 3, 1, 0x3a2a1a);
  return v;
}

function ruins(r: () => number): Vox {
  const v = new Vox(14, 14, 8);
  for (let x = 1; x < 13; x++) for (let y = 1; y < 13; y++) {
    if (x !== 1 && x !== 12 && y !== 1 && y !== 12) continue;
    const top = Math.floor(r() * 7);
    for (let z = 0; z <= top; z++) v.set(x, y, z, r() < 0.2 ? 0x6f6a5f : 0x8f897c);
  }
  for (let k = 0; k < 10; k++) v.set(2 + r() * 10, 2 + r() * 10, 0, 0x8f897c);
  return v;
}

function wall(): Vox {
  const v = new Vox(10, 4, 7);
  v.box(0, 1, 0, 9, 2, 5, (x, _y, z) => ((x + z) % 5 === 0 ? 0x857f73 : 0x9e988b));
  for (let x = 0; x < 10; x += 2) v.box(x, 1, 6, x, 2, 6, 0x9e988b);
  return v;
}

function hut(r: () => number): Vox {
  const v = new Vox(9, 9, 8), c = 4;
  for (let z = 0; z < 4; z++) for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (Math.hypot(x - c, y - c) < 3.3) v.set(x, y, z, 0x8a6a46);
  for (let z = 4; z < 8; z++) for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (Math.hypot(x - c, y - c) < (8 - z) * 1.1) v.set(x, y, z, r() < 0.3 ? 0xb39a5a : 0xa48a4c);
  v.box(4, 1, 0, 4, 1, 1, 0x3a2a1a);
  return v;
}

function standingStones(): Vox {
  const v = new Vox(14, 14, 7), c = 6.5;
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2;
    const x = c + Math.cos(a) * 5, y = c + Math.sin(a) * 5;
    v.box(x, y, 0, x + 1, y, 5 + (k % 2), 0x8a8a84);
  }
  return v;
}

const BUILDERS: { name: string; group: 'Nature' | 'Buildings'; make: (r: () => number) => Vox }[] = [
  { name: 'Pine', group: 'Nature', make: pine },
  { name: 'Oak', group: 'Nature', make: oak },
  { name: 'Birch', group: 'Nature', make: birch },
  { name: 'Bush', group: 'Nature', make: bush },
  { name: 'Rock', group: 'Nature', make: rock },
  { name: 'Dead tree', group: 'Nature', make: deadTree },
  { name: 'House', group: 'Buildings', make: house },
  { name: 'Tower', group: 'Buildings', make: tower },
  { name: 'Castle keep', group: 'Buildings', make: keep },
  { name: 'Windmill', group: 'Buildings', make: windmill },
  { name: 'Tent', group: 'Buildings', make: tent },
  { name: 'Ruins', group: 'Buildings', make: ruins },
  { name: 'Wall', group: 'Buildings', make: wall },
  { name: 'Hut', group: 'Buildings', make: hut },
  { name: 'Standing stones', group: 'Nature', make: standingStones },
];
export const WALL_TYPE = 12;

// Builds every model and returns their slice images packed into one stack of 16×16 layers.
export function buildModels(): { info: ModelInfo[]; pixels: Uint8Array; layers: number } {
  const info: ModelInfo[] = [];
  const all: Uint8Array[] = [];
  BUILDERS.forEach((b, bi) => {
    const v = b.make(rng(9000 + bi));
    const ox = Math.floor((SLICE - v.w) / 2), oy = Math.floor((SLICE - v.d) / 2);
    info.push({ name: b.name, group: b.group, slices: v.h, layer: all.length });
    for (let z = 0; z < v.h; z++) {
      const img = new Uint8Array(SLICE * SLICE * 4);
      for (let y = 0; y < v.d; y++) for (let x = 0; x < v.w; x++) {
        const c = v.get(x, y, z);
        if (!c) continue;
        let f = 0.8 + 0.25 * (z / Math.max(1, v.h - 1));
        if (!v.get(x, y, z + 1)) f *= 1.1;
        if (!v.get(x - 1, y, z) || !v.get(x + 1, y, z) || !v.get(x, y - 1, z) || !v.get(x, y + 1, z)) f *= 0.9;
        const col = shade(c & 0xffffff, f);
        const p = ((y + oy) * SLICE + (x + ox)) * 4;
        img[p] = (col >> 16) & 255; img[p + 1] = (col >> 8) & 255; img[p + 2] = col & 255; img[p + 3] = 255;
      }
      all.push(img);
    }
  });
  const pixels = new Uint8Array(all.length * SLICE * SLICE * 4);
  all.forEach((img, i) => pixels.set(img, i * SLICE * SLICE * 4));
  return { info, pixels, layers: all.length };
}

export const MODEL_NAMES = BUILDERS.map(b => ({ name: b.name, group: b.group }));
