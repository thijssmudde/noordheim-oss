import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { ENDED_GRACE_MS, IDLE_GRACE_MS } from '../convex/cleanup';

const modules = import.meta.glob('../convex/**/*.ts');
const alice = 'a'.repeat(64),
  bob = 'b'.repeat(64),
  carol = 'c'.repeat(64);

describe('Purging abandoned operations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => vi.useRealTimers());

  test('an ended operation, its orders and its commanders vanish after the grace period, freeing the callsign', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Thijs' });
    const id = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'normal',
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { status: 'defeat' });
    });
    // Too early: the Game Over screen is still readable and the name stays taken.
    vi.setSystemTime(1000 + ENDED_GRACE_MS - 1000);
    expect(await t.mutation(internal.cleanup.purgeAbandoned, {})).toBe(0);
    await expect(
      t.mutation(api.players.connect, { token: bob, name: 'thijs' }),
    ).rejects.toThrow('already taken');
    vi.setSystemTime(1000 + ENDED_GRACE_MS + 1000);
    expect(await t.mutation(internal.cleanup.purgeAbandoned, {})).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
    expect(await t.query(api.players.session, { token: alice })).toBeNull();
    await expect(
      t.mutation(api.players.connect, { token: bob, name: 'Thijs' }),
    ).resolves.toBeDefined();
  });

  test('operations nobody commands any more are purged at once; live ones and waiting rooms stay', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    await t.mutation(api.players.connect, { token: carol, name: 'Carol' });
    const abandoned = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'normal',
    });
    await t.mutation(api.operations.withdraw, {
      token: alice,
      sectorId: abandoned,
    });
    const live = await t.mutation(api.operations.solo, {
      token: bob,
      difficulty: 'easy',
    });
    const lobbyId = await t.mutation(api.operations.createLobby, {
      token: carol,
      difficulty: 'hard',
      maxPlayers: 4,
    });
    vi.setSystemTime(1000 + IDLE_GRACE_MS * 2);
    await t.mutation(internal.cleanup.purgeAbandoned, {});
    // Alice withdrew: her operation is gone and, after the idle grace, so is she.
    expect(await t.run((ctx) => ctx.db.get(abandoned))).toBeNull();
    expect(await t.query(api.players.session, { token: alice })).toBeNull();
    // Bob is still fighting; Carol still waits for friends.
    expect(await t.run((ctx) => ctx.db.get(live))).not.toBeNull();
    expect(await t.query(api.players.session, { token: bob })).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(lobbyId))).not.toBeNull();
    expect(await t.query(api.players.session, { token: carol })).not.toBeNull();
  });

  test('a commander who just withdrew keeps their identity through the idle grace', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    vi.setSystemTime(1000 + IDLE_GRACE_MS * 3);
    const id = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'normal',
    });
    await t.mutation(api.operations.withdraw, { token: alice, sectorId: id });
    vi.setSystemTime(Date.now() + IDLE_GRACE_MS / 2);
    await t.mutation(internal.cleanup.purgeAbandoned, {});
    expect(await t.query(api.players.session, { token: alice })).not.toBeNull();
    vi.setSystemTime(Date.now() + IDLE_GRACE_MS);
    await t.mutation(internal.cleanup.purgeAbandoned, {});
    expect(await t.query(api.players.session, { token: alice })).toBeNull();
  });
});
