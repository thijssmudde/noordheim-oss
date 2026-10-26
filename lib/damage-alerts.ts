import { isHarvester, isUnit, type Battle, type Entity } from './tactics';

/**
 * Red Alert-style "under attack" warnings, derived purely by comparing the
 * viewer's entities between consecutive battle snapshots. Client-side only.
 */
export type DamageAlertKind = 'base' | 'harvester' | 'units';
export type DamageAlert = {
  /** Unique within one tracker, so the HUD can key and restart its animations. */
  id: number;
  kind: DamageAlertKind;
  x: number;
  z: number;
  /** Battle time (snapshot `tickAt`) the damage was seen. */
  at: number;
};
export type DamageAlertLog = {
  battleId: string | null;
  tickAt: number;
  /** Health of the viewer's entities in the last snapshot, the baseline for the next one. */
  hp: ReadonlyMap<string, number>;
  /** Last alert time per category and map cell. */
  throttle: ReadonlyMap<string, number>;
  /** Alerts still pinging on the radar, oldest first. */
  recent: readonly DamageAlert[];
  /** The alert Space jumps to; kept after its ping fades. */
  latest: DamageAlert | null;
  serial: number;
};

/** One alert per category per cell of this size (metres)... */
export const ALERT_CELL = 40;
/** ...in this window, so a long fight doesn't spam. */
export const ALERT_COOLDOWN_MS = 12_000;
/** How long a radar ping stays on the minimap. */
export const ALERT_PING_MS = 6_000;
/** A longer silence than this is a reconnect: re-baseline without replaying old damage. */
export const ALERT_GAP_MS = 5_000;

export const ALERT_TEXT: Record<DamageAlertKind, string> = {
  base: 'Base under attack',
  harvester: 'Harvester under attack',
  units: 'Units under attack',
};
const PRIORITY: Record<DamageAlertKind, number> = {
  base: 3,
  harvester: 2,
  units: 1,
};

export const EMPTY_ALERTS: DamageAlertLog = {
  battleId: null,
  tickAt: 0,
  hp: new Map(),
  throttle: new Map(),
  recent: [],
  latest: null,
  serial: 0,
};

export function alertKind(kind: Entity['kind']): DamageAlertKind {
  if (!isUnit(kind)) return 'base';
  return isHarvester(kind) ? 'harvester' : 'units';
}

type AlertBattle = Pick<Battle, 'entities' | 'tickAt'> & { id?: string };

/** Next alert log for a new snapshot. Returns `log` itself for a stale or repeated snapshot. */
export function trackDamage(
  log: DamageAlertLog,
  battle: AlertBattle | null | undefined,
  owner: string,
): DamageAlertLog {
  if (!battle) return log.battleId === null ? log : EMPTY_ALERTS;
  const battleId = battle.id ?? '';
  const sameBattle = log.battleId === battleId;
  if (sameBattle && battle.tickAt <= log.tickAt) return log;
  const hp = new Map<string, number>();
  const damaged: Entity[] = [];
  for (const e of battle.entities) {
    // Troops still in the queue are not on the field.
    if (e.owner !== owner || (e.readyAt > 0 && isUnit(e.kind))) continue;
    hp.set(e.id, e.hp);
    const before = log.hp.get(e.id);
    if (before !== undefined && e.hp < before) damaged.push(e);
  }
  if (!sameBattle || battle.tickAt - log.tickAt > ALERT_GAP_MS)
    return {
      ...EMPTY_ALERTS,
      battleId,
      tickAt: battle.tickAt,
      hp,
      serial: log.serial,
    };
  const at = battle.tickAt;
  let throttle = log.throttle,
    serial = log.serial;
  const fresh: DamageAlert[] = [];
  for (const e of damaged) {
    const kind = alertKind(e.kind);
    const key = `${kind}:${Math.floor(e.x / ALERT_CELL)}:${Math.floor(e.z / ALERT_CELL)}`;
    const last = throttle.get(key);
    if (last !== undefined && at - last < ALERT_COOLDOWN_MS) continue;
    if (throttle === log.throttle) throttle = new Map(throttle);
    (throttle as Map<string, number>).set(key, at);
    fresh.push({ id: ++serial, kind, x: e.x, z: e.z, at });
  }
  const recent = log.recent.filter((a) => at - a.at < ALERT_PING_MS);
  // The loudest new alert is the one the notice shows and Space jumps to.
  const headline = fresh.reduce<DamageAlert | null>(
    (best, a) => (!best || PRIORITY[a.kind] > PRIORITY[best.kind] ? a : best),
    null,
  );
  return {
    battleId,
    tickAt: at,
    hp,
    throttle,
    recent: fresh.length
      ? [...recent, ...fresh]
      : recent.length === log.recent.length
        ? log.recent
        : recent,
    latest: headline ?? log.latest,
    serial,
  };
}

/**
 * Holds the log between renders. `observe` is idempotent per snapshot, so a
 * render that runs twice (Strict Mode) or is discarded never double-counts.
 */
export class DamageAlertTracker {
  private source: unknown = undefined;
  private owner = '';
  log: DamageAlertLog = EMPTY_ALERTS;
  observe(battle: AlertBattle | null | undefined, owner: string) {
    if (battle === this.source && owner === this.owner) return this.log;
    if (owner !== this.owner) this.log = EMPTY_ALERTS;
    this.source = battle;
    this.owner = owner;
    this.log = trackDamage(this.log, battle, owner);
    return this.log;
  }
}
