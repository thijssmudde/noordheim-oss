import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  battleValues,
  difficulty,
  mapId,
  orderKind,
  point,
} from './tacticalValues';
export default defineSchema({
  battleOrders: defineTable({
    sectorId: v.id('sectors'),
    owner: v.id('players'),
    ids: v.array(v.string()),
    order: orderKind,
    point: v.optional(point),
    target: v.optional(v.string()),
    issuedAt: v.number(),
    selection: v.optional(v.array(v.string())),
    destinations: v.optional(v.array(v.object({ id: v.string(), point }))),
  })
    .index('by_sector_owner', ['sectorId', 'owner'])
    .index('by_sector_time', ['sectorId', 'issuedAt']),
  // One row per verified purchase. A slot's holder is its `active` row; the
  // rows it replaced stay as history (`outbid`) for the stats email.
  sponsors: defineTable({
    sessionId: v.string(),
    paymentIntentId: v.string(),
    name: v.string(),
    website: v.string(),
    startsAt: v.number(),
    status: v.union(
      v.literal('active'),
      v.literal('outbid'),
      // Paid for a slot someone else had already outbid them on; refunded.
      v.literal('lost'),
      v.literal('expired'),
      v.literal('revoked'),
    ),
    // Outbid-ladder purchases. Private: never returned with the email.
    slot: v.optional(v.number()),
    amountCents: v.optional(v.number()),
    email: v.optional(v.string()),
    invoiceUrl: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    outbidBy: v.optional(v.id('sponsors')),
    // Fixed 30-day placements sold before the ladder; they run out on their own.
    expiresAt: v.optional(v.number()),
  })
    .index('by_session', ['sessionId'])
    .index('by_status', ['status'])
    .index('by_slot_status', ['slot', 'status']),
  // Kept apart from `sponsors` so counting a view never re-runs the queries
  // every billboard subscribes to.
  sponsorStats: defineTable({
    sponsorId: v.id('sponsors'),
    views: v.number(),
    clicks: v.number(),
  }).index('by_sponsor', ['sponsorId']),
  players: defineTable({
    token: v.string(),
    name: v.string(),
    culture: v.string(),
    createdAt: v.number(),
    activeSectorId: v.optional(v.union(v.id('sectors'), v.null())),
    activeLobbyId: v.optional(v.id('lobbies')),
    // Retired realm fields, kept optional so existing commanders remain valid.
    worldId: v.optional(v.string()),
    allianceId: v.optional(v.string()),
    lastAction: v.optional(v.number()),
  }).index('by_token', ['token']),
  sectors: defineTable({
    mode: v.optional(v.union(v.literal('solo'), v.literal('coop'))),
    hostId: v.optional(v.id('players')),
    lobbyId: v.optional(v.id('lobbies')),
    // Retired realm field, retained for old operations.
    worldId: v.optional(v.string()),
    ...battleValues,
  })
    .index('by_mode', ['mode'])
    .index('by_status_tick', ['status', 'tickAt']),
  lobbies: defineTable({
    hostId: v.id('players'),
    name: v.string(),
    code: v.string(),
    maxPlayers: v.number(),
    difficulty,
    mapId: v.optional(mapId),
    enemyCount: v.optional(v.number()),
    members: v.array(v.id('players')),
    status: v.union(
      v.literal('waiting'),
      v.literal('active'),
      v.literal('closed'),
    ),
    sectorId: v.optional(v.id('sectors')),
    createdAt: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_status', ['status']),
});
