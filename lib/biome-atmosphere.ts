import {
  DEFAULT_MAP_ID,
  MAPS,
  legacyMapIds,
  mapIds,
  type MapId,
  type StoredMapId,
} from './maps';

export type BiomeAtmosphere = {
  sun: string;
  sky: string;
  ground: string;
  intensity: number;
  fill: number;
  /** Sun position relative to the scene centre, in metres (for directional lights). */
  direction: [number, number, number];
  wetness: number;
};

const WETNESS: Record<MapId, number> = {
  fjordmouth: 0.45,
  ironpass: 0.25,
  glaciercrown: 0.2,
  skerryharbour: 0.8,
  nordlys: 0.4,
};

/**
 * Art direction only, derived from each map's authored atmosphere; weather and
 * lighting never alter server vision or movement.
 */
const ATMOSPHERES = Object.fromEntries(
  mapIds.map((id) => {
    const a = MAPS[id].atmosphere;
    const [x, y, z] = a.sunDirection;
    const length = Math.hypot(x, y, z) || 1;
    const atmosphere: BiomeAtmosphere = {
      sun: a.sun,
      sky: a.sky,
      ground: a.bounce,
      intensity: a.sunIntensity,
      fill: a.grade === 'overcast' ? 1 : a.grade === 'dusk' ? 0.55 : 0.8,
      direction: [(x / length) * 100, (y / length) * 100, (z / length) * 100],
      wetness: WETNESS[id],
    };
    return [id, atmosphere];
  }),
) as Record<MapId, BiomeAtmosphere>;

/** Per map; retired procedural ids resolve to the default map. */
export const BIOME_ATMOSPHERE: Record<StoredMapId, BiomeAtmosphere> = {
  ...ATMOSPHERES,
  ...(Object.fromEntries(
    legacyMapIds.map((id) => [id, ATMOSPHERES[DEFAULT_MAP_ID]]),
  ) as Record<(typeof legacyMapIds)[number], BiomeAtmosphere>),
};
