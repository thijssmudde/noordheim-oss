import { afterEach, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { DIFFICULTIES } from '../lib/tactical-difficulty';
import { isUnit, type Battle } from '../lib/tactics';
const modules = import.meta.glob('../convex/**/*.ts');
afterEach(() => vi.useRealTimers());

// Regression: the stored sector dropped the hostile production queue on every
// tick, so garrisons kept re-ordering their first troops and never fielded one.
test('hostile garrisons train troops across server ticks and send a column', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const t = convexTest(schema, modules);
  const alice = 'a'.repeat(64);
  await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
  const id = await t.mutation(api.operations.solo, {
    token: alice,
    difficulty: 'hard',
    mapId: 'glaciercrown',
    enemyCount: 4,
  });
  const fresh = (await t.run((ctx) => ctx.db.get(id)))!;
  expect(fresh.hostileTraining ?? []).toHaveLength(0);
  const redUnits = (b: Pick<Battle, 'entities'>) =>
    b.entities.filter((e) => e.team === 'red' && e.hp > 0 && isUnit(e.kind));
  expect(redUnits(fresh)).toHaveLength(0);

  // One stored round trip must keep the orders the garrisons just placed.
  let expected = 1000;
  const step = async () => {
    vi.setSystemTime(expected + 2000);
    await t.mutation(internal.tactics.tick, { id, expected });
    const b = (await t.run((ctx) => ctx.db.get(id)))!;
    expected = b.tickAt;
    return b;
  };
  const afterOne = await step();
  expect(afterOne.hostileTraining!.length).toBeGreaterThan(0);
  const orders = afterOne.hostileTraining!.map((q) => q.id).sort();
  const afterTwo = await step();
  // The same orders are still in progress; nothing was re-ordered from scratch.
  for (const q of orders)
    expect(afterTwo.hostileTraining!.some((o) => o.id === q)).toBe(true);
  const stored = (await t.query(api.tactics.state, { token: alice }))!;
  expect('hostileTraining' in stored).toBe(false);

  // Well before the first counterattack the garrisons have fielded real troops.
  let b = afterTwo;
  while (b.tickAt - 1000 < 60000) b = await step();
  expect(redUnits(b).length).toBeGreaterThan(0);
  for (const owner of ['hostile-1', 'hostile-4'])
    expect(redUnits(b).filter((e) => e.owner === owner).length).toBeGreaterThan(
      0,
    );

  // And once the cadence allows, a column marches on the commander.
  const limit = DIFFICULTIES.hard.firstWaveMs + 4 * 60000;
  while (b.wave < 1 && b.tickAt - 1000 < limit) b = await step();
  expect(b.wave).toBe(1);
  expect(
    b.entities.filter((e) => e.team === 'red' && e.order === 'attackMove')
      .length,
  ).toBeGreaterThanOrEqual(5);
}, 180000);
