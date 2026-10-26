import { internalMutation, type MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';

/** Ended operations linger this long so the Game Over screen can still be read. */
export const ENDED_GRACE_MS = 10 * 60 * 1000;
/** A commander with no operation and no waiting room is forgotten after this long, freeing the callsign. */
export const IDLE_GRACE_MS = 30 * 60 * 1000;

/** Remove an operation with everything that only existed for it: orders, its lobby and its commanders. */
async function purgeSector(ctx: MutationCtx, sector: Doc<'sectors'>) {
  for (;;) {
    const orders = await ctx.db
      .query('battleOrders')
      .withIndex('by_sector_time', (q) => q.eq('sectorId', sector._id))
      .take(64);
    for (const order of orders) await ctx.db.delete(order._id);
    if (orders.length < 64) break;
  }
  for (const c of sector.commanders) {
    const id = ctx.db.normalizeId('players', c.id);
    const p = id ? await ctx.db.get(id) : null;
    if (!p || p.activeSectorId !== sector._id) continue;
    if (p.activeLobbyId) await ctx.db.patch(p._id, { activeSectorId: null });
    else await ctx.db.delete(p._id);
  }
  if (sector.lobbyId) {
    const lobby = await ctx.db.get(sector.lobbyId);
    if (lobby) await ctx.db.delete(lobby._id);
  }
  await ctx.db.delete(sector._id);
}

/**
 * Nothing outlives its operation. Ended operations are purged after a short
 * grace period, operations nobody commands any more at once, closed lobbies
 * immediately, and commanders who are neither in an operation nor in a waiting
 * room after a longer grace, so their names become available again.
 */
export const purgeAbandoned = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let removed = 0;
    for (const status of ['victory', 'defeat'] as const) {
      const ended = await ctx.db
        .query('sectors')
        .withIndex('by_status_tick', (q) =>
          q.eq('status', status).lte('tickAt', now - ENDED_GRACE_MS),
        )
        .take(8);
      for (const sector of ended) {
        await purgeSector(ctx, sector);
        removed++;
      }
    }
    const active = await ctx.db
      .query('sectors')
      .withIndex('by_status_tick', (q) => q.eq('status', 'active'))
      .take(64);
    for (const sector of active)
      if (
        !sector.commanders.length ||
        sector.commanders.every((c) => c.eliminatedAt !== undefined)
      ) {
        await purgeSector(ctx, sector);
        removed++;
      }
    const closed = await ctx.db
      .query('lobbies')
      .withIndex('by_status', (q) => q.eq('status', 'closed'))
      .take(32);
    for (const lobby of closed) {
      await ctx.db.delete(lobby._id);
      removed++;
    }
    for (const p of await ctx.db.query('players').collect()) {
      if (p.activeLobbyId) {
        const lobby = await ctx.db.get(p.activeLobbyId);
        if (lobby?.status === 'waiting' && lobby.members.includes(p._id))
          continue;
      }
      if (p.activeSectorId) {
        const sector = await ctx.db.get(p.activeSectorId);
        if (sector && sector.commanders.some((c) => c.id === p._id)) continue;
      }
      if (now - Math.max(p.createdAt, p.lastAction ?? 0) < IDLE_GRACE_MS)
        continue;
      await ctx.db.delete(p._id);
      removed++;
    }
    return removed;
  },
});
