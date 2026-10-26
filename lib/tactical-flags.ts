import type { Point, TerrainMap } from './tactical-terrain';

/**
 * Carry the flag. Every army (each hostile garrison and each commander) plants
 * a flag in a zone just in front of its command station. An opposing ground
 * troop that stands at the pole for PICKUP_SECONDS picks it up and must carry
 * it back into its own side's flag zone; a flag brought home that way is
 * captured, and the army that owned it collapses. A carrier that falls drops
 * the flag where it stood: the owner's troops return it with a touch, the
 * enemy may pick it up again, and an untouched flag returns by itself after
 * RETURN_SECONDS.
 */
export type FlagState = 'home' | 'carried' | 'dropped';
export type Flag = Point & {
  id: string;
  /** The army that plants and defends it: a commander id or `hostile-<n>`. */
  owner: string;
  team: 'blue' | 'red';
  name: string;
  /** Radius of the home zone around the pole (x, z when home; homeX, homeZ always). */
  radius: number;
  /** Retired zone-hold progress; always 0 on current operations. */
  progress: number;
  /** Retired: the zone-hold rule's contested marker. */
  contested?: boolean;
  capturedAt?: number;
  /** Last "under attack" alert, so the log is not flooded. */
  alertAt?: number;
  /** Where the flag is; absent on rows stored before carrying existed (at home). */
  state?: FlagState;
  /** The troop carrying the flag while `state` is 'carried'. */
  carrier?: string;
  /** The opposing troop picking the flag up, and its seconds at the pole so far. */
  pickupBy?: string;
  pickupProgress?: number;
  /** When a carrier fell and dropped it; it returns home RETURN_SECONDS later. */
  droppedAt?: number;
  /** The pole: the centre of the home zone. Absent on older rows, where x, z is home. */
  homeX?: number;
  homeZ?: number;
};

export const FLAG_RADIUS = 9;
/** A troop this close to the flag can pick it up (or, for its owner, return it). */
export const PICKUP_RADIUS = 4;
export const PICKUP_SECONDS = 2;
/** A carrier moves at this fraction of its speed. */
export const CARRIER_SPEED = 0.8;
/** A dropped flag nobody touches returns to its pole after this long. */
export const RETURN_SECONDS = 30;
/** Distance from the command station to the centre of its flag zone. */
export const FLAG_OFFSET = 22;
/** Minimum time between two "under attack" alerts for one flag. */
export const FLAG_ALERT_MS = 15000;

/** The pole, where the home zone is centred. */
export const flagHome = (f: Flag): Point => ({
  x: f.homeX ?? f.x,
  z: f.homeZ ?? f.z,
});
export const flagState = (f: Flag): FlagState => f.state ?? 'home';
/** The troop carrying a flag, if one is. */
export const carrierOf = (f: Flag) =>
  f.capturedAt === undefined && f.state === 'carried' ? f.carrier : undefined;

/** Every metre-ish sample of the zone is walkable ground. */
export function openZone(terrain: TerrainMap, p: Point, radius = FLAG_RADIUS) {
  if (!terrain.groundAt(p.x, p.z)) return false;
  for (let r = 3; r <= radius; r += 3)
    for (let a = 0; a < 12; a++) {
      const angle = (a / 12) * Math.PI * 2;
      if (
        !terrain.groundAt(
          p.x + Math.sin(angle) * r,
          p.z + Math.cos(angle) * r,
        )
      )
        return false;
    }
  return true;
}

/**
 * Where an army plants its flag: ahead of its command station along `angle`
 * (the side its production exits face), nudged sideways or nearer/farther when
 * the ground there is not open. `accept` adds caller rules (foundations, reach).
 */
export function flagSpot(
  terrain: TerrainMap,
  hq: Point,
  angle: number,
  accept: (p: Point) => boolean = () => true,
): Point | undefined {
  for (const offset of [FLAG_OFFSET, FLAG_OFFSET + 4, FLAG_OFFSET - 3, FLAG_OFFSET + 8])
    for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
      const p = {
        x: Math.round((hq.x + Math.sin(angle + turn) * offset) * 4) / 4,
        z: Math.round((hq.z + Math.cos(angle + turn) * offset) * 4) / 4,
      };
      if (openZone(terrain, p) && accept(p)) return p;
    }
  return undefined;
}

