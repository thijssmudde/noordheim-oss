import {
  MAPS,
  mapIds,
  legacyMapIds,
  DEFAULT_MAP_ID,
  isMapId,
  type MapId,
  type StoredMapId,
} from './maps';

export { mapIds, DEFAULT_MAP_ID, isMapId, type MapId, type StoredMapId };

/** The playable map for any stored id; retired ids fall back to the default map. */
export const playableMapId = (id: string | undefined | null): MapId =>
  isMapId(id) ? id : DEFAULT_MAP_ID;

/** Map art rendered by the world renderer (`/?artReview=1&attract=1&capture=1&map=<id>`). */
const ART: Record<MapId, { image: string; thumbnail: string; alt: string }> = {
  fjordmouth: {
    image: '/art/maps/fjordmouth.webp',
    thumbnail: '/art/maps/fjordmouth-card.webp',
    alt: 'Fjordmouth at golden hour: looking up the Kaldelva from the fjord, past the lighthouse, toward the bridge and a red timber landing base.',
  },
  ironpass: {
    image: '/art/maps/ironpass.webp',
    thumbnail: '/art/maps/ironpass-card.webp',
    alt: 'Iron Pass at dawn: down the Jernelva gorge between two ridges, under a timber footbridge, toward the railway pass.',
  },
  glaciercrown: {
    image: '/art/maps/glaciercrown.webp',
    thumbnail: '/art/maps/glaciercrown-card.webp',
    alt: 'Glacier Crown in a blizzard: tanks and infantry fighting over the ramps of the frozen plateau.',
  },
  skerryharbour: {
    image: '/art/maps/skerryharbour.webp',
    thumbnail: '/art/maps/skerryharbour-card.webp',
    alt: 'Skerry Harbour under an overcast sky: a fishing boat in the sound beside the harbour town, its crane and the bridges beyond.',
  },
  nordlys: {
    image: '/art/maps/nordlys.webp',
    thumbnail: '/art/maps/nordlys-card.webp',
    alt: 'Nordlys Valley at dusk under the northern lights: looking up the long river valley toward its many crossings.',
  },
};

/** Scatter assets per map for the current renderer. */
const DRESSING: Record<
  MapId,
  { trees: string[]; rocks: string[]; scrub: string; treeDensity: number }
> = {
  fjordmouth: {
    trees: ['spruce_coastal', 'spruce_windswept', 'spruce_young'],
    rocks: ['granite_1', 'granite_2'],
    scrub: 'juniper',
    treeDensity: 0.8,
  },
  ironpass: {
    trees: ['spruce_coastal', 'spruce_windswept', 'spruce_young'],
    rocks: ['granite_1', 'glacial_scree'],
    scrub: 'juniper',
    treeDensity: 0.7,
  },
  glaciercrown: {
    trees: ['spruce_windswept', 'spruce_young'],
    rocks: ['glacial_scree', 'granite_1'],
    scrub: 'juniper',
    treeDensity: 0.35,
  },
  skerryharbour: {
    trees: ['birch_amber', 'spruce_coastal', 'spruce_young'],
    rocks: ['granite_1', 'granite_2'],
    scrub: 'juniper',
    treeDensity: 0.7,
  },
  nordlys: {
    trees: ['spruce_coastal', 'spruce_windswept', 'birch_russet'],
    rocks: ['granite_1', 'granite_2'],
    scrub: 'juniper',
    treeDensity: 0.8,
  },
};

export type Battlefield = {
  name: string;
  tagline: string;
  biome: string;
  accent: string;
  description: string;
  features: string[];
  capacity: { players: number; enemies: number };
  image: string;
  thumbnail: string;
  alt: string;
  /** Legacy surface palette for the minimap and the current renderer. */
  surface: {
    snow: string;
    heath: string;
    earth: string;
    gravel: string;
    rock: string;
    shore: string;
    marsh: string;
    water: string;
    crest: string;
    sky: string;
    sun: string;
    snowCover: number;
  };
  trees: string[];
  rocks: string[];
  scrub: string;
  treeDensity: number;
};

const FIELDS = Object.fromEntries(
  mapIds.map((id) => {
    const d = MAPS[id];
    const p = d.palette;
    const field: Battlefield = {
      name: d.name,
      tagline: d.tagline,
      biome: d.biome,
      accent: d.accent,
      description: d.description,
      features: d.features,
      capacity: d.capacity,
      ...ART[id],
      surface: {
        snow: p.snow,
        heath: p.grass,
        earth: p.earth,
        gravel: p.gravel,
        rock: p.rock,
        shore: p.sand,
        marsh: p.marsh,
        water: p.deep,
        crest: p.shallow,
        sky: d.atmosphere.sky,
        sun: d.atmosphere.sun,
        snowCover: d.atmosphere.snowCover,
      },
      ...DRESSING[id],
    };
    return [id, field];
  }),
) as Record<MapId, Battlefield>;

/**
 * Cards for the five maps. Retired procedural ids resolve to the default map's
 * card so old rows still render; menus iterate `mapIds`, never these keys.
 */
export const BATTLEFIELDS: Record<StoredMapId, Battlefield> = {
  ...FIELDS,
  ...(Object.fromEntries(
    legacyMapIds.map((id) => [id, FIELDS[DEFAULT_MAP_ID]]),
  ) as Record<(typeof legacyMapIds)[number], Battlefield>),
};

/** "2 players · up to 2 enemies" */
export const capacityLabel = (id: MapId) => {
  const { players, enemies } = MAPS[id].capacity;
  return `${players} ${players === 1 ? 'player' : 'players'} · up to ${enemies} ${enemies === 1 ? 'enemy' : 'enemies'}`;
};
