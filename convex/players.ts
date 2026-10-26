import { v, ConvexError } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  isPlayerKey,
  normalizePlayerName,
  playerNameKey,
} from '../lib/player-identity';
import { isCulture } from '../lib/cultures';
const auth = { token: v.string() };
/** Explicit enrolment only: visiting the entrance never creates a commander. */
export const connect = mutation({
  args: {
    ...auth,
    name: v.optional(v.string()),
    culture: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (!isPlayerKey(a.token)) throw new ConvexError('Invalid session key.');
    const existing = await ctx.db
      .query('players')
      .withIndex('by_token', (q) => q.eq('token', a.token))
      .unique();
    if (existing) return existing._id;
    const name = normalizePlayerName(a.name ?? '');
    if (name.length < 2 || name.length > 30)
      throw new ConvexError('Choose a commander name of 2–30 characters.');
    const culture = a.culture ?? 'fjordborn';
    if (!isCulture(culture)) throw new ConvexError('Choose a culture.');
    const people = await ctx.db.query('players').collect();
    if (people.some((p) => playerNameKey(p.name) === playerNameKey(name)))
      throw new ConvexError('That commander name is already taken.');
    return ctx.db.insert('players', {
      token: a.token,
      name,
      culture,
      createdAt: Date.now(),
    });
  },
});
/** The entrance exposes headcounts and the current operation, never credentials. */
export const lobby = query({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query('players').collect();
    const sector = await ctx.db
      .query('sectors')
      .withIndex('by_mode', (q) => q.eq('mode', undefined))
      .order('desc')
      .first();
    const rooms = await ctx.db
      .query('lobbies')
      .withIndex('by_status', (q) => q.eq('status', 'waiting'))
      .take(100);
    return {
      playerCount: players.length,
      openLobbies: rooms.filter((l) => l.members.length < l.maxPlayers).length,
      operation: sector
        ? {
            status: sector.status,
            commanders: sector.commanders.length,
            startedAt: sector.startedAt,
            difficulty: sector.difficulty ?? 'normal',
          }
        : null,
    };
  },
});
export const session = query({
  args: auth,
  handler: async (ctx, { token }) => {
    if (!isPlayerKey(token)) return null;
    const p = await ctx.db
      .query('players')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    return p ? { _id: p._id, name: p.name, culture: p.culture } : null;
  },
});
