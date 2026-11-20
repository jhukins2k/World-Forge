// World Forge map engine: a map loaded into memory, plus creating new maps and detail maps.

import type { ForgeMapRecord, GenParams, MapObject, Rect } from './types.js';
import { DEFAULT_GEN } from './types.js';
import { packBytes, unpackBytes, packHeights, unpackHeights, packFloats, unpackFloats } from './codec.js';
import { generateHeights, deriveMaterials, scatterTrees, makeDetail, rasterizePaths, rasterizeAreas, columnHeights, computeShadows } from './terrain.js';

export class MapState {
  rec: ForgeMapRecord;
  n: number;
  heights: Float32Array;
  materials: Uint8Array;
  objects: MapObject[];
  overlay: Uint8Array;
  col: Float32Array;
  shadows: Float32Array;
  areaIds: Uint8Array;

  private constructor(rec: ForgeMapRecord, h: Float32Array, m: Uint8Array, o: MapObject[]) {
    this.rec = rec; this.n = rec.size; this.heights = h; this.materials = m; this.objects = o;
    this.overlay = new Uint8Array(0); this.col = new Float32Array(0); this.shadows = new Float32Array(0); this.areaIds = new Uint8Array(0);
    this.refreshPaths(); this.refreshAreas(); this.refreshColumns(); this.refreshShadows();
  }

  static async load(rec: ForgeMapRecord): Promise<MapState> {
    const n = rec.size;
    const h = await unpackHeights(rec.heights, n * n);
    let m = await unpackBytes(rec.materials);
    if (m.length !== n * n) m = new Uint8Array(n * n);
    const f = await unpackFloats(rec.objects);
    const o: MapObject[] = [];
    for (let i = 0; i + 4 < f.length; i += 5) o.push({ t: f[i], x: f[i + 1], y: f[i + 2], r: f[i + 3], s: f[i + 4] });
    return new MapState(rec, h, m, o);
  }

  get waterY(): number { return this.rec.waterLevel * this.rec.heightScale; }

  refreshPaths(): void { this.overlay = rasterizePaths(this.rec.paths, this.n); }
  refreshAreas(): void { this.areaIds = rasterizeAreas(this.rec.areas, this.n); }
  refreshColumns(): void { this.col = columnHeights(this.heights, this.n, this.rec.heightScale, this.overlay); }
  refreshShadows(): void { this.shadows = computeShadows(this.col, this.n, this.rec.sun); }

  async toRecord(): Promise<ForgeMapRecord> {
    const f = new Float32Array(this.objects.length * 5);
    this.objects.forEach((o, i) => f.set([o.t, o.x, o.y, o.r, o.s], i * 5));
    return { ...this.rec, heights: await packHeights(this.heights), materials: await packBytes(this.materials), objects: await packFloats(f) };
  }
}

export interface NewMapOptions { id: string; worldId: string; name: string; size: number; seed: number; gen?: Partial<GenParams>; order: number }

export async function createForgeMap(o: NewMapOptions): Promise<ForgeMapRecord> {
  const gen: GenParams = { ...DEFAULT_GEN, ...(o.gen || {}) };
  const heightScale = Math.round(o.size * 0.09);
  const { heights, waterLevel } = generateHeights(o.size, o.seed, gen);
  const materials = deriveMaterials(heights, o.size, waterLevel, o.seed, gen, heightScale);
  const objects = scatterTrees(heights, materials, o.size, waterLevel, o.seed, gen);
  const rec: ForgeMapRecord = {
    id: o.id, worldId: o.worldId, type: 'forge', name: o.name, parentId: null, rect: null, size: o.size, seed: o.seed,
    metersPerCell: 2000, heightScale, objScale: 1, waterLevel, gen, sun: { az: 135, el: 40 },
    heights: '', materials: '', objects: '', paths: [], areas: [], pins: [], order: o.order,
  };
  const f = new Float32Array(objects.length * 5);
  objects.forEach((ob, i) => f.set([ob.t, ob.x, ob.y, ob.r, ob.s], i * 5));
  rec.heights = await packHeights(heights); rec.materials = await packBytes(materials); rec.objects = await packFloats(f);
  return rec;
}

// Regenerates a map's landscape in place (keeping its name, links and, optionally, its lines and pins).
export async function regenerate(state: MapState, seed: number, gen: GenParams, keepMarks: boolean): Promise<void> {
  const r = state.rec, n = state.n;
  const { heights, waterLevel } = generateHeights(n, seed, gen);
  state.heights = heights;
  state.materials = deriveMaterials(heights, n, waterLevel, seed, gen, r.heightScale);
  state.objects = scatterTrees(heights, state.materials, n, waterLevel, seed, gen);
  r.seed = seed; r.gen = gen; r.waterLevel = waterLevel;
  if (!keepMarks) { r.paths = []; r.areas = []; r.pins = []; }
  state.refreshPaths(); state.refreshAreas(); state.refreshColumns(); state.refreshShadows();
}

export async function createDetailMap(parent: MapState, rect: Rect, o: { id: string; name: string; size: number; seed: number; order: number }): Promise<ForgeMapRecord> {
  const p = parent.rec;
  const d = makeDetail({ heights: parent.heights, materials: parent.materials, size: parent.n, waterLevel: p.waterLevel, gen: p.gen, seed: p.seed,
    paths: p.paths, areas: p.areas, heightScale: p.heightScale }, rect, o.size, o.seed);
  const factor = o.size / rect.w;
  const rec: ForgeMapRecord = {
    id: o.id, worldId: p.worldId, type: 'forge', name: o.name, parentId: p.id, rect, size: o.size, seed: o.seed,
    metersPerCell: p.metersPerCell / factor,
    heightScale: Math.max(4, Math.min(o.size * 0.3, p.heightScale * Math.sqrt(factor) * 1.4)),
    objScale: p.objScale, waterLevel: p.waterLevel, gen: p.gen, sun: { ...p.sun },
    heights: '', materials: '', objects: '', paths: d.paths, areas: d.areas, pins: [], order: o.order,
  };
  const f = new Float32Array(d.objects.length * 5);
  d.objects.forEach((ob, i) => f.set([ob.t, ob.x, ob.y, ob.r, ob.s], i * 5));
  rec.heights = await packHeights(d.heights); rec.materials = await packBytes(d.materials); rec.objects = await packFloats(f);
  return rec;
}
