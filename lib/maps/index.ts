import { compileMap, type CompiledMapWithGrid } from './compile';
import { fjordmouth } from './fjordmouth';
import { ironpass } from './ironpass';
import { glaciercrown } from './glaciercrown';
import { skerryharbour } from './skerryharbour';
import { nordlys } from './nordlys';
import { mapIds, type MapDesign, type MapId } from './types';

export * from './types';
export {
  compileMap,
  TERRAIN_SPEED,
  TERRAIN_CODES,
  BUILDABLE_TERRAIN,
  HOME_ORE_OFFSET,
  type CompiledMapWithGrid,
} from './compile';

export const DEFAULT_MAP_ID: MapId = 'fjordmouth';

/** Authored designs by id. */
export const MAPS: Record<MapId, MapDesign> = {
  fjordmouth,
  ironpass,
  glaciercrown,
  skerryharbour,
  nordlys,
};

export const isMapId = (id: unknown): id is MapId =>
  typeof id === 'string' && (mapIds as readonly string[]).includes(id);

const compiled = new Map<MapId, CompiledMapWithGrid>();
/** The compiled map for an id, cached at module level (one per map). Unknown ids fall back to the default map. */
export function mapFor(id: string | undefined): CompiledMapWithGrid {
  const key = isMapId(id) ? id : DEFAULT_MAP_ID;
  let map = compiled.get(key);
  if (!map) {
    map = compileMap(MAPS[key]);
    compiled.set(key, map);
  }
  return map;
}
