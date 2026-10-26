import { playableMapId, type MapId } from '../lib/battlefields';
import { MAPS } from '../lib/maps';
import { ConvexError, v } from 'convex/values';
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { difficulty, mapChoice as mapId } from './tacticalValues';
import { clean, player } from './tactics';
import { joinBattle, newBattle, TACTICAL_TICK_MS } from '../lib/tactics';
import { operationSummary, withdrawCommander } from '../lib/tactical-sector';

const auth = { token: v.string() };
const lobbyArgs = { ...auth, lobbyId: v.id('lobbies') };

async function selectedBattle(ctx: QueryCtx | MutationCtx, p: Doc<'players'>) {
  const sector = p.activeSectorId
    ? await ctx.db.get(p.activeSectorId)
    : p.activeSectorId === null
      ? null
      : await ctx.db
          .query('sectors')
          .withIndex('by_mode', (q) => q.eq('mode', undefined))
          .order('desc')
          .first();
  return sector?.commanders.some((c) => c.id === p._id) ? sector : null;
}
async function available(ctx: MutationCtx, p: Doc<'players'>) {
  if ((await selectedBattle(ctx, p))?.status === 'active')
    throw new ConvexError(
      'Withdraw from your current operation before starting another.',
    );
  const lobby = p.activeLobbyId ? await ctx.db.get(p.activeLobbyId) : null;
  if (lobby?.status === 'waiting' && lobby.members.includes(p._id))
    throw new ConvexError('Leave your current lobby before joining another.');
}
async function memberLobby(ctx: MutationCtx, token: string, id: Id<'lobbies'>) {
  const p = await player(ctx, token),
    lobby = await ctx.db.get(id);
  if (!lobby || !lobby.members.includes(p._id))
    throw new ConvexError('Join this lobby first.');
  return { p, lobby };
}
/** Lobby size, clamped to what the map's landings hold. */
function capacity(value: number, map: MapId, members = 1) {
  if (!Number.isInteger(value) || value < 2 || value > 8)
    throw new ConvexError('Choose a lobby size from 2 to 8 players.');
  const { name, capacity } = MAPS[map];
  if (members > capacity.players)
    throw new ConvexError(
      `${name} holds ${capacity.players} players; the lobby has ${members}.`,
    );
  if (value < members)
    throw new ConvexError(
      'The player limit cannot be lower than the current roster.',
    );
  return Math.max(members, Math.min(value, capacity.players));
}
/** Enemy armies, clamped to the map's strongholds. */
function enemies(value = 1, map?: MapId) {
  if (!Number.isInteger(value) || value < 1 || value > 8)
    throw new ConvexError('Choose between 1 and 8 enemies.');
  return map ? Math.min(value, MAPS[map].capacity.enemies) : value;
}
async function launch(
  ctx: MutationCtx,
  members: Doc<'players'>[],
  level: Doc<'lobbies'>['difficulty'],
  lobby?: Doc<'lobbies'>,
  enemyCount = lobby?.enemyCount ?? 1,
  selectedMap: MapId = playableMapId(lobby?.mapId),
) {
  const now = Date.now();
  const players = MAPS[selectedMap].capacity.players;
  if (members.length > players)
    throw new ConvexError(
      `${MAPS[selectedMap].name} holds ${players} players. Choose a larger battlefield.`,
    );
  const battle = newBattle(now, {
    difficulty: level,
    mapId: selectedMap,
    enemyCount: enemies(enemyCount, selectedMap),
    playerSlots: Math.max(
      members.length,
      Math.min(lobby?.maxPlayers ?? 1, players),
    ),
    seed: Math.floor(Math.random() * 4294967296),
  });
  for (const p of members)
    joinBattle(battle, { id: p._id, name: p.name, culture: p.culture }, now);
  const id = await ctx.db.insert('sectors', {
    ...battle,
    mode: lobby ? 'coop' : 'solo',
    hostId: lobby?.hostId ?? members[0]._id,
    ...(lobby ? { lobbyId: lobby._id } : {}),
  });
  for (const p of members)
    await ctx.db.patch(p._id, { activeSectorId: id, activeLobbyId: undefined });
  if (lobby) await ctx.db.patch(lobby._id, { status: 'active', sectorId: id });
  await ctx.scheduler.runAfter(TACTICAL_TICK_MS, internal.tactics.tick, {
    id,
    expected: now,
  });
  return id;
}

export const overview = query({
  args: auth,
  handler: async (ctx, { token }) => {
    const p = await player(ctx, token);
    const b = await selectedBattle(ctx, p);
    const lobby = p.activeLobbyId ? await ctx.db.get(p.activeLobbyId) : null;
    const waiting =
      lobby?.status === 'waiting' && lobby.members.includes(p._id)
        ? lobby
        : null;
    const open = await ctx.db
      .query('lobbies')
      .withIndex('by_status', (q) => q.eq('status', 'waiting'))
      .order('desc')
      .take(100);
    const summary = (l: Doc<'lobbies'>) => ({
      id: l._id,
      name: l.name,
      code: l.code,
      maxPlayers: l.maxPlayers,
      difficulty: l.difficulty,
      mapId: playableMapId(l.mapId),
      enemyCount: l.enemyCount ?? 1,
      count: l.members.length,
    });
    return {
      viewerId: p._id,
      battle: b
        ? {
            id: b._id,
            mode: b.mode ?? 'coop',
            ...operationSummary(b, p._id),
          }
        : null,
      lobby: waiting
        ? {
            ...summary(waiting),
            hostId: waiting.hostId,
            members: await Promise.all(
              waiting.members.map(async (id) => {
                const person = await ctx.db.get(id);
                return {
                  id,
                  name: person?.name ?? 'Commander',
                  culture: person?.culture ?? 'fjordborn',
                };
              }),
            ),
          }
        : null,
      openLobbies: open
        .filter((l) => l.members.length < l.maxPlayers && l.members.length > 0)
        .map(summary),
    };
  },
});
export const solo = mutation({
  args: {
    ...auth,
    difficulty,
    enemyCount: v.optional(v.number()),
    mapId: v.optional(mapId),
  },
  handler: async (ctx, { token, difficulty: level, enemyCount, mapId }) => {
    const p = await player(ctx, token);
    const selected = await selectedBattle(ctx, p);
    if (selected?.mode === 'solo' && selected.status === 'active')
      return selected._id;
    await available(ctx, p);
    return launch(ctx, [p], level, undefined, enemies(enemyCount), mapId);
  },
});
export const createLobby = mutation({
  args: {
    ...auth,
    difficulty,
    mapId: v.optional(mapId),
    enemyCount: v.optional(v.number()),
    maxPlayers: v.number(),
    name: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { token, difficulty: level, maxPlayers, name, enemyCount, mapId },
  ) => {
    const p = await player(ctx, token);
    const existing = p.activeLobbyId ? await ctx.db.get(p.activeLobbyId) : null;
    if (existing?.status === 'waiting' && existing.hostId === p._id)
      return existing._id;
    await available(ctx, p);
    const map = playableMapId(mapId);
    const size = capacity(maxPlayers, map);
    const title = name?.trim() || `${p.name}'s lobby`;
    if (title.length > 48)
      throw new ConvexError('Keep the lobby name to 48 characters.');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let tries = 0; tries < 20; tries++) {
      code = Array.from(
        { length: 6 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join('');
      if (
        !(await ctx.db
          .query('lobbies')
          .withIndex('by_code', (q) => q.eq('code', code))
          .first())
      )
        break;
      code = '';
    }
    if (!code)
      throw new ConvexError('Could not reserve a join code. Please try again.');
    const id = await ctx.db.insert('lobbies', {
      name: title,
      code,
      hostId: p._id,
      maxPlayers: size,
      difficulty: level,
      mapId: map,
      enemyCount: enemies(enemyCount, map),
      members: [p._id],
      status: 'waiting',
      createdAt: Date.now(),
    });
    await ctx.db.patch(p._id, { activeLobbyId: id, activeSectorId: null });
    return id;
  },
});
export const joinLobby = mutation({
  args: { ...auth, code: v.string() },
  handler: async (ctx, { token, code }) => {
    const p = await player(ctx, token);
    const lobby = await ctx.db
      .query('lobbies')
      .withIndex('by_code', (q) => q.eq('code', code.trim().toUpperCase()))
      .unique();
    if (!lobby || lobby.status === 'closed')
      throw new ConvexError('No open lobby matches that code.');
    if (lobby.status !== 'waiting')
      throw new ConvexError(
        'This operation has already started. Join a waiting lobby.',
      );
    if (lobby.members.includes(p._id)) return lobby._id;
    await available(ctx, p);
    if (lobby.members.length >= lobby.maxPlayers)
      throw new ConvexError('This lobby is full.');
    await ctx.db.patch(lobby._id, { members: [...lobby.members, p._id] });
    await ctx.db.patch(p._id, {
      activeLobbyId: lobby._id,
      activeSectorId: null,
    });
    return lobby._id;
  },
});
export const configureLobby = mutation({
  args: {
    ...lobbyArgs,
    difficulty,
    mapId: v.optional(mapId),
    maxPlayers: v.number(),
    enemyCount: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { token, lobbyId, difficulty: level, maxPlayers, enemyCount, mapId },
  ) => {
    const { p, lobby } = await memberLobby(ctx, token, lobbyId);
    if (lobby.hostId !== p._id)
      throw new ConvexError('Only the host can change lobby settings.');
    if (lobby.status !== 'waiting')
      throw new ConvexError('This operation has already started.');
    const map = playableMapId(mapId ?? lobby.mapId);
    await ctx.db.patch(lobbyId, {
      difficulty: level,
      maxPlayers: capacity(maxPlayers, map, lobby.members.length),
      enemyCount: enemies(enemyCount ?? lobby.enemyCount, map),
      mapId: map,
    });
  },
});
export const leaveLobby = mutation({
  args: lobbyArgs,
  handler: async (ctx, { token, lobbyId }) => {
    const p = await player(ctx, token),
      lobby = await ctx.db.get(lobbyId);
    if (!lobby?.members.includes(p._id)) return;
    if (lobby.status !== 'waiting')
      throw new ConvexError('Withdraw from the operation to leave it.');
    const members = lobby.members.filter((id) => id !== p._id);
    await ctx.db.patch(lobbyId, {
      members,
      hostId: lobby.hostId === p._id ? (members[0] ?? p._id) : lobby.hostId,
      status: members.length ? 'waiting' : 'closed',
    });
    if (p.activeLobbyId === lobbyId)
      await ctx.db.patch(p._id, {
        activeLobbyId: undefined,
        lastAction: Date.now(),
      });
  },
});
export const startLobby = mutation({
  args: lobbyArgs,
  handler: async (ctx, { token, lobbyId }) => {
    const { p, lobby } = await memberLobby(ctx, token, lobbyId);
    if (lobby.hostId !== p._id)
      throw new ConvexError('Only the host can start the operation.');
    if (lobby.status === 'active' && lobby.sectorId) return lobby.sectorId;
    if (lobby.status !== 'waiting')
      throw new ConvexError('This lobby is closed.');
    const members = await Promise.all(
      lobby.members.map((id) => ctx.db.get(id)),
    );
    if (members.some((p) => !p || p.activeLobbyId !== lobbyId))
      throw new ConvexError(
        'The roster changed. Refresh the lobby and try again.',
      );
    return launch(ctx, members as Doc<'players'>[], lobby.difficulty, lobby);
  },
});
export const withdraw = mutation({
  args: { ...auth, sectorId: v.id('sectors') },
  handler: async (ctx, { token, sectorId }) => {
    const p = await player(ctx, token),
      b = await selectedBattle(ctx, p);
    if (!b || b._id !== sectorId || !b.commanders.some((c) => c.id === p._id))
      throw new ConvexError('This is not your current operation.');
    if (b.status === 'active') {
      withdrawCommander(b, { id: p._id, name: p.name }, Date.now());
      await ctx.db.patch(sectorId, clean(b));
    }
    await ctx.db.patch(p._id, { activeSectorId: null, lastAction: Date.now() });
    if (b.lobbyId) {
      const lobby = await ctx.db.get(b.lobbyId);
      if (lobby)
        await ctx.db.patch(lobby._id, {
          members: lobby.members.filter((id) => id !== p._id),
          ...(b.status !== 'active' ? { status: 'closed' as const } : {}),
        });
    }
  },
});
