import type { SectorBounds } from './tactical-terrain';
import { SECTOR, visionOf, type Entity, type Point } from './tactics';

/**
 * Fog of war for one commander. The grid remembers which ground the commander
 * has seen; each update repaints what their finished units and structures see now.
 * Cells hold two bytes: red is current vision, green is the darker explored memory.
 */
export const FOG_CELL = 2;
/** Dark band beyond the sector so the map edge fades out instead of ending sharply. */
export const FOG_MARGIN = 12;
/** Vision fades out over this many units past a unit's true sight radius. */
export const FOG_FEATHER = 6;
export const FOG_BOUNDS = {
  minX: SECTOR.minX - FOG_MARGIN,
  minZ: SECTOR.minZ - FOG_MARGIN,
  width: SECTOR.maxX - SECTOR.minX + FOG_MARGIN * 2,
  depth: SECTOR.maxZ - SECTOR.minZ + FOG_MARGIN * 2,
};
export const FOG_COLUMNS = Math.ceil(FOG_BOUNDS.width / FOG_CELL);
export const FOG_ROWS = Math.ceil(FOG_BOUNDS.depth / FOG_CELL);
export type Sight = 'hidden' | 'explored' | 'visible';
const sees = (e: Entity, owner: string) =>
  e.owner === owner && e.team === 'blue' && e.hp > 0 && e.readyAt === 0;

export class FogGrid {
  /** RGBA bytes laid out as a texture: row 0 is the southern edge (minZ). */
  readonly data: Uint8Array;
  readonly bounds: typeof FOG_BOUNDS;
  readonly columns: number;
  readonly rows: number;
  private readonly eyes = new Map<string, Point>();
  /** Bumped on every repaint so renderers can skip unchanged uploads. */
  version = 0;
  constructor(
    explored?: Uint8Array | null,
    readonly sector: SectorBounds = SECTOR,
  ) {
    this.columns = Math.ceil(
      (sector.maxX - sector.minX + FOG_MARGIN * 2) / FOG_CELL,
    );
    this.rows = Math.ceil(
      (sector.maxZ - sector.minZ + FOG_MARGIN * 2) / FOG_CELL,
    );
    this.bounds = {
      minX: sector.minX - FOG_MARGIN,
      minZ: sector.minZ - FOG_MARGIN,
      width: this.columns * FOG_CELL,
      depth: this.rows * FOG_CELL,
    };
    this.data = new Uint8Array(this.columns * this.rows * 4);
    if (explored) this.restore(explored);
  }
  /** Forget everything, optionally replacing the memory with a stored one. */
  reset(explored?: Uint8Array | null) {
    this.data.fill(0);
    this.eyes.clear();
    if (explored) this.restore(explored);
    this.version++;
  }
  private restore(explored: Uint8Array) {
    const n = Math.min(explored.length, this.columns * this.rows);
    for (let i = 0; i < n; i++) this.data[i * 4 + 1] = explored[i];
  }
  /** One byte per cell of explored memory, for storage. */
  explored() {
    const out = new Uint8Array(this.columns * this.rows);
    for (let i = 0; i < out.length; i++) out[i] = this.data[i * 4 + 1];
    return out;
  }
  /**
   * Repaint current vision from the commander's entities. Eyes glide toward the
   * authoritative positions so the lit area moves as smoothly as the troops do.
   */
  update(
    entities: Entity[],
    owner: string,
    dt: number,
    vision = 1,
    /** Sight that is no entity of theirs: a Firestorm's glare, recon planes overhead. */
    reveals: readonly (Point & { radius: number })[] = [],
  ) {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) d[i] = 0;
    const alive = new Set<string>();
    const ease = 1 - Math.exp(-8 * Math.max(0, dt));
    for (const e of entities) {
      if (!sees(e, owner)) continue;
      alive.add(e.id);
      let eye = this.eyes.get(e.id);
      if (!eye) {
        eye = { x: e.x, z: e.z };
        this.eyes.set(e.id, eye);
      } else {
        eye.x += (e.x - eye.x) * ease;
        eye.z += (e.z - eye.z) * ease;
      }
      this.paint(eye, visionOf(e.kind, vision));
    }
    for (const r of reveals) this.paint(r, r.radius);
    for (const id of this.eyes.keys()) if (!alive.has(id)) this.eyes.delete(id);
    for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 1]) d[i + 1] = d[i];
    this.version++;
  }
  private paint(at: Point, radius: number) {
    const reach = radius + FOG_FEATHER,
      d = this.data;
    const c0 = Math.max(
        0,
        Math.floor((at.x - reach - this.bounds.minX) / FOG_CELL),
      ),
      c1 = Math.min(
        this.columns - 1,
        Math.ceil((at.x + reach - this.bounds.minX) / FOG_CELL),
      ),
      r0 = Math.max(
        0,
        Math.floor((at.z - reach - this.bounds.minZ) / FOG_CELL),
      ),
      r1 = Math.min(
        this.rows - 1,
        Math.ceil((at.z + reach - this.bounds.minZ) / FOG_CELL),
      );
    const full = radius * radius,
      edge = reach * reach;
    for (let r = r0; r <= r1; r++) {
      const z = this.bounds.minZ + (r + 0.5) * FOG_CELL - at.z,
        zz = z * z,
        row = r * this.columns;
      for (let c = c0; c <= c1; c++) {
        const x = this.bounds.minX + (c + 0.5) * FOG_CELL - at.x;
        const dd = x * x + zz;
        if (dd >= edge) continue;
        const i = (row + c) * 4;
        // Fully lit inside the true radius; only the feather band needs a root.
        if (dd <= full) {
          d[i] = 255;
          continue;
        }
        const v = Math.round(((reach - Math.sqrt(dd)) / FOG_FEATHER) * 255);
        if (v > d[i]) d[i] = v;
      }
    }
  }
  private cell(p: Point) {
    const c = Math.floor((p.x - this.bounds.minX) / FOG_CELL),
      r = Math.floor((p.z - this.bounds.minZ) / FOG_CELL);
    if (c < 0 || r < 0 || c >= this.columns || r >= this.rows) return -1;
    return (r * this.columns + c) * 4;
  }
  /** How a point currently reads for this commander. */
  sight(p: Point): Sight {
    const i = this.cell(p);
    if (i < 0) return 'hidden';
    if (this.data[i] >= 128) return 'visible';
    return this.data[i + 1] >= 128 ? 'explored' : 'hidden';
  }
}

const STORAGE_PREFIX = 'noordheim:fog:';
const storageKey = (sectorId: string, owner: string) =>
  `${STORAGE_PREFIX}${sectorId}:${owner}`;
export function loadExplored(
  sectorId: string,
  owner: string,
  cells = FOG_COLUMNS * FOG_ROWS,
) {
  try {
    const raw = localStorage.getItem(storageKey(sectorId, owner));
    if (!raw) return null;
    const bytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
    return bytes.length === cells ? bytes : null;
  } catch {
    return null;
  }
}
export function saveExplored(sectorId: string, owner: string, fog: FogGrid) {
  try {
    let text = '';
    for (const byte of fog.explored()) text += String.fromCharCode(byte);
    // Older sectors' memories are dropped so storage holds only the live operation.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (
        key?.startsWith(STORAGE_PREFIX) &&
        key !== storageKey(sectorId, owner)
      )
        localStorage.removeItem(key);
    }
    localStorage.setItem(storageKey(sectorId, owner), btoa(text));
  } catch {
    // Storage may be unavailable; exploration then lasts for this page only.
  }
}
