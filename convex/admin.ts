import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';

/** Every table, including the retired realm tables that may still hold documents. */
const TABLES = [
  'sectors',
  'players',
  'worlds',
  'villages',
  'jobs',
  'marches',
  'reports',
  'offers',
  'alliances',
  'messages',
  'operations',
  'routes',
];
const BATCH = 500;

async function wipe(ctx: MutationCtx, table: string, limit: number) {
  const docs = await ctx.db.query(table as TableNames).take(limit);
  for (const doc of docs) await ctx.db.delete(doc._id);
  return docs.length;
}

/**
 * Full reset: deletes every commander, sector and retired realm record so the
 * next visitor enrols into an empty game. Runs in bounded batches and
 * reschedules itself until nothing remains. Invoke with
 * `npx convex run admin:reset '{"confirm":"RESET EVERYTHING"}'`.
 */
export const reset = internalMutation({
  args: { confirm: v.string(), deleted: v.optional(v.number()) },
  handler: async (ctx, { confirm, deleted = 0 }) => {
    if (confirm !== 'RESET EVERYTHING')
      throw new Error('Pass confirm: "RESET EVERYTHING" to wipe the game.');
    let remaining = BATCH,
      removed = 0;
    for (const table of TABLES) {
      if (remaining <= 0) break;
      const n = await wipe(ctx, table, remaining);
      remaining -= n;
      removed += n;
    }
    const total = deleted + removed;
    if (removed >= BATCH) {
      await ctx.scheduler.runAfter(0, internal.admin.reset, {
        confirm,
        deleted: total,
      });
      return { done: false, deleted: total };
    }
    return { done: true, deleted: total };
  },
});
