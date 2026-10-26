import {
  OPERATION_MINUTES,
  alliesDefeated,
  applyBattleOrder,
  battleHasRoom,
  commanderEliminated,
  enemyForces,
  logEvent,
  sectorDeposits,
  sitesFor,
  visibleTo,
  type Battle,
  type PendingBattleOrder,
} from './tactics';
import { playableMapId } from './battlefields';

/**
 * Sector bookkeeping shared by the Convex backend and the in-browser solo
 * engine: the persisted shape, the command queue rules, the per-commander
 * projection and the operation summary. Everything here is pure.
 */

/** Pending orders per commander; further squads wait for routing to catch up. */
export const ORDER_QUEUE_LIMIT = 4;
/** Delay between routing slices while orders are queued. */
export const ORDER_DISPATCH_MS = 10;
export const ORDERS_BUSY =
  'Orders are still processing. Try again in a moment.';
export const ELIMINATED = 'Your operation is over: you have been eliminated.';

/** The persisted shape of a sector; hostile production lines are stored but never sent to clients. */
export function persistedBattle(b: Battle): Battle {
  return {
    entities: b.entities,
    training: b.training ?? [],
    hostileTraining: b.hostileTraining ?? [],
    commanders: b.commanders,
    objectives: [],
    flags: b.flags ?? [],
    sites: b.sites ?? [],
    recon: b.recon ?? [],
    deposits: b.deposits ?? sectorDeposits(),
    superweapons: b.superweapons ?? [],
    strikes: b.strikes ?? [],
    events: b.events,
    status: b.status,
    tickAt: b.tickAt,
    startedAt: b.startedAt,
    nextWaveAt: b.nextWaveAt,
    wave: b.wave,
    serial: b.serial,
    mapVersion: b.mapVersion,
    mapId: b.mapId,
    seed: b.seed,
    enemyCount: b.enemyCount ?? 1,
    mapScale: b.mapScale,
    playerSlots: b.playerSlots,
    difficulty: b.difficulty,
    // Only operations under a skirmish mode carry these; Convex rows never do.
    ...(b.skirmish && { skirmish: b.skirmish }),
    ...(b.garrisonFunds && { garrisonFunds: b.garrisonFunds }),
  };
}

type QueuedSelection = { ids: string[]; selection?: string[] };
/**
 * The queued order a new command replaces. Redirects for the same squad
 * coalesce; orders to other squads keep their place, up to the queue limit.
 * `pending` is the commander's own queue.
 */
export function coalescedOrder<T extends QueuedSelection>(
  pending: T[],
  ids: string[],
) {
  const previous = pending.find(
    (q) =>
      (q.selection ?? q.ids).length === ids.length &&
      (q.selection ?? q.ids).every((id) => ids.includes(id)),
  );
  if (!previous && pending.length >= ORDER_QUEUE_LIMIT)
    throw new Error(ORDERS_BUSY);
  return previous;
}

/** Route the next slice of a queued order; failures are logged, never thrown. Returns whether troops remain to route. */
export function dispatchOrder(
  b: Battle,
  intent: PendingBattleOrder,
  now: number,
) {
  try {
    for (const message of applyBattleOrder(b, intent))
      logEvent(b, now, `Order could not be issued: ${message}`);
  } catch (error) {
    logEvent(b, now, `Order could not be issued: ${(error as Error).message}`);
    intent.ids = [];
  }
  return intent.ids.length > 0;
}

/** What one commander may see of a sector: fogged, with hostile routes and targets withheld. */
export function sectorView(
  b: Battle,
  viewerId: string,
  now: number,
  pendingOrders: QueuedSelection[],
) {
  const {
    hostileTraining: _hostile,
    garrisonFunds: _funds,
    ...shared
  } = persistedBattle(b);
  return {
    ...shared,
    ...sitesFor(b, viewerId),
    enemyForces: enemyForces(b),
    viewerId,
    now,
    battlefieldFull: !battleHasRoom(b),
    pendingCommandUnits: pendingOrders.reduce(
      (count, order) => count + order.ids.length,
      0,
    ),
    entities: b.entities
      .filter((e) => visibleTo(viewerId, e, b.entities, b))
      .map((e) =>
        e.team === 'red' ? { ...e, path: [], target: undefined } : e,
      ),
  };
}

export type GameOverReason =
  | 'flag'
  | 'buildings'
  | 'timeout'
  | 'defeat'
  | 'victory';
/** Why the operation is over for this commander, or null while they still fight. */
export function gameOverReason(
  b: Battle,
  viewerId: string,
): GameOverReason | null {
  if (commanderEliminated(b, viewerId))
    return b.flags?.some(
      (f) => f.owner === viewerId && f.capturedAt !== undefined,
    )
      ? 'flag'
      : 'buildings';
  if (b.status === 'defeat')
    return b.tickAt - b.startedAt > OPERATION_MINUTES * 60000
      ? 'timeout'
      : 'defeat';
  if (b.status === 'victory') return 'victory';
  return null;
}

/** The launcher's view of an operation, without its id or mode. */
export function operationSummary(b: Battle, viewerId: string) {
  return {
    status: b.status,
    difficulty: b.difficulty ?? 'normal',
    mapId: playableMapId(b.mapId),
    commanders: b.commanders.length,
    gameOver: gameOverReason(b, viewerId),
    startedAt: b.startedAt,
    endedAt:
      b.commanders.find((c) => c.id === viewerId)?.eliminatedAt ?? b.tickAt,
  };
}

/** Move every clock forward by the time the simulation stood still, so a pause never counts against the operation. */
export function shiftTimers(b: Battle, now: number) {
  const pausedFor = now - b.tickAt;
  b.startedAt += pausedFor;
  b.nextWaveAt += pausedFor;
  for (const entity of b.entities)
    if (entity.readyAt > 0) entity.readyAt += pausedFor;
  for (const order of [...(b.training ?? []), ...(b.hostileTraining ?? [])]) {
    if (order.readyAt > 0) order.readyAt += pausedFor;
    for (const line of order.lines ?? []) line.readyAt += pausedFor;
  }
  for (const c of b.commanders)
    if (c.researching) c.researching.readyAt += pausedFor;
  b.tickAt = now;
  return pausedFor;
}

/** Remove a commander and everything they field from an active operation. */
export function withdrawCommander(
  b: Battle,
  viewer: { id: string; name: string },
  now: number,
) {
  b.entities = b.entities.filter((e) => e.owner !== viewer.id);
  b.commanders = b.commanders.filter((c) => c.id !== viewer.id);
  b.training = b.training?.filter((q) => q.owner !== viewer.id);
  logEvent(b, now, `${viewer.name} withdrew from the operation.`);
  // Their flag leaves with them; the operation ends if no commander remains in it.
  b.flags = b.flags?.filter((f) => f.owner !== viewer.id);
  if (alliesDefeated(b)) b.status = 'defeat';
}
