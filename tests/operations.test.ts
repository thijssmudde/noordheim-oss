import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { DIFFICULTIES } from '../lib/tactical-difficulty';

const modules = import.meta.glob('../convex/**/*.ts');
const tokens = Array.from({ length: 10 }, (_, i) =>
  (i + 1).toString(16).repeat(64),
);
const [alice, bob, charlie] = tokens;
async function setup(count = 3) {
  const t = convexTest(schema, modules);
  const ids = [];
  for (let i = 0; i < count; i++)
    ids.push(
      await t.mutation(api.players.connect, {
        token: tokens[i],
        name: `Commander ${i + 1}`,
      }),
    );
  return { t, ids };
}
describe('Independent operations and multiplayer lobbies', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('enemy settings persist in solo and hosted lobbies and validate limits', async () => {
    const { t } = await setup();
    for (const enemyCount of [0, 9, 1.5]) {
      await expect(
        t.mutation(api.operations.solo, {
          token: alice,
          difficulty: 'normal',
          enemyCount,
        }),
      ).rejects.toThrow('1 and 8');
    }
    await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'normal',
      enemyCount: 8,
      mapId: 'nordlys',
    });
    const solo = await t.query(api.tactics.state, { token: alice });
    expect(solo?.enemyCount).toBe(8);
    expect(solo?.enemyForces.headquarters).toBe(8);
    expect(solo?.mapScale).toBe(1);
    expect(solo?.playerSlots).toBe(1);
    const lobbyId = await t.mutation(api.operations.createLobby, {
      token: bob,
      difficulty: 'easy',
      maxPlayers: 2,
      enemyCount: 3,
      mapId: 'nordlys',
    });
    await t.mutation(api.operations.configureLobby, {
      token: bob,
      lobbyId,
      difficulty: 'normal',
      maxPlayers: 2,
      enemyCount: 5,
    });
    expect(
      (await t.query(api.operations.overview, { token: bob })).lobby
        ?.enemyCount,
    ).toBe(5);
    await expect(
      t.mutation(api.operations.configureLobby, {
        token: bob,
        lobbyId,
        difficulty: 'normal',
        maxPlayers: 2,
        enemyCount: 9,
      }),
    ).rejects.toThrow('1 and 8');
    await t.mutation(api.operations.startLobby, { token: bob, lobbyId });
    const coop = await t.query(api.tactics.state, { token: bob });
    expect(coop?.enemyCount).toBe(5);
    expect(coop?.enemyForces.headquarters).toBe(5);
    expect(coop?.mapScale).toBe(1);
    expect(coop?.playerSlots).toBe(2);
    // A stale client asking the starter map for more armies than it holds is clamped.
    await t.mutation(api.operations.withdraw, {
      token: alice,
      sectorId: solo!.id,
    });
    await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'normal',
      enemyCount: 6,
      mapId: 'fjordmouth',
    });
    expect(
      (await t.query(api.tactics.state, { token: alice }))?.enemyCount,
    ).toBe(2);
  });

  test('solo games are separate, private, persistent, and cannot be commanded by outsiders', async () => {
    const { t, ids } = await setup();
    const a = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'easy',
    });
    expect(
      await t.mutation(api.operations.solo, {
        token: alice,
        difficulty: 'easy',
      }),
    ).toBe(a);
    expect(
      (await t.query(api.operations.overview, { token: bob })).battle,
    ).toBeNull();
    expect(await t.query(api.tactics.state, { token: bob })).toBeNull();
    expect((await t.query(api.players.lobby, {})).operation).toBeNull();
    const b = await t.mutation(api.operations.solo, {
      token: bob,
      difficulty: 'brutal',
    });
    expect(a).not.toBe(b);
    const [sa, sb] = await Promise.all([
      t.query(api.tactics.state, { token: alice }),
      t.query(api.tactics.state, { token: bob }),
    ]);
    expect(sa!.id).toBe(a);
    expect(sb!.id).toBe(b);
    expect(sa!.mode).toBe('solo');
    expect(sa!.commanders.map((c) => c.id)).toEqual([ids[0]]);
    expect(sb!.commanders.map((c) => c.id)).toEqual([ids[1]]);
    expect(sa!.commanders[0].credits).toBe(DIFFICULTIES.easy.credits);
    expect(sb!.commanders[0].credits).toBe(DIFFICULTIES.brutal.credits);
    await expect(
      t.mutation(api.tactics.produce, {
        token: bob,
        sectorId: a,
        kind: 'reactor',
        placement: { position: { x: -88, z: 60 }, rotation: 2 },
      }),
    ).rejects.toThrow('Join this operation');
    await expect(
      t.mutation(api.tactics.command, {
        token: charlie,
        sectorId: a,
        ids: [sa!.entities.find((e) => e.kind === 'ranger')!.id],
        order: 'move',
        point: { x: -110, z: 40 },
      }),
    ).rejects.toThrow('Join this operation');
    const before = await t.run((ctx) => ctx.db.get(b));
    vi.setSystemTime(1250);
    await t.mutation(internal.tactics.tick, { id: a, expected: 1000 });
    expect(await t.run((ctx) => ctx.db.get(b))).toEqual(before);
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle?.id,
    ).toBe(a);
    expect(
      (await t.query(api.operations.overview, { token: charlie })).openLobbies,
    ).toEqual([]);
  });

  test('waiting rooms do not generate or simulate a battle; the host starts everyone together', async () => {
    const { t, ids } = await setup();
    const id = await t.mutation(api.operations.createLobby, {
      token: alice,
      name: 'Fjord patrol',
      difficulty: 'hard',
      maxPlayers: 4,
      mapId: 'glaciercrown',
    });
    const room = (await t.query(api.operations.overview, { token: alice }))
      .lobby!;
    expect(room).toMatchObject({
      id,
      name: 'Fjord patrol',
      difficulty: 'hard',
      count: 1,
      maxPlayers: 4,
      hostId: ids[0],
    });
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(
      await t.mutation(api.operations.createLobby, {
        token: alice,
        difficulty: 'hard',
        maxPlayers: 4,
        mapId: 'glaciercrown',
      }),
    ).toBe(id);
    expect(
      (await t.query(api.operations.overview, { token: bob })).openLobbies.map(
        (l) => l.id,
      ),
    ).toContain(id);
    expect(
      await t.mutation(api.operations.joinLobby, {
        token: bob,
        code: ` ${room.code.toLowerCase()} `,
      }),
    ).toBe(id);
    expect(
      await t.mutation(api.operations.joinLobby, {
        token: bob,
        code: room.code,
      }),
    ).toBe(id);
    expect(
      await t.run((ctx) => ctx.db.query('sectors').collect()),
    ).toHaveLength(0);
    expect(await t.query(api.tactics.state, { token: alice })).toBeNull();
    await expect(
      t.mutation(api.operations.startLobby, { token: bob, lobbyId: id }),
    ).rejects.toThrow('Only the host');
    await expect(
      t.mutation(api.operations.startLobby, { token: charlie, lobbyId: id }),
    ).rejects.toThrow('Join this lobby');
    await expect(
      t.mutation(api.operations.configureLobby, {
        token: bob,
        lobbyId: id,
        difficulty: 'easy',
        maxPlayers: 8,
      }),
    ).rejects.toThrow('Only the host');
    await t.mutation(api.operations.configureLobby, {
      token: alice,
      lobbyId: id,
      difficulty: 'normal',
      maxPlayers: 3,
    });
    vi.setSystemTime(100000);
    const sectorId = await t.mutation(api.operations.startLobby, {
      token: alice,
      lobbyId: id,
    });
    expect(
      await t.mutation(api.operations.startLobby, {
        token: alice,
        lobbyId: id,
      }),
    ).toBe(sectorId);
    for (const token of [alice, bob]) {
      const state = (await t.query(api.tactics.state, { token }))!;
      expect(state.id).toBe(sectorId);
      expect(state.mode).toBe('coop');
      expect(state.maxPlayers).toBe(3);
      expect(state.startedAt).toBe(100000);
      expect(state.nextWaveAt).toBe(100000 + DIFFICULTIES.normal.firstWaveMs);
      expect(state.commanders.map((c) => c.id)).toEqual(ids.slice(0, 2));
      expect(new Set(state.commanders.map((c) => c.slot)).size).toBe(2);
      expect(state.commanders.map((c) => c.slot)).toEqual(
        (await t.query(api.tactics.state, { token: alice }))!.commanders.map(
          (c) => c.slot,
        ),
      );
      expect(
        (await t.query(api.operations.overview, { token })).lobby,
      ).toBeNull();
    }
    await expect(
      t.mutation(api.operations.joinLobby, { token: charlie, code: room.code }),
    ).rejects.toThrow('already started');
    await expect(
      t.mutation(api.operations.configureLobby, {
        token: alice,
        lobbyId: id,
        difficulty: 'brutal',
        maxPlayers: 8,
      }),
    ).rejects.toThrow('already started');
    expect(
      (await t.query(api.operations.overview, { token: charlie })).openLobbies,
    ).toEqual([]);
  });

  test('up to eight unique players can join, capacity is validated, and multiple lobbies coexist', async () => {
    const { t } = await setup(10);
    for (const maxPlayers of [0, 1, 9, 2.5])
      await expect(
        t.mutation(api.operations.createLobby, {
          token: alice,
          difficulty: 'normal',
          maxPlayers,
        }),
      ).rejects.toThrow('2 to 8');
    const id = await t.mutation(api.operations.createLobby, {
      token: alice,
      difficulty: 'normal',
      maxPlayers: 8,
      mapId: 'nordlys',
    });
    const room = (await t.query(api.operations.overview, { token: alice }))
      .lobby!;
    for (const token of tokens.slice(1, 8))
      await t.mutation(api.operations.joinLobby, { token, code: room.code });
    expect(
      (await t.query(api.operations.overview, { token: alice })).lobby?.count,
    ).toBe(8);
    await expect(
      t.mutation(api.operations.joinLobby, {
        token: tokens[8],
        code: room.code,
      }),
    ).rejects.toThrow('full');
    await expect(
      t.mutation(api.operations.configureLobby, {
        token: alice,
        lobbyId: id,
        difficulty: 'normal',
        maxPlayers: 7,
      }),
    ).rejects.toThrow('current roster');
    // A full roster cannot move to a map with fewer landings.
    await expect(
      t.mutation(api.operations.configureLobby, {
        token: alice,
        lobbyId: id,
        difficulty: 'normal',
        maxPlayers: 8,
        mapId: 'ironpass',
      }),
    ).rejects.toThrow('Iron Pass holds 4 players; the lobby has 8.');
    const second = await t.mutation(api.operations.createLobby, {
      token: tokens[8],
      difficulty: 'easy',
      maxPlayers: 2,
    });
    const other = (await t.query(api.operations.overview, { token: tokens[8] }))
      .lobby!;
    expect(second).not.toBe(id);
    expect(other.code).not.toBe(room.code);
    await t.mutation(api.operations.joinLobby, {
      token: tokens[9],
      code: other.code,
    });
    const a = await t.mutation(api.operations.startLobby, {
      token: alice,
      lobbyId: id,
    });
    const b = await t.mutation(api.operations.startLobby, {
      token: tokens[8],
      lobbyId: second,
    });
    expect((await t.run((ctx) => ctx.db.get(a)))!.commanders).toHaveLength(8);
    expect((await t.run((ctx) => ctx.db.get(b)))!.commanders).toHaveLength(2);
    expect((await t.query(api.tactics.state, { token: bob }))!.id).toBe(a);
    expect((await t.query(api.tactics.state, { token: tokens[9] }))!.id).toBe(
      b,
    );
  });

  test('leaving transfers host ownership, frees a place, and closes an empty lobby', async () => {
    const { t, ids } = await setup();
    const id = await t.mutation(api.operations.createLobby, {
      token: alice,
      difficulty: 'easy',
      maxPlayers: 2,
    });
    const code = (await t.query(api.operations.overview, { token: alice }))
      .lobby!.code;
    await t.mutation(api.operations.joinLobby, { token: bob, code });
    await expect(
      t.mutation(api.operations.solo, { token: bob, difficulty: 'easy' }),
    ).rejects.toThrow('Leave your current lobby');
    await t.mutation(api.operations.leaveLobby, { token: alice, lobbyId: id });
    expect(
      (await t.query(api.operations.overview, { token: bob })).lobby?.hostId,
    ).toBe(ids[1]);
    expect(
      (await t.query(api.operations.overview, { token: alice })).lobby,
    ).toBeNull();
    await t.mutation(api.operations.joinLobby, { token: charlie, code });
    await t.mutation(api.operations.leaveLobby, { token: bob, lobbyId: id });
    await t.mutation(api.operations.leaveLobby, {
      token: charlie,
      lobbyId: id,
    });
    await t.mutation(api.operations.leaveLobby, {
      token: charlie,
      lobbyId: id,
    });
    expect((await t.run((ctx) => ctx.db.get(id)))!.status).toBe('closed');
    await expect(
      t.mutation(api.operations.joinLobby, { token: alice, code }),
    ).rejects.toThrow('No open lobby');
    await expect(
      t.mutation(api.operations.joinLobby, { token: alice, code: 'BAD123' }),
    ).rejects.toThrow('No open lobby');
  });

  test('withdrawing only removes your forces; the remaining ally can continue', async () => {
    const { t, ids } = await setup();
    const lobbyId = await t.mutation(api.operations.createLobby, {
      token: alice,
      difficulty: 'normal',
      maxPlayers: 2,
    });
    const code = (await t.query(api.operations.overview, { token: alice }))
      .lobby!.code;
    await t.mutation(api.operations.joinLobby, { token: bob, code });
    const sectorId = await t.mutation(api.operations.startLobby, {
      token: alice,
      lobbyId,
    });
    await expect(
      t.mutation(api.operations.createLobby, {
        token: bob,
        difficulty: 'normal',
        maxPlayers: 8,
      }),
    ).rejects.toThrow('Withdraw');
    await expect(
      t.mutation(api.operations.withdraw, { token: charlie, sectorId }),
    ).rejects.toThrow('not your current');
    await t.mutation(api.operations.withdraw, { token: alice, sectorId });
    const battle = (await t.query(api.tactics.state, { token: bob }))!;
    expect(battle.status).toBe('active');
    expect(battle.commanders.map((c) => c.id)).toEqual([ids[1]]);
    expect(battle.entities.some((e) => e.owner === ids[0])).toBe(false);
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle,
    ).toBeNull();
    expect(await t.query(api.tactics.state, { token: alice })).toBeNull();
    const soloId = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'easy',
    });
    expect(soloId).not.toBe(sectorId);
    await t.mutation(api.operations.withdraw, { token: bob, sectorId });
    expect((await t.run((ctx) => ctx.db.get(sectorId)))!.status).toBe('defeat');
    expect((await t.run((ctx) => ctx.db.get(soloId)))!.status).toBe('active');
    await t.mutation(api.operations.withdraw, {
      token: alice,
      sectorId: soloId,
    });
    expect((await t.run((ctx) => ctx.db.get(soloId)))!.status).toBe('defeat');
  });

  test('the compatibility deployment never admits a player into a private match', async () => {
    const { t } = await setup();
    const privateId = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'normal',
    });
    const legacyId = await t.mutation(api.tactics.deploy, { token: bob });
    expect(legacyId).not.toBe(privateId);
    expect(await t.mutation(api.tactics.deploy, { token: alice })).toBe(
      privateId,
    );
    expect((await t.query(api.tactics.state, { token: alice }))!.id).toBe(
      privateId,
    );
    expect((await t.query(api.tactics.state, { token: bob }))!.id).toBe(
      legacyId,
    );
  });
  test('legacy commanders can withdraw and reused landing slots never overlap', async () => {
    const { t, ids } = await setup();
    const sectorId = await t.mutation(api.tactics.deploy, { token: alice });
    await t.mutation(api.tactics.deploy, { token: bob });
    const originalSlots = (await t.query(api.tactics.state, {
      token: bob,
    }))!.commanders
      .map((c) => c.slot)
      .sort((a, b) => a - b);
    // Simulate a commander whose operation predates persisted match selection.
    await t.run((ctx) => ctx.db.patch(ids[0], { activeSectorId: undefined }));
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle?.id,
    ).toBe(sectorId);
    await t.mutation(api.operations.withdraw, { token: alice, sectorId });
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle,
    ).toBeNull();
    await t.mutation(api.tactics.deploy, { token: charlie });
    const state = (await t.query(api.tactics.state, { token: bob }))!;
    expect(state.commanders.map((c) => c.slot).sort((a, b) => a - b)).toEqual(
      originalSlots,
    );
    const room = await t.mutation(api.operations.createLobby, {
      token: alice,
      difficulty: 'easy',
      maxPlayers: 2,
    });
    expect(
      (await t.query(api.operations.overview, { token: alice })).lobby?.id,
    ).toBe(room);
    expect(await t.query(api.tactics.state, { token: alice })).toBeNull();
  });
});
