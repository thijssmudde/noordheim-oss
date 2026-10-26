import { afterEach, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';

const modules = import.meta.glob('../convex/**/*.ts');
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const t = convexTest(schema, modules),
    token = 'c'.repeat(64);
  const owner = await t.mutation(api.players.connect, {
    token,
    name: 'Commander',
  });
  const sectorId = await t.mutation(api.operations.solo, {
    token,
    difficulty: 'easy',
  });
  const b = (await t.run((ctx) => ctx.db.get(sectorId)))!;
  const units = b.entities.filter(
    (e) => e.owner === owner && e.kind === 'ranger',
  );
  return { t, token, sectorId, b, units };
}
test('new commands wake routing immediately and queued squads do not wait a tick each', async () => {
  const { t, token, sectorId, units } = await setup();
  for (const unit of units.slice(0, 2))
    await t.mutation(api.tactics.command, {
      token,
      sectorId,
      ids: [unit.id],
      order: 'move',
      point: { x: unit.x + 5, z: unit.z },
    });
  await vi.advanceTimersByTimeAsync(10);
  await t.finishInProgressScheduledFunctions();
  const first = (await t.run((ctx) => ctx.db.get(sectorId)))!;
  expect(first.entities.find((e) => e.id === units[0].id)!.order).toBe('move');
  expect(
    await t.run((ctx) => ctx.db.query('battleOrders').collect()),
  ).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(10);
  await t.finishInProgressScheduledFunctions();
  const routed = (await t.run((ctx) => ctx.db.get(sectorId)))!;
  expect(routed.entities.find((e) => e.id === units[1].id)!.order).toBe('move');
  expect(
    await t.run((ctx) => ctx.db.query('battleOrders').collect()),
  ).toHaveLength(0);
  // The original periodic tick is now obsolete; it must not fork the tick chain.
  await vi.advanceTimersByTimeAsync(230);
  await t.finishInProgressScheduledFunctions();
  expect(await t.run((ctx) => ctx.db.get(sectorId))).toEqual(routed);
  await vi.advanceTimersByTimeAsync(20);
  await t.finishInProgressScheduledFunctions();
  expect((await t.run((ctx) => ctx.db.get(sectorId)))!.tickAt).toBe(1270);
});
test('redirects coalesce without writing the hot battle; different squads retain their orders', async () => {
  const { t, token, sectorId, b, units } = await setup();
  for (let i = 0; i < 10; i++)
    await t.mutation(api.tactics.command, {
      token,
      sectorId,
      ids: [units[0].id],
      order: 'move',
      point: { x: units[0].x + 3 + i / 10, z: units[0].z },
    });
  await t.mutation(api.tactics.command, {
    token,
    sectorId,
    ids: [units[1].id],
    order: 'hold',
  });
  expect(await t.run((ctx) => ctx.db.get(sectorId))).toEqual(b);
  expect(
    await t.run((ctx) => ctx.db.query('battleOrders').collect()),
  ).toHaveLength(2);
  vi.setSystemTime(1250);
  await t.mutation(internal.tactics.tick, { id: sectorId, expected: 1000 });
  const first = (await t.run((ctx) => ctx.db.get(sectorId)))!;
  expect(
    first.entities.find((e) => e.id === units[0].id)!.path.at(-1)?.x,
  ).toBeCloseTo(units[0].x + 3.9);
  expect(
    await t.run((ctx) => ctx.db.query('battleOrders').collect()),
  ).toHaveLength(1);
  vi.setSystemTime(1500);
  await t.mutation(internal.tactics.tick, { id: sectorId, expected: 1250 });
  expect(
    (await t.run((ctx) => ctx.db.get(sectorId)))!.entities.find(
      (e) => e.id === units[1].id,
    )!.order,
  ).toBe('hold');
  expect(
    await t.run((ctx) => ctx.db.query('battleOrders').collect()),
  ).toHaveLength(0);
});
test('a squad losing a selected unit does not lose the surviving units order', async () => {
  const { t, token, sectorId, units } = await setup();
  await t.mutation(api.tactics.command, {
    token,
    sectorId,
    ids: units.map((e) => e.id),
    order: 'hold',
  });
  await t.run(async (ctx) => {
    const b = (await ctx.db.get(sectorId))!;
    await ctx.db.patch(sectorId, {
      entities: b.entities.filter((e) => e.id !== units[0].id),
    });
  });
  vi.setSystemTime(1250);
  await t.mutation(internal.tactics.tick, { id: sectorId, expected: 1000 });
  expect(
    (await t.run((ctx) => ctx.db.get(sectorId)))!.entities.find(
      (e) => e.id === units[1].id,
    )!.order,
  ).toBe('hold');
});
