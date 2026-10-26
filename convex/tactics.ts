import { v, ConvexError } from 'convex/values';
import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  MAP_VERSION,
  commanderEliminated,
  TACTICAL_TICK_MS,
  newBattle,
  joinBattle,
  purchase,
  cancelTraining,
  cancelResearch,
  migrateTraining,
  validateOrder,
  research as startResearch,
  sellStructure,
  setRally,
  setCategoryRally,
  tickBattle,
} from '../lib/tactics';
import { launchSuperweapon } from '../lib/tactical-superweapons';
import {
  ELIMINATED,
  ORDER_DISPATCH_MS,
  ORDER_QUEUE_LIMIT,
  coalescedOrder,
  dispatchOrder,
  persistedBattle,
  sectorView,
  shiftTimers,
} from '../lib/tactical-sector';
import {
  entityKind,
  orderKind,
  point,
  researchKey,
  difficulty,
} from './tacticalValues';
const auth = { token: v.string() };
export async function player(ctx: QueryCtx | MutationCtx, token: string) {
  const p = await ctx.db
    .query('players')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique();
  if (!p) throw new ConvexError('Reconnect to Noordheim to command a sector.');
  return p;
}
/** Compatibility arena for clients deployed before separate matches existed. */
async function latest(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query('sectors')
    .withIndex('by_mode', (q) => q.eq('mode', undefined))
    .order('desc')
    .first();
}
/** The persisted shape of a sector; hostile production lines are stored but never sent to clients. */
export const clean = persistedBattle;
async function ownSector(
  ctx: MutationCtx,
  token: string,
  sectorId: Id<'sectors'>,
) {
  const p = await player(ctx, token),
    b = await ctx.db.get(sectorId);
  if (!b) throw new ConvexError('Sector unavailable.');
  if (!b.commanders.some((c) => c.id === p._id))
    throw new ConvexError('Join this operation before giving orders.');
  if (commanderEliminated(b, p._id)) throw new ConvexError(ELIMINATED);
  return { p, b };
}
function attempt<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new ConvexError((e as Error).message);
  }
}
export const state = query({
  args: auth,
  handler: async (ctx, { token }) => {
    const p = await player(ctx, token),
      b = p.activeSectorId
        ? await ctx.db.get(p.activeSectorId)
        : p.activeSectorId === null
          ? null
          : await latest(ctx);
    if (!b || !b.commanders.some((c) => c.id === p._id)) return null;
    migrateTraining(b);
    const lobby = b.lobbyId ? await ctx.db.get(b.lobbyId) : null;
    const pendingOrders = await ctx.db
      .query('battleOrders')
      .withIndex('by_sector_owner', (q) =>
        q.eq('sectorId', b._id).eq('owner', p._id),
      )
      .take(ORDER_QUEUE_LIMIT);
    return {
      ...sectorView(b, p._id, Date.now(), pendingOrders),
      id: b._id,
      mode: b.mode ?? 'coop',
      openEnrollment: b.mode === undefined,
      maxPlayers: b.mode === 'solo' ? 1 : (lobby?.maxPlayers ?? 8),
    };
  },
});
export const deploy = mutation({
  args: { ...auth, difficulty: v.optional(difficulty) },
  handler: async (ctx, { token, difficulty }) => {
    const p = await player(ctx, token);
    // Old clients may resume their selected game, but must never join someone else's solo game.
    const selected = p.activeSectorId
      ? await ctx.db.get(p.activeSectorId)
      : null;
    if (
      selected?.mode &&
      selected.status === 'active' &&
      selected.commanders.some((c) => c.id === p._id)
    )
      return selected._id;
    if (p.activeLobbyId)
      throw new ConvexError('Your lobby host starts the operation.');
    const sector = await latest(ctx);
    const now = Date.now();
    // Sectors from an earlier map layout finish on their own; new deployments use the current sector.
    if (
      !sector ||
      sector.status !== 'active' ||
      (sector.mapVersion ?? 1) !== MAP_VERSION
    ) {
      const battle = newBattle(now, {
        difficulty,
        seed: Math.floor(Math.random() * 4294967296),
      });
      joinBattle(battle, { id: p._id, name: p.name, culture: p.culture }, now);
      const id = await ctx.db.insert('sectors', battle);
      await ctx.db.patch(p._id, { activeSectorId: id });
      await ctx.scheduler.runAfter(TACTICAL_TICK_MS, internal.tactics.tick, {
        id,
        expected: now,
      });
      return id;
    }
    if (
      difficulty &&
      difficulty !== (sector.difficulty ?? 'normal') &&
      !sector.commanders.some((c) => c.id === p._id)
    )
      throw new ConvexError(
        'An operation has already started with a different difficulty. Join its current settings.',
      );
    attempt(() =>
      joinBattle(sector, { id: p._id, name: p.name, culture: p.culture }, now),
    );
    await ctx.db.patch(sector._id, clean(sector));
    await ctx.db.patch(p._id, { activeSectorId: sector._id });
    return sector._id;
  },
});
export const produce = mutation({
  args: {
    ...auth,
    sectorId: v.id('sectors'),
    kind: entityKind,
    quantity: v.optional(v.number()),
    placement: v.optional(v.object({ position: point, rotation: v.number() })),
  },
  handler: async (ctx, { token, sectorId, kind, placement, quantity }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    attempt(() => purchase(b, p._id, kind, Date.now(), placement, quantity));
    await ctx.db.patch(b._id, clean(b));
  },
});
export const cancelTroops = mutation({
  args: { ...auth, sectorId: v.id('sectors'), orderId: v.string() },
  handler: async (ctx, { token, sectorId, orderId }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    const refund = attempt(() => cancelTraining(b, p._id, orderId, Date.now()));
    await ctx.db.patch(b._id, clean(b));
    return refund;
  },
});
export const research = mutation({
  args: { ...auth, sectorId: v.id('sectors'), key: researchKey },
  handler: async (ctx, { token, sectorId, key }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    attempt(() => startResearch(b, p._id, key, Date.now()));
    await ctx.db.patch(b._id, clean(b));
  },
});
export const abandonResearch = mutation({
  args: { ...auth, sectorId: v.id('sectors'), key: v.optional(researchKey) },
  handler: async (ctx, { token, sectorId, key }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    const refund = attempt(() => cancelResearch(b, p._id, key, Date.now()));
    await ctx.db.patch(b._id, clean(b));
    return refund;
  },
});
export const sell = mutation({
  args: { ...auth, sectorId: v.id('sectors'), id: v.string() },
  handler: async (ctx, { token, sectorId, id }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    const refund = attempt(() => sellStructure(b, p._id, id, Date.now()));
    await ctx.db.patch(b._id, clean(b));
    return refund;
  },
});
export const rally = mutation({
  args: { ...auth, sectorId: v.id('sectors'), id: v.string(), point },
  handler: async (ctx, { token, sectorId, id, point: destination }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    attempt(() => setRally(b, p._id, id, destination));
    await ctx.db.patch(b._id, clean(b));
  },
});
export const rallyCategory = mutation({
  args: {
    ...auth,
    sectorId: v.id('sectors'),
    category: v.union(
      v.literal('infantry'),
      v.literal('vehicle'),
      v.literal('air'),
    ),
    point,
  },
  handler: async (ctx, { token, sectorId, category, point: destination }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    const count = attempt(() =>
      setCategoryRally(b, p._id, category, destination),
    );
    await ctx.db.patch(b._id, clean(b));
    return count;
  },
});
/** Fire the commander's charged superweapon at a point; it lands after its telegraph. */
export const launch = mutation({
  args: { ...auth, sectorId: v.id('sectors'), point },
  handler: async (ctx, { token, sectorId, point: target }) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    attempt(() => launchSuperweapon(b, p._id, target, Date.now()));
    await ctx.db.patch(b._id, clean(b));
  },
});
export const command = mutation({
  args: {
    ...auth,
    sectorId: v.id('sectors'),
    ids: v.array(v.string()),
    order: orderKind,
    point: v.optional(point),
    target: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { token, sectorId, ids, order, point: destination, target },
  ) => {
    const { p, b } = await ownSector(ctx, token, sectorId);
    attempt(() => validateOrder(b, p._id, ids, order, destination, target));
    // A quick intent write cannot lose an expensive routing calculation to a tick conflict.
    // Redirects for the same squad coalesce; orders to other squads keep their place.
    const pending = await ctx.db
      .query('battleOrders')
      .withIndex('by_sector_owner', (q) =>
        q.eq('sectorId', sectorId).eq('owner', p._id),
      )
      .take(ORDER_QUEUE_LIMIT);
    const previous = attempt(() => coalescedOrder(pending, ids));
    const routingPending =
      pending.length > 0 ||
      !!(await ctx.db
        .query('battleOrders')
        .withIndex('by_sector_time', (q) => q.eq('sectorId', sectorId))
        .first());
    const intent = {
      sectorId,
      owner: p._id,
      ids,
      selection: ids,
      order,
      point: destination,
      target,
      issuedAt: Date.now(),
    };
    if (previous) await ctx.db.replace(previous._id, intent);
    else await ctx.db.insert('battleOrders', intent);
    // Wake the existing tick chain once when the queue becomes nonempty. Its
    // expected timestamp makes the old periodic callback harmless after this
    // one commits, without doing route work in the input mutation.
    if (!routingPending)
      await ctx.scheduler.runAfter(ORDER_DISPATCH_MS, internal.tactics.tick, {
        id: sectorId,
        expected: b.tickAt,
      });
  },
});
export const tick = internalMutation({
  args: { id: v.id('sectors'), expected: v.number() },
  handler: async (ctx, { id, expected }) => {
    const b = await ctx.db.get(id);
    if (!b || b.status !== 'active' || b.tickAt !== expected) return;
    const intent = await ctx.db
      .query('battleOrders')
      .withIndex('by_sector_time', (q) => q.eq('sectorId', id))
      .first();
    if (intent) {
      if (dispatchOrder(b, intent, Date.now()))
        await ctx.db.patch(intent._id, {
          ids: intent.ids,
          destinations: intent.destinations,
          issuedAt: Date.now(),
        });
      else await ctx.db.delete(intent._id);
    }
    tickBattle(b, Date.now());
    if (b.status !== 'active') {
      const abandoned = await ctx.db
        .query('battleOrders')
        .withIndex('by_sector_time', (q) => q.eq('sectorId', id))
        .take(32);
      for (const order of abandoned) await ctx.db.delete(order._id);
    }
    await ctx.db.patch(id, clean(b));
    if (b.status === 'active') {
      const routingPending = await ctx.db
        .query('battleOrders')
        .withIndex('by_sector_time', (q) => q.eq('sectorId', id))
        .first();
      // Yield between bounded slices, but do not add a quarter-second of idle
      // time for every squad or unfinished formation. A short delay coalesces
      // input bursts and advances the timestamp, preserving deduplication.
      await ctx.scheduler.runAfter(
        routingPending ? ORDER_DISPATCH_MS : TACTICAL_TICK_MS,
        internal.tactics.tick,
        { id, expected: b.tickAt },
      );
    }
  },
});

/** Independent of the tick chain, so a timeout cannot disable its own recovery. */
export const recoverStalledSectors = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stalled = await ctx.db
      .query('sectors')
      .withIndex('by_status_tick', (q) =>
        q.eq('status', 'active').lte('tickAt', Date.now() - 10000),
      )
      .take(16);
    for (const b of stalled)
      await ctx.scheduler.runAfter(0, internal.tactics.resumeStalledSector, {
        id: b._id,
        expected: b.tickAt,
      });
  },
});

/** Resume a failed simulation without counting the outage against the operation. */
export const resumeStalledSector = internalMutation({
  args: { id: v.id('sectors'), expected: v.number() },
  handler: async (ctx, { id, expected }) => {
    const b = await ctx.db.get(id);
    const now = Date.now();
    if (
      !b ||
      b.status !== 'active' ||
      b.tickAt !== expected ||
      now - b.tickAt < 10000
    )
      return false;
    shiftTimers(b, now);
    await ctx.db.patch(id, clean(b));
    await ctx.scheduler.runAfter(TACTICAL_TICK_MS, internal.tactics.tick, {
      id,
      expected: now,
    });
    return true;
  },
});
