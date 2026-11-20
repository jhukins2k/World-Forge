// World Forge map engine: the shape of a forged map.
// Coordinates: a map is a square grid of `size` × `size` cells. x runs east, y runs south.

export interface GenParams {
  land: number;        // 0..1, how much of the map is above water
  mountains: number;   // 0..1
  roughness: number;   // 0..1
  shape: 'continent' | 'islands' | 'inland';
  moisture: number;    // -0.5..0.5, drier or wetter
  cold: number;        // 0..1, lowers the snow line
  forests: number;     // 0..1, how much forest and how dense
}

export interface MapPin { id: string; x: number; y: number; entryId: string; label: string } // x, y: 0..1 across the map
export type PathKind = 'road' | 'river' | 'wall';
export interface MapPath { id: string; kind: PathKind; name: string; pts: [number, number][]; width: number } // cell coords
export interface MapArea { id: string; name: string; color: string; entryId: string; pts: [number, number][] }
export interface MapObject { t: number; x: number; y: number; r: number; s: number } // type, cell coords, rotation (rad), scale
export interface Rect { x: number; y: number; w: number; h: number }
export interface Sun { az: number; el: number } // degrees

// What gets saved (and synced). Big grids are compressed text.
export interface ForgeMapRecord {
  id: string;
  worldId: string;
  type: 'forge';
  name: string;
  parentId: string | null;
  rect: Rect | null;         // area of the parent this map zooms into, in parent cells
  size: number;
  seed: number;
  metersPerCell: number;
  heightScale: number;       // tallest possible terrain, in cells
  objScale: number;          // how big objects are drawn
  waterLevel: number;        // 0..1
  gen: GenParams;
  sun: Sun;
  heights: string;
  materials: string;
  objects: string;
  paths: MapPath[];
  areas: MapArea[];
  pins: MapPin[];
  order: number;
  [key: string]: unknown;
}

export const DEFAULT_GEN: GenParams = { land: 0.45, mountains: 0.6, roughness: 0.5, shape: 'continent', moisture: 0, cold: 0.3, forests: 0.5 };
