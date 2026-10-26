import {
  isAir,
  isUnit,
  TACTICAL_UNITS,
  type Battle,
  type Entity,
  type EntityKind,
  type Point,
} from './tactics';

export type WeaponFamily =
  | 'rifle'
  | 'machine'
  | 'cannon'
  | 'rocket'
  | 'artillery';
export const WEAPON_PROFILES = {
  rifle: {
    interval: 300,
    speed: 190,
    burst: 2,
    size: 0.38,
    muzzle: 1.4,
    reach: 0.9,
    recoil: 0.045,
    sound: 'rifle',
    blast: 0,
    tracer: { width: 0.09, length: 1.7, color: [9, 6.2, 2.6] },
  },
  machine: {
    interval: 250,
    speed: 170,
    burst: 3,
    size: 0.55,
    muzzle: 1.9,
    reach: 2,
    recoil: 0.055,
    sound: 'machine',
    blast: 0,
    tracer: { width: 0.13, length: 2.4, color: [11, 7, 2.8] },
  },
  cannon: {
    interval: 1150,
    speed: 90,
    burst: 1,
    size: 1.5,
    muzzle: 2.2,
    reach: 3.3,
    recoil: 0.24,
    sound: 'cannon',
    blast: 0.75,
    tracer: { width: 0.3, length: 3.2, color: [14, 9, 3.5] },
  },
  rocket: {
    interval: 1000,
    speed: 48,
    burst: 1,
    size: 1.6,
    muzzle: 1.6,
    reach: 1,
    recoil: 0.08,
    sound: 'rocket',
    blast: 0.95,
    tracer: { width: 0.36, length: 1.3, color: [12, 6, 2] },
  },
  artillery: {
    interval: 2000,
    speed: 43,
    burst: 1,
    size: 2.5,
    muzzle: 2.1,
    reach: 2.5,
    recoil: 0.32,
    sound: 'artillery',
    blast: 1.35,
    tracer: { width: 0.32, length: 1.2, color: [10, 6, 2.4] },
  },
} as const;

export function weaponFamily(kind: EntityKind): WeaponFamily | null {
  if (['howitzer', 'mortar', 'battery'].includes(kind)) return 'artillery';
  if (['tank', 'jotun', 'bulwark'].includes(kind)) return 'cannon';
  if (kind === 'rocket') return 'rocket';
  if (
    [
      'lynx',
      'fenrir',
      'snowmobile',
      'gunship',
      'drone',
      'turret',
      'flak',
      'bunker',
    ].includes(kind)
  )
    return 'machine';
  if (isUnit(kind) && kind !== 'harvester') return 'rifle';
  return null;
}

export type ShotEvent = {
  id: string;
  family: WeaponFamily;
  from: Point;
  to: Point;
  height: number;
  targetHeight: number;
  at: number;
  seed: number;
};
type Seen = { fired: number; emitted: number };
/** Presentation consumes confirmed shots only. No damage or simulation state lives here. */
export class CombatPresentation {
  private previousTick: number | null = null;
  private identity = '';
  private seen = new Map<string, Seen>();
  update(
    battle: Battle,
    visible: (p: Point) => boolean = () => true,
  ): ShotEvent[] {
    const identity = `${battle.startedAt}:${battle.seed}:${battle.mapId}`;
    if (
      this.identity === identity &&
      this.previousTick !== null &&
      battle.tickAt <= this.previousTick
    )
      return [];
    const reset =
      this.identity !== identity ||
      this.previousTick === null ||
      battle.tickAt - this.previousTick > 3000;
    this.identity = identity;
    this.previousTick = battle.tickAt;
    if (reset) this.seen.clear();
    const shots: ShotEvent[] = [];
    const alive = new Set<string>();
    for (const e of battle.entities) {
      alive.add(e.id);
      const old = this.seen.get(e.id);
      const state = { fired: e.firedAt, emitted: old?.emitted ?? -Infinity };
      this.seen.set(e.id, state);
      const family = weaponFamily(e.kind);
      const to = { x: e.shotX, z: e.shotZ };
      if (
        reset ||
        !old ||
        !family ||
        e.hp <= 0 ||
        e.readyAt > 0 ||
        e.firedAt <= old.fired ||
        e.firedAt <= 0 ||
        e.firedAt > battle.tickAt ||
        battle.tickAt - e.firedAt > 1000
      )
        continue;
      // Dropped hidden events still advance the watermark: revealing terrain cannot replay them.
      if (
        !visible(e) ||
        !visible(to) ||
        e.firedAt - state.emitted < WEAPON_PROFILES[family].interval
      )
        continue;
      state.emitted = e.firedAt;
      if (shots.length >= 48) continue;
      const target = battle.entities.find(
        (t) => Math.hypot(t.x - to.x, t.z - to.z) < 1.5 && t.team !== e.team,
      );
      const seed =
        e.id
          .split('')
          .reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), e.firedAt) >>>
        0;
      shots.push({
        id: e.id,
        family,
        from: { x: e.x, z: e.z },
        to,
        height:
          WEAPON_PROFILES[family].muzzle +
          (isAir(e.kind) ? (e.kind === 'drone' ? 5 : 7) : 0),
        targetHeight:
          target && isAir(target.kind)
            ? target.kind === 'drone'
              ? 5
              : 7
            : target && !isUnit(target.kind)
              ? 2
              : 0.9,
        at: e.firedAt,
        seed,
      });
    }
    for (const id of this.seen.keys()) if (!alive.has(id)) this.seen.delete(id);
    return shots;
  }
}

/** Local recoil follows the same cadence as the visible weapon family. */
export function weaponRecoil(e: Entity, ageSeconds: number): number {
  const family = weaponFamily(e.kind);
  if (!family || ageSeconds < 0 || ageSeconds > 0.2) return 0;
  return (
    WEAPON_PROFILES[family].recoil *
    Math.sin((Math.PI * ageSeconds) / 0.2) *
    Math.exp(-ageSeconds * 12)
  );
}

/** Height of the shell arc for a family over a given distance (0: flat fire). */
export function shellArc(family: WeaponFamily, distance: number) {
  if (family === 'artillery') return Math.min(18, 3 + distance * 0.28);
  if (family === 'rocket') return Math.min(4, distance * 0.05);
  return 0;
}

export type Death = {
  id: string;
  kind: EntityKind;
  x: number;
  z: number;
  angle: number;
  team: Entity['team'];
  owner: string;
  category: 'infantry' | 'vehicle' | 'air' | 'structure';
};
type Known = Omit<Death, 'category'> & { alive: boolean };

/**
 * Reports each visible death once: an entity whose health reached zero, or
 * that vanished from the snapshot. A reconnect, a new battle or a long gap
 * resets the memory, so nothing replays. Entities that walk into fog are
 * still in the (unfiltered) snapshot, so they never read as deaths.
 */
export class DeathWatch {
  private identity = '';
  private tick: number | null = null;
  private known = new Map<string, Known>();
  update(battle: Battle, visible: (p: Point) => boolean = () => true): Death[] {
    const identity = `${battle.startedAt}:${battle.seed}:${battle.mapId}`;
    if (this.identity === identity && this.tick !== null && battle.tickAt <= this.tick) return [];
    const reset =
      this.identity !== identity || this.tick === null || battle.tickAt - this.tick > 3000;
    this.identity = identity;
    this.tick = battle.tickAt;
    if (reset) this.known.clear();
    const deaths: Death[] = [];
    const seen = new Set<string>();
    const report = (k: Known) => {
      if (!reset && visible(k)) deaths.push({ ...k, category: categoryOf(k.kind) });
    };
    for (const e of battle.entities) {
      seen.add(e.id);
      const old = this.known.get(e.id);
      const alive = e.hp > 0;
      const next = {
        id: e.id,
        kind: e.kind,
        x: e.x,
        z: e.z,
        angle: e.angle,
        team: e.team,
        owner: e.owner,
        alive,
      };
      if (old?.alive && !alive) report(next);
      this.known.set(e.id, next);
    }
    const vanished: Known[] = [];
    for (const [id, k] of this.known)
      if (!seen.has(id)) {
        if (k.alive) vanished.push(k);
        this.known.delete(id);
      }
    // A mass disappearance is a replaced snapshot (a fixture, a restore), not a battle.
    if (vanished.length <= Math.max(12, battle.entities.length * 0.5))
      for (const k of vanished) report(k);
    return deaths;
  }
}

function categoryOf(kind: EntityKind): Death['category'] {
  if (!isUnit(kind)) return 'structure';
  if (isAir(kind)) return 'air';
  return TACTICAL_UNITS[kind].category === 'infantry' ? 'infantry' : 'vehicle';
}
