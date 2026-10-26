import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { SponsorEmail } from '../lib/sponsor-emails';
import {
  isSponsorSlot,
  minimumBid,
  sponsorDetails,
  sponsorSlots,
} from '../lib/sponsorship';

const siteUrl = () => process.env.SPONSOR_SITE_URL ?? 'https://noordheim.com';
const reclaimUrl = (slot: number) => `${siteUrl()}/sponsor?slot=${slot}#book`;

/** The purchase currently showing in `slot`, if any. */
const holder = (ctx: QueryCtx, slot: number) =>
  ctx.db
    .query('sponsors')
    .withIndex('by_slot_status', (q) =>
      q.eq('slot', slot).eq('status', 'active'),
    )
    .first();

const statsFor = (ctx: QueryCtx, sponsorId: Id<'sponsors'>) =>
  ctx.db
    .query('sponsorStats')
    .withIndex('by_sponsor', (q) => q.eq('sponsorId', sponsorId))
    .unique();

/** A 30-day placement from before the outbid ladder, still inside its window. */
const liveLegacy = (row: Doc<'sponsors'>, now: number) =>
  row.slot === undefined && (row.expiresAt ?? 0) > now;

/**
 * Everything the billboards, walls and credits show. Deliberately free of
 * view and click counts, so recording those never re-renders a battle.
 */
export const active = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('sponsors')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect();
    return rows
      .filter((row) => row.slot !== undefined || liveLegacy(row, now))
      .map((row) => ({
        id: row._id,
        name: row.name,
        website: row.website,
        slot: row.slot ?? null,
        amountCents: row.amountCents ?? null,
        since: row.startsAt,
      }));
  },
});

/** The outbid board on /sponsor: every slot with its holder, price, stats and the latest takeovers. */
export const board = query({
  args: {},
  handler: async (ctx) => {
    const slots = await Promise.all(
      sponsorSlots.map(async (slot) => {
        const row = await holder(ctx, slot);
        const stats = row && (await statsFor(ctx, row._id));
        return {
          slot,
          minimum: minimumBid(row?.amountCents),
          holder: row
            ? {
                name: row.name,
                website: row.website,
                amountCents: row.amountCents ?? 0,
                since: row.startsAt,
                views: stats?.views ?? 0,
                clicks: stats?.clicks ?? 0,
              }
            : null,
        };
      }),
    );
    const recent = (await ctx.db.query('sponsors').order('desc').take(40))
      .filter(
        (row) =>
          row.slot !== undefined &&
          (row.status === 'active' || row.status === 'outbid'),
      )
      .slice(0, 6)
      .map((row) => ({
        slot: row.slot!,
        name: row.name,
        amountCents: row.amountCents ?? 0,
        at: row.startsAt,
      }));
    return { slots, recent };
  },
});

/** The least checkout will accept for `slot` right now. */
export const minimum = internalQuery({
  args: { slot: v.number() },
  handler: async (ctx, { slot }) =>
    minimumBid((await holder(ctx, slot))?.amountCents),
});

/** The buyer's return page and their "watch your spot" link. Never returns the email. */
export const status = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const row = await ctx.db
      .query('sponsors')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (!row) return null;
    const stats = await statsFor(ctx, row._id);
    const current = row.slot ? await holder(ctx, row.slot) : null;
    return {
      name: row.name,
      slot: row.slot ?? null,
      amountCents: row.amountCents ?? null,
      status: row.status,
      startsAt: row.startsAt,
      endedAt: row.endedAt ?? row.expiresAt ?? null,
      views: stats?.views ?? 0,
      clicks: stats?.clicks ?? 0,
      nextCents: row.slot ? minimumBid(current?.amountCents) : null,
    };
  },
});

const MAX_VIEWS_PER_FLUSH = 120;
const MAX_CLICKS_PER_FLUSH = 3;

/**
 * Views and clicks, batched by each player's browser. Counts are capped per
 * call and only land on live placements, so they are indicative figures for
 * the sponsor, not billing data.
 */
export const record = mutation({
  args: {
    views: v.array(v.object({ id: v.string(), n: v.number() })),
    clicks: v.array(v.object({ id: v.string(), n: v.number() })),
  },
  handler: async (ctx, { views, clicks }) => {
    const totals = new Map<Id<'sponsors'>, { views: number; clicks: number }>();
    const add = (
      list: { id: string; n: number }[],
      key: 'views' | 'clicks',
      cap: number,
    ) => {
      for (const { id, n } of list.slice(0, 16)) {
        const sponsorId = ctx.db.normalizeId('sponsors', id);
        const count = Math.min(cap, Math.floor(n));
        if (!sponsorId || !(count > 0)) continue;
        const total = totals.get(sponsorId) ?? { views: 0, clicks: 0 };
        total[key] = Math.min(cap, total[key] + count);
        totals.set(sponsorId, total);
      }
    };
    add(views, 'views', MAX_VIEWS_PER_FLUSH);
    add(clicks, 'clicks', MAX_CLICKS_PER_FLUSH);
    for (const [sponsorId, total] of totals) {
      const row = await ctx.db.get(sponsorId);
      if (row?.status !== 'active') continue;
      const stats = await statsFor(ctx, sponsorId);
      if (stats)
        await ctx.db.patch(stats._id, {
          views: stats.views + total.views,
          clicks: stats.clicks + total.clicks,
        });
      else await ctx.db.insert('sponsorStats', { sponsorId, ...total });
    }
  },
});

function mail(ctx: MutationCtx, to: string | undefined, email: SponsorEmail) {
  if (to)
    return ctx.scheduler.runAfter(0, internal.sponsorEmails.send, {
      to,
      email,
    });
}

/**
 * A verified payment for `slot`. Only Stripe fulfillment calls this; browser
 * writes are deliberately unavailable. The bid takes the slot if it still
 * beats the holder; otherwise (someone outbid it while checkout was open) the
 * purchase is recorded as `lost` and the caller refunds it. Repeated webhook
 * deliveries return the first outcome and never move a slot twice.
 */
export const claim = internalMutation({
  args: {
    sessionId: v.string(),
    paymentIntentId: v.string(),
    name: v.string(),
    website: v.string(),
    email: v.optional(v.string()),
    slot: v.number(),
    amountCents: v.number(),
    invoiceUrl: v.optional(v.string()),
    revoked: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const current = await holder(ctx, args.slot);
    const existing = await ctx.db
      .query('sponsors')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .unique();
    if (existing) {
      // A lost bid is refunded on purpose; its refund event must not relabel it.
      if (args.revoked && existing.status !== 'lost')
        await ctx.db.patch(existing._id, {
          status: 'revoked',
          endedAt: existing.endedAt ?? now,
        });
      return {
        outcome: existing.status === 'lost' ? ('lost' as const) : ('duplicate' as const),
        minimum: minimumBid(current?.amountCents),
      };
    }
    if (!isSponsorSlot(args.slot)) throw new Error('Unknown sponsor slot');
    const { revoked, ...purchase } = {
      ...args,
      ...sponsorDetails(args.name, args.website),
    };
    if (revoked) {
      await ctx.db.insert('sponsors', {
        ...purchase,
        startsAt: now,
        endedAt: now,
        status: 'revoked',
      });
      return { outcome: 'revoked' as const, minimum: minimumBid(current?.amountCents) };
    }
    if (current && args.amountCents < minimumBid(current.amountCents)) {
      await ctx.db.insert('sponsors', { ...purchase, startsAt: now, status: 'lost' });
      return { outcome: 'lost' as const, minimum: minimumBid(current.amountCents) };
    }
    const id = await ctx.db.insert('sponsors', {
      ...purchase,
      startsAt: now,
      status: 'active',
    });
    if (current) {
      await ctx.db.patch(current._id, {
        status: 'outbid',
        endedAt: now,
        outbidBy: id,
      });
      const stats = await statsFor(ctx, current._id);
      await mail(ctx, current.email, {
        kind: 'outbid',
        name: current.name,
        slot: args.slot,
        amountCents: current.amountCents ?? 0,
        byCents: args.amountCents,
        heldMs: now - current.startsAt,
        views: stats?.views ?? 0,
        clicks: stats?.clicks ?? 0,
        reclaimUrl: reclaimUrl(args.slot),
      });
    }
    await mail(ctx, args.email, {
      kind: 'receipt',
      name: purchase.name,
      slot: args.slot,
      amountCents: args.amountCents,
      invoiceUrl: args.invoiceUrl,
      statsUrl: `${siteUrl()}/sponsor?session_id=${encodeURIComponent(args.sessionId)}`,
    });
    return { outcome: 'held' as const, minimum: minimumBid(args.amountCents) };
  },
});

/** After a lost bid's refund succeeds: tell the buyer, once. */
export const refunded = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const row = await ctx.db
      .query('sponsors')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (row?.status !== 'lost' || row.endedAt || row.slot === undefined) return;
    await ctx.db.patch(row._id, { endedAt: Date.now() });
    await mail(ctx, row.email, {
      kind: 'lost',
      name: row.name,
      slot: row.slot,
      amountCents: row.amountCents ?? 0,
      nextCents: minimumBid((await holder(ctx, row.slot))?.amountCents),
      reclaimUrl: reclaimUrl(row.slot),
    });
  },
});

/** A refunded or disputed legacy 30-day placement comes down. */
export const revokeLegacy = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const row = await ctx.db
      .query('sponsors')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (row && row.slot === undefined && row.status !== 'revoked')
      await ctx.db.patch(row._id, { status: 'revoked', endedAt: Date.now() });
  },
});

/** Legacy 30-day placements were scheduled to run out through this. */
export const expire = internalMutation({
  args: { id: v.id('sponsors') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row?.status === 'active' && row.slot === undefined && (row.expiresAt ?? 0) <= Date.now())
      await ctx.db.patch(id, { status: 'expired' });
  },
});
