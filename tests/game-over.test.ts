import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import {
  commanderEliminated,
  hasLivingBuildings,
  isUnit,
  issueOrder,
  joinBattle,
  makeEntity,
  newBattle,
  OPERATION_MINUTES,
  purchase,
  tickBattle,
} from '../lib/tactics';

const modules = import.meta.glob('../convex/**/*.ts');
const alice = 'a'.repeat(64),
  bob = 'b'.repeat(64);
function battle() {
  const b = newBattle(1000, { seed: 21 });
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
  return b;
}

describe('Flag defeat', () => {
  test('a destroyed command station no longer collapses its force; the flag stands', () => {
    const b = battle();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    const before = b.entities.filter((e) => e.owner === 'alice').length;
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    hq.hp = 0;
    tickBattle(b, 2000);
    expect(b.entities.filter((e) => e.owner === 'alice')).toHaveLength(
      before - 1,
    );
    expect(commanderEliminated(b, 'alice')).toBe(false);
    expect(b.flags!.find((f) => f.owner === 'alice')!.capturedAt).toBe(
      undefined,
    );
    expect(b.status).toBe('active');
    // Without a completed structure there is nothing to build from.
    expect(() =>
      purchase(b, 'alice', 'reactor', 2000, {
        position: { x: hq.x + 16, z: hq.z },
        rotation: 2,
      }),
    ).toThrow('command station');
  });

  test('a destroyed hostile command station leaves that army fighting for its flag', () => {
    const b = newBattle(1000, { seed: 21, enemyCount: 2 });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const hq = b.entities.find(
      (e) => e.owner === 'hostile-1' && e.kind === 'hq',
    )!;
    const others = b.entities.filter((e) => e.owner === 'hostile-1').length;
    hq.hp = 0;
    tickBattle(b, 2000);
    expect(b.entities.filter((e) => e.owner === 'hostile-1')).toHaveLength(
      others - 1,
    );
    expect(b.status).toBe('active');
  });

  test('losing every structure and troop eliminates a commander even before their flag falls', () => {
    const b = battle();
    b.entities = b.entities.filter((e) => e.owner !== 'alice');
    tickBattle(b, 2000);
    expect(b.status).toBe('defeat');
    expect(b.commanders[0].eliminatedAt).toBe(2000);
    expect(b.events.some((e) => e.text.includes('all forces lost'))).toBe(
      true,
    );
    const ended = structuredClone(b);
    tickBattle(b, 5000);
    expect(b).toEqual(ended);
  });

  test('a captured flag eliminates its commander; co-op allies fight on and win by capturing every flag', () => {
    const b = battle();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    const c = b.commanders[0];
    c.researching = { key: 'clearance2', readyAt: 9000 };
    c.researchQueue = ['clearance3'];
    b.flags!.find((f) => f.owner === 'alice')!.capturedAt = 1500;
    tickBattle(b, 2000);
    expect(b.status).toBe('active');
    expect(c.eliminatedAt).toBe(2000);
    expect(c.researching).toBeUndefined();
    expect(c.researchQueue).toEqual([]);
    expect(b.events.some((e) => e.text.includes('flag captured'))).toBe(true);
    const unit = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    expect(() => issueOrder(b, 'alice', [unit.id], 'hold')).toThrow(
      'eliminated',
    );
    expect(() => purchase(b, 'alice', 'reactor', 2000)).toThrow('eliminated');
    const ally = b.entities.find((e) => e.owner === 'bob' && isUnit(e.kind))!;
    expect(() => issueOrder(b, 'bob', [ally.id], 'hold')).not.toThrow();
    // Destroying every hostile entity is not enough: the flags must fall.
    b.entities = b.entities.filter((e) => e.team === 'blue');
    tickBattle(b, 3000);
    expect(b.status).toBe('active');
    for (const f of b.flags!) if (f.team === 'red') f.capturedAt = 3000;
    tickBattle(b, 4000);
    expect(b.status).toBe('victory');
    expect(commanderEliminated(b, 'alice')).toBe(true);
    expect(commanderEliminated(b, 'bob')).toBe(false);
    expect(hasLivingBuildings(b, 'bob')).toBe(true);
  });

  test('the operation is lost when every commander is out', () => {
    const b = battle();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    for (const f of b.flags!) if (f.team === 'blue') f.capturedAt = 1500;
    tickBattle(b, 2000);
    expect(b.status).toBe('defeat');
    expect(
      b.events.some((e) => e.text.includes('Every allied flag has fallen')),
    ).toBe(true);
  });
});

describe('Game-over routing and returning to operations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('personal defeat persists, rejects orders, and returns to the menu without ending allies’ game', async () => {
    const t = convexTest(schema, modules);
    const aid = await t.mutation(api.players.connect, {
      token: alice,
      name: 'Alice',
    });
    const bid = await t.mutation(api.players.connect, {
      token: bob,
      name: 'Bob',
    });
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle,
    ).toBeNull();
    const lobbyId = await t.mutation(api.operations.createLobby, {
      token: alice,
      difficulty: 'normal',
      maxPlayers: 8,
    });
    const lobby = (await t.query(api.operations.overview, { token: alice }))
      .lobby!;
    await t.mutation(api.operations.joinLobby, {
      token: bob,
      code: lobby.code,
    });
    const id = await t.mutation(api.operations.startLobby, {
      token: alice,
      lobbyId,
    });
    await t.run(async (ctx) => {
      const b = (await ctx.db.get(id))!;
      // Bob's non-HQ building also keeps the shared match alive after Alice returns to the menu.
      b.entities.push(
        makeEntity(b, 'reactor', bid, 'blue', { x: -140, z: 30 }),
      );
      await ctx.db.patch(id, {
        serial: b.serial,
        entities: b.entities.filter((e) =>
          e.owner === aid ? isUnit(e.kind) : e.owner !== bid || e.kind !== 'hq',
        ),
        // Alice's flag has just fallen.
        flags: b.flags!.map((f) =>
          f.owner === aid ? { ...f, capturedAt: 1500 } : f,
        ),
      });
    });
    vi.setSystemTime(2000);
    await t.mutation(internal.tactics.tick, { id, expected: 1000 });
    const own = (await t.query(api.operations.overview, { token: alice }))
      .battle!;
    expect(own).toMatchObject({
      id,
      status: 'active',
      gameOver: 'flag',
      startedAt: 1000,
      endedAt: 2000,
    });
    expect(
      (await t.query(api.operations.overview, { token: bob })).battle?.gameOver,
    ).toBeNull();
    const state = (await t.query(api.tactics.state, { token: alice }))!;
    const unit = state.entities.find((e) => e.owner === aid && isUnit(e.kind))!;
    await expect(
      t.mutation(api.tactics.command, {
        token: alice,
        sectorId: id,
        ids: [unit.id],
        order: 'hold',
      }),
    ).rejects.toThrow('eliminated');
    vi.setSystemTime(3000);
    await t.mutation(internal.tactics.tick, { id, expected: 2000 });
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle
        ?.endedAt,
    ).toBe(2000);
    await t.mutation(api.operations.withdraw, { token: alice, sectorId: id });
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle,
    ).toBeNull();
    const remaining = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(remaining.status).toBe('active');
    expect(remaining.entities.some((e) => e.owner === aid)).toBe(false);
    expect(remaining.commanders.map((c) => c.id)).toEqual([bid]);
    const fresh = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'easy',
    });
    expect(fresh).not.toBe(id);
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle
        ?.gameOver,
    ).toBeNull();
  });

  test('operation timeouts use their own defeat message, and solo defeat can be dismissed', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    const id = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'easy',
    });
    vi.setSystemTime(1001 + OPERATION_MINUTES * 60000);
    await t.mutation(internal.tactics.tick, { id, expected: 1000 });
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle,
    ).toMatchObject({ status: 'defeat', gameOver: 'timeout' });
    await t.mutation(api.operations.withdraw, { token: alice, sectorId: id });
    expect(
      (await t.query(api.operations.overview, { token: alice })).battle,
    ).toBeNull();
  });
});
