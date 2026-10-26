import {
  CREDIT_CAP,
  SUPERWEAPON_HQ_CAP,
  SUPERWEAPON_WARNING_SECONDS,
  SUPERWEAPONS,
  TACTICAL_BUILDINGS,
  battleHasRoom,
  categoryOf,
  commandLimit,
  commanderEliminated,
  distance,
  fieldCount,
  isUnit,
  logEvent,
  makeEntity,
  movementObstacles,
  SITE_CLEARANCE,
  siteFootprint,
  spec,
  visionOf,
  visionScaleFor,
  type Battle,
  type BuildingKind,
  type Entity,
  type Point,
  type UnitKind,
} from './tactics';
import { crossingBounds, insideSector, terrainFor } from './tactical-terrain';
import { difficultyFor } from './tactical-difficulty';
import {
  footprint,
  footprintSamples,
  footprintsOverlap,
  hasExit,
  insideFootprint,
  ORE_CLEARANCE,
  productionExit,
} from './tactical-placement';
import { FLAG_RADIUS } from './tactical-flags';
import type { VoiceCue } from './audio-policy';

/**
 * Superweapons. Each faction raises one Tier 3 structure whose weapon charges
 * while its owner's grid holds, and the garrison raises a Weather Mast beside
 * every command station. Charge records and strikes live on the battle outside
 * the fog, so every commander sees every countdown and every telegraph ring.
 *
 * Nothing here runs at module load: lib/tactics.ts imports these rules and
 * they import its helpers back.
 */
export type SuperweaponKind = keyof typeof SUPERWEAPONS;
/** A completed superweapon structure and its charge. */
export type SuperweaponCharge = Point & {
  /** The structure's entity id. */
  id: string;
  owner: string;
  team: Entity['team'];
  kind: SuperweaponKind;
  /** Milliseconds of charge accumulated; ready at `chargeMs`. */
  charge: number;
  /** Charging halted: the owner's grid is short of power. */
  paused?: boolean;
  /** The one-minute warning has gone out for this charge. */
  warned?: boolean;
};
/** A launched weapon: telegraphed until `impactAt`, lingering until `until`. */
export type Strike = Point & {
  id: string;
  owner: string;
  team: Entity['team'];
  kind: SuperweaponKind;
  radius: number;
  launchedAt: number;
  impactAt: number;
  until: number;
  landed?: boolean;
  /** Superweapon damage each command station has taken from this strike. */
  struck?: { id: string; damage: number }[];
};

export const isSuperweapon = (kind: string): kind is SuperweaponKind =>
  kind in SUPERWEAPONS;
/** The superweapon structure a faction raises. */
export const superweaponOf = (culture: string): SuperweaponKind | undefined =>
  (Object.keys(SUPERWEAPONS) as SuperweaponKind[]).find(
    (k) => (TACTICAL_BUILDINGS[k] as { faction?: string }).faction === culture,
  );
export const weaponName = (kind: SuperweaponKind) => SUPERWEAPONS[kind].weapon;
/** Full charge in milliseconds; the Weather Mast's depends on the difficulty. */
export function chargeMs(b: Pick<Battle, 'difficulty'>, kind: SuperweaponKind) {
  return kind === 'weathermast'
    ? difficultyFor(b).mastSeconds * 1000
    : SUPERWEAPONS[kind].chargeSeconds * 1000;
}
export const isReady = (b: Pick<Battle, 'difficulty'>, s: SuperweaponCharge) =>
  s.charge >= chargeMs(b, s.kind);
/**
 * Milliseconds until a weapon is ready, as a client sees it at `now`: the
 * last tick's charge keeps running between snapshots unless it is paused,
 * so countdowns derive from the clock instead of per-tick state.
 */
export function chargeRemaining(
  b: Pick<Battle, 'difficulty' | 'tickAt'>,
  s: SuperweaponCharge,
  now = b.tickAt,
) {
  const left = chargeMs(b, s.kind) - s.charge;
  if (left <= 0) return 0;
  return Math.max(0, left - (s.paused ? 0 : Math.max(0, now - b.tickAt)));
}
/** "Raven 07's Mountain Gun" or "Hostile Weather Mast". */
export function weaponLabel(
  b: Pick<Battle, 'commanders'>,
  s: Pick<SuperweaponCharge, 'owner' | 'team' | 'kind'>,
) {
  if (s.team === 'red') return `Hostile ${TACTICAL_BUILDINGS.weathermast.name}`;
  const name = b.commanders.find((c) => c.id === s.owner)?.name;
  return name ? `${name}'s ${weaponName(s.kind)}` : weaponName(s.kind);
}
/** Why a commander cannot raise this structure, or null. One superweapon per commander. */
export function superweaponLock(
  b: Pick<Battle, 'entities'>,
  owner: string,
  kind: string,
): string | null {
  if (kind === 'weathermast') return 'Raised only by the garrison';
  if (!isSuperweapon(kind)) return null;
  return b.entities.some(
    (e) => e.owner === owner && e.hp > 0 && isSuperweapon(e.kind),
  )
    ? 'One superweapon per commander'
    : null;
}

// ---------------------------------------------------------------- strike state
const burning = (s: Strike, now: number) =>
  s.kind === 'launcher' &&
  !!s.landed &&
  now < s.impactAt + SUPERWEAPONS.launcher.burnSeconds * 1000;
const revealing = (s: Strike, now: number) =>
  s.kind === 'launcher' &&
  !!s.landed &&
  now < s.impactAt + SUPERWEAPONS.launcher.revealSeconds * 1000;
/** Whether a Firestorm on the coalition's side lights this point up for `team`. */
export function revealed(
  b: { strikes?: Strike[]; tickAt: number },
  p: Point,
  team: Entity['team'] = 'blue',
) {
  return !!b.strikes?.some(
    (s) =>
      s.team === team &&
      revealing(s, b.tickAt) &&
      distance(s, p) <= SUPERWEAPONS.launcher.revealRadius,
  );
}
/** Areas a Firestorm currently reveals to the coalition, for the fog of war. */
export const revealAreas = (b: { strikes?: Strike[]; tickAt: number }) =>
  (b.strikes ?? [])
    .filter((s) => s.team === 'blue' && revealing(s, b.tickAt))
    .map((s) => ({
      x: s.x,
      z: s.z,
      radius: SUPERWEAPONS.launcher.revealRadius,
    }));
type Moving = {
  kind: Entity['kind'];
  team?: Entity['team'];
  x?: number;
  z?: number;
  boostUntil?: number;
};
/** Speed multiplier from superweapons: a Winter Convoy's boost, a Firestorm underfoot. */
export function strikeSpeed(
  b: { strikes?: Strike[]; tickAt?: number },
  e: Moving,
) {
  const now = b.tickAt ?? 0;
  let scale = (e.boostUntil ?? 0) > now ? SUPERWEAPONS.airstrip.boost : 1;
  if (
    e.x !== undefined &&
    e.z !== undefined &&
    isUnit(e.kind) &&
    categoryOf(e.kind) === 'infantry' &&
    b.strikes?.some(
      (s) =>
        s.team !== e.team &&
        burning(s, now) &&
        distance(s, { x: e.x!, z: e.z! }) <= s.radius,
    )
  )
    scale *= SUPERWEAPONS.launcher.infantrySlow;
  return scale;
}
/** Damage multiplier from superweapons: a convoy's fire-rate boost, a raiding veteran's edge. */
export function strikeDamage(
  b: { tickAt?: number },
  attacker: Pick<Entity, 'boostUntil' | 'veteran'>,
  target: Pick<Entity, 'veteran'>,
) {
  let scale = 1;
  if ((attacker.boostUntil ?? 0) > (b.tickAt ?? 0))
    scale *= SUPERWEAPONS.airstrip.boost;
  if (attacker.veteran) scale *= SUPERWEAPONS.boathouse.veteranDamage;
  if (target.veteran) scale *= SUPERWEAPONS.boathouse.veteranArmor;
  return scale;
}
/** Frozen by a blizzard: neither moves nor fires. */
export const frozen = (e: Pick<Entity, 'frozenUntil'>, now: number) =>
  (e.frozenUntil ?? 0) > now;

// ---------------------------------------------------------------- targeting
/** Ironclad commanders remember scouted ground on this grid (metres per cell). */
export const SCOUT_CELL = 8;
const SCOUT_EVERY_MS = 2000;
function scoutGrid(b: Pick<Battle, 'mapId' | 'mapVersion' | 'seed'>) {
  const bounds = terrainFor(b).bounds;
  return {
    bounds,
    columns: Math.ceil((bounds.maxX - bounds.minX) / SCOUT_CELL),
    rows: Math.ceil((bounds.maxZ - bounds.minZ) / SCOUT_CELL),
  };
}
const decode = (hex: string | undefined, bytes: number) => {
  const out = new Uint8Array(bytes);
  for (let i = 0; hex && i < bytes && i * 2 < hex.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
};
const encode = (bits: Uint8Array) =>
  Array.from(bits, (n) => n.toString(16).padStart(2, '0')).join('');
/** Whether this commander's troops have ever seen the point (the Mountain Gun's reach). */
export function scouted(b: Battle, owner: string, p: Point) {
  const c = b.commanders.find((c) => c.id === owner);
  if (!c?.scouted) return false;
  const { bounds, columns, rows } = scoutGrid(b);
  const col = Math.floor((p.x - bounds.minX) / SCOUT_CELL),
    row = Math.floor((p.z - bounds.minZ) / SCOUT_CELL);
  if (col < 0 || row < 0 || col >= columns || row >= rows) return false;
  const i = row * columns + col;
  return (decode(c.scouted, (i >> 3) + 1)[i >> 3] & (1 << (i & 7))) !== 0;
}
/** Every couple of seconds, mark what each Ironclad commander's forces can see. */
function recordScouting(b: Battle, now: number, dt: number) {
  if (
    Math.floor(now / SCOUT_EVERY_MS) ===
    Math.floor((now - dt * 1000) / SCOUT_EVERY_MS)
  )
    return;
  const grid = scoutGrid(b),
    { bounds, columns, rows } = grid,
    bytes = Math.ceil((columns * rows) / 8);
  for (const c of b.commanders) {
    if (c.culture !== 'ironclad' || c.eliminatedAt !== undefined) continue;
    const bits = decode(c.scouted, bytes),
      scale = visionScaleFor(b, c.id);
    const mark = (at: Point, radius: number) => {
      const c0 = Math.max(
          0,
          Math.floor((at.x - radius - bounds.minX) / SCOUT_CELL),
        ),
        c1 = Math.min(
          columns - 1,
          Math.floor((at.x + radius - bounds.minX) / SCOUT_CELL),
        ),
        r0 = Math.max(
          0,
          Math.floor((at.z - radius - bounds.minZ) / SCOUT_CELL),
        ),
        r1 = Math.min(
          rows - 1,
          Math.floor((at.z + radius - bounds.minZ) / SCOUT_CELL),
        );
      for (let r = r0; r <= r1; r++)
        for (let col = c0; col <= c1; col++) {
          const x = bounds.minX + (col + 0.5) * SCOUT_CELL,
            z = bounds.minZ + (r + 0.5) * SCOUT_CELL;
          if (Math.hypot(x - at.x, z - at.z) > radius) continue;
          const i = r * columns + col;
          bits[i >> 3] |= 1 << (i & 7);
        }
    };
    for (const e of b.entities)
      if (e.owner === c.id && e.hp > 0 && !e.readyAt)
        mark(e, visionOf(e.kind, scale));
    c.scouted = encode(bits);
  }
}
/** Whether one of the commander's own eyes, or the coalition's Firestorm, sees the point now. */
export function inSight(b: Battle, owner: string, p: Point) {
  const scale = visionScaleFor(b, owner);
  return (
    revealed(b, p) ||
    b.entities.some(
      (e) =>
        e.owner === owner &&
        e.team === 'blue' &&
        e.hp > 0 &&
        !e.readyAt &&
        distance(e, p) < visionOf(e.kind, scale),
    )
  );
}
/** Why a commander's ready weapon cannot strike this point, or null. */
export function targetError(
  b: Battle,
  owner: string,
  kind: SuperweaponKind,
  p: Point,
): string | null {
  const terrain = terrainFor(b);
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.z) ||
    !insideSector(p, terrain.bounds)
  )
    return 'Choose a target inside the sector.';
  if (kind === 'cannon') {
    if (!inSight(b, owner, p) && !scouted(b, owner, p))
      return 'The Mountain Gun can only shell ground your forces have scouted.';
    return null;
  }
  if (!inSight(b, owner, p)) return 'Choose a target your forces can see.';
  if (kind === 'boathouse' && !terrain.groundAt(p.x, p.z))
    return 'The storm-boats need dry land to put the raiders ashore.';
  return null;
}
/** The commander's own weapon record. */
export const ownWeapon = (b: Pick<Battle, 'superweapons'>, owner: string) =>
  b.superweapons?.find((s) => s.owner === owner && s.team === 'blue');

// ---------------------------------------------------------------- launching
function strike(
  b: Battle,
  s: SuperweaponCharge,
  p: Point,
  now: number,
): Strike {
  const rules = SUPERWEAPONS[s.kind];
  const impactAt = now + rules.telegraphSeconds * 1000;
  const linger =
    s.kind === 'launcher'
      ? Math.max(
          SUPERWEAPONS.launcher.burnSeconds,
          SUPERWEAPONS.launcher.revealSeconds,
        )
      : s.kind === 'airstrip'
        ? SUPERWEAPONS.airstrip.boostSeconds
        : s.kind === 'weathermast'
          ? SUPERWEAPONS.weathermast.freezeSeconds
          : // Long enough for every client to draw the impact.
            8;
  const launched: Strike = {
    id: `s${++b.serial}`,
    owner: s.owner,
    team: s.team,
    kind: s.kind,
    x: p.x,
    z: p.z,
    radius: rules.radius,
    launchedAt: now,
    impactAt,
    until: impactAt + linger * 1000,
  };
  (b.strikes ??= []).push(launched);
  s.charge = 0;
  s.warned = false;
  s.paused = false;
  logEvent(b, now, `${weaponLabel(b, s)} launched!`, 'combat');
  return launched;
}
/** A commander fires their charged superweapon at a point. Server-authoritative. */
export function launchSuperweapon(
  b: Battle,
  owner: string,
  point: Point,
  now: number,
) {
  if (b.status !== 'active') throw new Error('This operation has ended.');
  if (commanderEliminated(b, owner))
    throw new Error('Your operation is over: you have been eliminated.');
  const s = ownWeapon(b, owner);
  if (!s) throw new Error('Build your faction superweapon first.');
  if (!isReady(b, s))
    throw new Error(`${weaponName(s.kind)} is still charging.`);
  const target = { x: point.x, z: point.z };
  const reason = targetError(b, owner, s.kind, target);
  if (reason) throw new Error(reason);
  if (s.kind === 'boathouse' && landingRoom(b, owner) <= 0)
    throw new Error(
      'No room for a landing party: your army is at full strength.',
    );
  return strike(b, s, target, now).id;
}

// ---------------------------------------------------------------- effects
/** Superweapon damage: never the firing coalition, never more than the cap on a command station. */
function hurt(b: Battle, s: Strike, e: Entity, amount: number) {
  if (e.team === s.team || e.hp <= 0 || amount <= 0) return;
  if (e.veteran) amount *= SUPERWEAPONS.boathouse.veteranArmor;
  if (e.kind === 'hq') {
    const record =
      s.struck?.find((r) => r.id === e.id) ??
      (s.struck ??= [])[s.struck.push({ id: e.id, damage: 0 }) - 1];
    amount = Math.min(
      amount,
      spec('hq').hp * SUPERWEAPON_HQ_CAP - record.damage,
    );
    if (amount <= 0) return;
    record.damage += amount;
  }
  e.hp -= amount;
}
/** Troops in training are not on the field yet. */
const fielded = (e: Entity) => e.hp > 0 && !(isUnit(e.kind) && e.readyAt > 0);
const within = (b: Battle, s: Strike) =>
  b.entities.filter((e) => fielded(e) && distance(e, s) <= s.radius);
function landingRoom(b: Battle, owner: string) {
  return commandLimit(b) - fieldCount(b, owner).units;
}
/** Skerry Strike: storm-boats put a veteran raiding party ashore around the target. */
function land(b: Battle, s: Strike, now: number) {
  const { groundAt } = terrainFor(b),
    obstacles = movementObstacles(b),
    party = Object.entries(SUPERWEAPONS.boathouse.party).flatMap(([kind, n]) =>
      Array<UnitKind>(n).fill(kind as UnitKind),
    );
  const taken: Point[] = b.entities.filter(
    (e) => e.hp > 0 && isUnit(e.kind) && !e.readyAt,
  );
  let landed = 0;
  // Spiral out from the beach-head: vehicles need a little more room.
  for (let ring = 0; ring <= s.radius + 12 && landed < party.length; ring += 3)
    for (
      let i = 0, n = Math.max(1, Math.round((ring * Math.PI * 2) / 3.2));
      i < n && landed < party.length;
      i++
    ) {
      const a = (i / n) * Math.PI * 2 + ring;
      const p = { x: s.x + Math.sin(a) * ring, z: s.z + Math.cos(a) * ring };
      if (
        !groundAt(p.x, p.z) ||
        obstacles.some((o) => insideFootprint(p, o, 1.5)) ||
        taken.some((t) => distance(t, p) < 2.6)
      )
        continue;
      if (landingRoom(b, s.owner) <= 0 || !battleHasRoom(b)) return landed;
      const unit = makeEntity(b, party[landed], s.owner, 'blue', p);
      unit.angle = Math.atan2(s.x - p.x, s.z - p.z) + Math.PI;
      unit.veteran = true;
      unit.orderAt = now;
      b.entities.push(unit);
      taken.push(unit);
      landed++;
    }
  return landed;
}
function impact(b: Battle, s: Strike, now: number) {
  s.landed = true;
  const label = weaponLabel(b, s);
  if (s.kind === 'boathouse') {
    const landed = land(b, s, now);
    logEvent(b, now, `${label}: ${landed} raiders ashore.`, 'combat');
  } else if (s.kind === 'cannon') {
    const { damage, edge } = SUPERWEAPONS.cannon;
    for (const e of within(b, s))
      hurt(b, s, e, damage * (1 - ((1 - edge) * distance(e, s)) / s.radius));
  } else if (s.kind === 'airstrip') {
    const rules = SUPERWEAPONS.airstrip;
    for (const e of within(b, s)) {
      if (e.team !== s.team) continue;
      e.hp = spec(e.kind).hp;
      if (isUnit(e.kind)) e.boostUntil = now + rules.boostSeconds * 1000;
    }
    const c = b.commanders.find((c) => c.id === s.owner);
    if (c) c.credits = Math.min(CREDIT_CAP, c.credits + rules.credits);
    logEvent(
      b,
      now,
      `${label} delivered: ₭ ${rules.credits} and fresh supplies.`,
      'success',
    );
  } else if (s.kind === 'launcher') {
    for (const e of within(b, s)) hurt(b, s, e, SUPERWEAPONS.launcher.damage);
  } else {
    const rules = SUPERWEAPONS.weathermast;
    for (const e of within(b, s)) {
      if (e.team === s.team) continue;
      hurt(b, s, e, rules.damage);
      if (isUnit(e.kind)) {
        e.frozenUntil = now + rules.freezeSeconds * 1000;
        e.path = [];
        delete e.v;
      }
    }
    logEvent(b, now, 'Blizzard! Allied forces frozen in place.', 'combat');
  }
}
/** The richest allied position: the troop or structure whose surroundings are worth most. */
export function blizzardTarget(b: Battle): Point | null {
  const radius = SUPERWEAPONS.weathermast.radius;
  const worth = (e: Entity) =>
    e.kind === 'hq' ? 1500 : spec(e.kind).cost * (isUnit(e.kind) ? 1 : 0.5);
  const allied = b.entities.filter(
    (e) => e.team === 'blue' && fielded(e) && !e.readyAt,
  );
  let best: Point | null = null,
    most = 0;
  for (const centre of allied) {
    let sum = 0,
      x = 0,
      z = 0;
    for (const e of allied) {
      if (distance(e, centre) > radius) continue;
      const w = worth(e);
      sum += w;
      x += e.x * w;
      z += e.z * w;
    }
    if (sum > most) {
      most = sum;
      best = { x: x / sum, z: z / sum };
    }
  }
  return best;
}

// ---------------------------------------------------------------- the tick
/**
 * Charge records follow their structures; weapons charge while powered; the
 * garrison fires its masts on its own; strikes land after their telegraph
 * and linger. Called once per tick from lib/tactics.ts after combat.
 */
export function advanceSuperweapons(
  b: Battle,
  now: number,
  dt: number,
  powered: (owner: string) => boolean,
) {
  recordScouting(b, now, dt);
  const records = (b.superweapons ??= []);
  const standing = new Map(
    b.entities
      .filter((e) => isSuperweapon(e.kind) && e.hp > 0 && !e.readyAt)
      .map((e) => [e.id, e]),
  );
  for (const s of records.filter((s) => !standing.has(s.id)))
    logEvent(
      b,
      now,
      s.team === 'red'
        ? `${weaponLabel(b, s)} destroyed. The blizzards stop.`
        : `${weaponLabel(b, s)} offline.`,
      s.team === 'red' ? 'success' : 'combat',
    );
  b.superweapons = records.filter((s) => standing.has(s.id));
  for (const e of standing.values()) {
    if (b.superweapons.some((s) => s.id === e.id)) continue;
    const record: SuperweaponCharge = {
      id: e.id,
      owner: e.owner,
      team: e.team,
      kind: e.kind as SuperweaponKind,
      x: e.x,
      z: e.z,
      charge: 0,
    };
    b.superweapons.push(record);
    logEvent(
      b,
      now,
      e.team === 'red'
        ? `Warning: the garrison has raised a ${TACTICAL_BUILDINGS.weathermast.name}.`
        : `${weaponLabel(b, record)} online. Charging.`,
      'combat',
    );
  }
  const eliminated = new Set(
    b.commanders.filter((c) => c.eliminatedAt !== undefined).map((c) => c.id),
  );
  for (const s of b.superweapons) {
    const full = chargeMs(b, s.kind);
    if (s.charge >= full || eliminated.has(s.owner)) continue;
    s.paused = s.team === 'blue' && !powered(s.owner);
    if (s.paused) continue;
    s.charge = Math.min(full, s.charge + dt * 1000);
    if (!s.warned && full - s.charge <= SUPERWEAPON_WARNING_SECONDS * 1000) {
      s.warned = true;
      logEvent(
        b,
        now,
        `${weaponLabel(b, s)} ready in ${SUPERWEAPON_WARNING_SECONDS} seconds.`,
        'combat',
      );
    }
    if (s.charge >= full && s.team === 'blue')
      logEvent(
        b,
        now,
        `${weaponLabel(b, s)} ready. Choose a target.`,
        'success',
      );
  }
  // The garrison fires as soon as a mast is charged and there is anything to hit.
  for (const s of b.superweapons) {
    if (s.team !== 'red' || !isReady(b, s)) continue;
    const target = blizzardTarget(b);
    if (target) strike(b, s, target, now);
  }
  for (const s of b.strikes ?? []) {
    if (!s.landed && s.impactAt <= now) impact(b, s, now);
    else if (burning(s, now))
      for (const e of within(b, s))
        hurt(b, s, e, SUPERWEAPONS.launcher.burnDps * dt);
  }
  if (b.strikes?.length) b.strikes = b.strikes.filter((s) => s.until > now);
  for (const e of b.entities) {
    if (e.boostUntil !== undefined && e.boostUntil <= now) delete e.boostUntil;
    if (e.frozenUntil !== undefined && e.frozenUntil <= now)
      delete e.frozenUntil;
  }
}

// ---------------------------------------------------------------- the garrison's masts
/**
 * Raises a Weather Mast beside every hostile command station on difficulties
 * that field them: clear, level ground beyond the station's exit and flag.
 * The layout generator is untouched, so maps and their tests stay the same.
 */
export function raiseWeatherMasts(b: Battle) {
  if (!difficultyFor(b).mast) return;
  const terrain = terrainFor(b),
    bridges = terrain.riverBridges().map(crossingBounds);
  for (const hq of b.entities.filter(
    (e) => e.team === 'red' && e.kind === 'hq',
  )) {
    const spot = mastSite(b, hq, terrain, bridges);
    if (!spot) continue;
    const mast = makeEntity(b, 'weathermast', hq.owner, 'red', spot);
    mast.angle = hq.angle;
    b.entities.push(mast);
    // Charging from the first minute, with its warning already on the log.
    (b.superweapons ??= []).push({
      id: mast.id,
      owner: mast.owner,
      team: 'red',
      kind: 'weathermast',
      x: mast.x,
      z: mast.z,
      charge: 0,
    });
  }
  if (b.superweapons?.length)
    logEvent(
      b,
      b.startedAt,
      `Warning: the garrison has raised ${b.superweapons.length === 1 ? 'a Weather Mast' : `${b.superweapons.length} Weather Masts`}. Destroy ${b.superweapons.length === 1 ? 'it' : 'them'} to stop the blizzards.`,
      'combat',
    );
}
function mastSite(
  b: Battle,
  hq: Entity,
  terrain: ReturnType<typeof terrainFor>,
  bridges: ReturnType<typeof crossingBounds>[],
) {
  const structures = b.entities
    .filter((e) => !isUnit(e.kind) && e.hp > 0)
    .map((e) => footprint(e.kind as BuildingKind, e, e.angle));
  // Wide berths keep the lanes between foundations and every exit open; a
  // crowded Brutal stronghold settles for narrower ones farther out.
  const exits = b.entities
    .filter(
      (e) =>
        e.owner === hq.owner &&
        !isUnit(e.kind) &&
        hasExit(e.kind as BuildingKind),
    )
    .map(productionExit);
  for (const [gap, clearance, reach] of [
    [6, 10, 44],
    [3, 7, 64],
  ])
    for (let ring = 14; ring <= reach; ring += 3)
      for (let i = 0; i < 24; i++) {
        // Start behind the station, away from the front its columns march out of.
        const a =
          hq.angle +
          Math.PI +
          (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
        const p = {
          x: Math.round(hq.x + Math.sin(a) * ring),
          z: Math.round(hq.z + Math.cos(a) * ring),
        };
        const box = footprint('weathermast', p, hq.angle);
        const samples = footprintSamples(box);
        if (samples.some((q) => !terrain.buildableAt(q.x, q.z))) continue;
        const heights = samples.map((q) => terrain.heightAt(q.x, q.z));
        if (Math.max(...heights) - Math.min(...heights) > 1.5) continue;
        if (structures.some((f) => footprintsOverlap(box, f, gap))) continue;
        if (bridges.some((f) => footprintsOverlap(box, f, 4))) continue;
        // A stronghold's own derrick (a mode without ore) keeps its berth too.
        if (
          (b.sites ?? []).some((s) =>
            footprintsOverlap(box, siteFootprint(s), SITE_CLEARANCE),
          )
        )
          continue;
        if (exits.some((exit) => insideFootprint(exit, box, clearance)))
          continue;
        if (
          (b.flags ?? []).some((f) => insideFootprint(f, box, FLAG_RADIUS + 4))
        )
          continue;
        if (
          (b.deposits ?? []).some((d) =>
            insideFootprint(d, box, ORE_CLEARANCE + 2),
          )
        )
          continue;
        if (
          b.entities.some(
            (e) => e.hp > 0 && isUnit(e.kind) && insideFootprint(e, box, 2),
          )
        )
          continue;
        return p;
      }
  return null;
}

// ---------------------------------------------------------------- warnings
export type SuperweaponNotice = {
  id: string;
  kind: 'built' | 'warning' | 'ready' | 'launch' | 'destroyed';
  team: Entity['team'];
  weapon: SuperweaponKind;
  owner: string;
  text: string;
  x: number;
  z: number;
  /** An existing commander cue; voices only ship clips for CUE_RULES keys. */
  cue: VoiceCue | null;
};
type NoticeBattle = Pick<
  Battle,
  'commanders' | 'superweapons' | 'strikes' | 'difficulty'
>;
const HOSTILE_CUES = {
  built: 'enemySpotted',
  warning: 'wave',
  ready: null,
  launch: 'underAttack',
  destroyed: null,
} as const;
const ALLIED_CUES = {
  built: 'constructionReady',
  warning: 'unitReady',
  ready: 'armorReady',
  launch: 'attack',
  destroyed: null,
} as const;
/**
 * Global superweapon warnings between two snapshots, for every commander:
 * one built, a minute from ready, launched or destroyed. The owner also hears
 * when their own is ready. Client-side only; derived, never stored.
 */
export function superweaponNotices(
  previous: NoticeBattle | null | undefined,
  next: NoticeBattle,
  viewer: string,
): SuperweaponNotice[] {
  if (!previous) return [];
  const notices: SuperweaponNotice[] = [];
  const before = new Map((previous.superweapons ?? []).map((s) => [s.id, s]));
  const after = new Set((next.superweapons ?? []).map((s) => s.id));
  const notice = (
    kind: SuperweaponNotice['kind'],
    s: Pick<SuperweaponCharge, 'id' | 'team' | 'kind' | 'owner' | 'x' | 'z'>,
    text: string,
  ) =>
    notices.push({
      id: `${kind}:${s.id}`,
      kind,
      team: s.team,
      weapon: s.kind,
      owner: s.owner,
      text,
      x: s.x,
      z: s.z,
      cue: (s.team === 'red' ? HOSTILE_CUES : ALLIED_CUES)[kind],
    });
  for (const s of next.superweapons ?? []) {
    const old = before.get(s.id);
    const label = weaponLabel(next, s);
    if (!old) notice('built', s, `${label} online`);
    else if (s.warned && !old.warned)
      notice(
        'warning',
        s,
        `${label} ready in ${SUPERWEAPON_WARNING_SECONDS} s`,
      );
    else if (s.owner === viewer && isReady(next, s) && !isReady(previous, old))
      notice('ready', s, `${weaponName(s.kind)} ready · choose a target`);
  }
  for (const s of previous.superweapons ?? [])
    if (!after.has(s.id) && s.team === 'red')
      notice('destroyed', s, `${weaponLabel(next, s)} destroyed`);
  const launched = new Set((previous.strikes ?? []).map((s) => s.id));
  for (const s of next.strikes ?? [])
    if (!launched.has(s.id))
      notice(
        'launch',
        { ...s, id: s.id },
        s.team === 'red'
          ? 'Blizzard incoming!'
          : `${weaponLabel(next, s)} launched`,
      );
  // A charge that ran out between two snapshots (a slow tab) warns once, not twice.
  return notices.filter(
    (n, i) => notices.findIndex((m) => m.id === n.id) === i,
  );
}
/** Time left before a strike lands, in milliseconds. */
export const untilImpact = (s: Strike, now: number) =>
  Math.max(0, s.impactAt - now);
/** Strikes still landing or lingering, newest first. */
export const activeStrikes = (b: Pick<Battle, 'strikes'>) =>
  [...(b.strikes ?? [])].sort((a, z) => z.launchedAt - a.launchedAt);
