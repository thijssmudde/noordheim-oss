import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { BattleAudioDirector } from '../lib/audio-policy';
import {
  TACTICAL_BUILDINGS,
  EARLY_BUILD_SCALE,
  COMMAND_LIMIT,
  CREDIT_CAP,
  STARTING_CREDITS,
  TRAINING_QUEUE_LIMIT,
  cancelTraining,
  isUnit,
  joinBattle,
  makeEntity,
  migrateTraining,
  newBattle,
  powerFor,
  purchase,
  tickBattle,
  trainingBlockReason,
  trainingCount,
  trainingHead,
  type Battle,
} from '../lib/tactics';
import { productionExit } from '../lib/tactical-placement';
import { terrainFor } from '../lib/tactical-terrain';
const modules = import.meta.glob('../convex/**/*.ts');
/** Laid out around the old first landing at (-110, 62), kept relative to Alice's. */
const HOME = terrainFor({}).baseAt(0);
const at = (x: number, z: number) => ({
  x: x + 110 + HOME.x,
  z: z - 62 + HOME.z,
});
const sites = {
  reactor: at(-88, 60),
  refinery: at(-126, 64),
  barracks: at(-90, 78),
  factory: at(-110, 84),
};
function place(b: Battle, kind: keyof typeof sites, owner = 'alice') {
  const e = makeEntity(b, kind, owner, 'blue', sites[kind]);
  e.angle = Math.PI;
  b.entities.push(e);
  return e;
}
function setup(kinds: (keyof typeof sites)[] = ['barracks']) {
  const b = newBattle(1000);
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
  b.commanders[0].credits = 20000;
  for (const kind of kinds) place(b, kind);
  return b;
}
describe('Independent troop production', () => {
  test('100 paid troops fit in a bounded backlog without taking battlefield space or power', () => {
    const b = setup(),
      entities = structuredClone(b.entities),
      power = powerFor(b, 'alice');
    purchase(b, 'alice', 'ranger', 1000, undefined, 100);
    expect(trainingCount(b, 'alice')).toBe(TRAINING_QUEUE_LIMIT);
    expect(b.entities).toEqual(entities);
    expect(powerFor(b, 'alice')).toEqual(power);
    expect(b.commanders[0].credits).toBe(10000);
    const before = structuredClone(b);
    expect(() => purchase(b, 'alice', 'ranger', 1000)).toThrow('queue full');
    expect(b).toEqual(before);
    purchase(b, 'alice', 'reactor', 1000, {
      position: sites.reactor,
      rotation: 2,
    });
    expect(b.entities.at(-1)!.readyAt).toBe(
      1000 +
        Math.round(TACTICAL_BUILDINGS.reactor.seconds * EARLY_BUILD_SCALE) *
          1000,
    );
    tickBattle(b, 9000);
    expect(trainingCount(b, 'alice')).toBe(99);
    expect(
      b.entities.filter((e) => e.owner === 'alice' && isUnit(e.kind)),
    ).toHaveLength(4);
    // Construction ran alongside the troop line and has already finished.
    expect(
      b.entities.find((e) => e.kind === 'reactor' && e.owner === 'alice')!
        .readyAt,
    ).toBe(0);
  });
  test('a full construction queue cannot block buying or training a batch', () => {
    const b = setup(['reactor', 'refinery', 'barracks']);
    purchase(b, 'alice', 'factory', 1000, {
      position: sites.factory,
      rotation: 2,
    });
    purchase(b, 'alice', 'outpost', 1000, {
      position: at(-126, 32),
      rotation: 2,
    });
    purchase(b, 'alice', 'reactor', 1000, {
      position: at(-80, 46),
      rotation: 2,
    });
    purchase(b, 'alice', 'ranger', 1000, undefined, 10);
    tickBattle(b, 9000);
    expect(trainingCount(b, 'alice')).toBe(9);
    expect(b.entities.filter((e) => e.readyAt)).toHaveLength(3);
  });
  test('infantry, vehicles and aircraft train in parallel lines, one unit at a time each', () => {
    const b = setup(['reactor', 'refinery', 'barracks', 'factory']);
    purchase(b, 'alice', 'ranger', 1000, undefined, 3);
    purchase(b, 'alice', 'rocket', 1000, undefined, 2);
    purchase(b, 'alice', 'lynx', 1000, undefined, 2);
    expect(trainingHead(b, 'alice', 'infantry')!.readyAt).toBe(9000);
    expect(trainingHead(b, 'alice', 'vehicle')!.readyAt).toBe(15000);
    expect(b.training!.find((q) => q.kind === 'rocket')!.readyAt).toBe(0);
    tickBattle(b, 15000);
    expect(
      b.entities.filter((e) => e.owner === 'alice' && e.kind === 'ranger'),
    ).toHaveLength(3);
    expect(
      b.entities.filter((e) => e.owner === 'alice' && e.kind === 'lynx'),
    ).toHaveLength(2);
    expect(trainingCount(b, 'alice', 'infantry')).toBe(4);
    expect(trainingCount(b, 'alice', 'vehicle')).toBe(1);
  });
  test('every completed factory trains its own vehicle and sends it to its own rally point', () => {
    const b = setup(['reactor', 'factory']),
      first = b.entities.find(
        (e) => e.owner === 'alice' && e.kind === 'factory',
      )!,
      second = makeEntity(b, 'factory', 'alice', 'blue', at(-150, 84));
    second.angle = Math.PI;
    b.entities.push(second);
    first.rally = at(-110, 40);
    second.rally = at(-150, 40);
    const veterans = new Set(b.entities.map((e) => e.id));
    purchase(b, 'alice', 'lynx', 1000, undefined, 4);
    expect(b.training![0].lines!.map((l) => l.producer)).toEqual([
      first.id,
      second.id,
    ]);
    tickBattle(b, 15000);
    const lynxes = () =>
      b.entities.filter(
        (e) => e.owner === 'alice' && e.kind === 'lynx' && !veterans.has(e.id),
      );
    // Two factories deliver two vehicles per build cycle.
    expect(lynxes()).toHaveLength(2);
    expect(trainingCount(b, 'alice')).toBe(2);
    expect(b.training![0].readyAt).toBe(29000);
    const goals = lynxes().map((e) => e.path.at(-1)!);
    expect(
      goals.some(
        (g) => Math.hypot(g.x - first.rally!.x, g.z - first.rally!.z) < 4,
      ),
    ).toBe(true);
    expect(
      goals.some(
        (g) => Math.hypot(g.x - second.rally!.x, g.z - second.rally!.z) < 4,
      ),
    ).toBe(true);
  });
  test('a unit whose factory falls keeps its progress and moves to an idle factory', () => {
    const b = setup(['reactor', 'factory']),
      first = b.entities.find(
        (e) => e.owner === 'alice' && e.kind === 'factory',
      )!;
    purchase(b, 'alice', 'lynx', 1000);
    first.hp = 0;
    tickBattle(b, 10000);
    expect(b.training![0].lines).toEqual([{ producer: '', readyAt: 15000 }]);
    const second = makeEntity(b, 'factory', 'alice', 'blue', at(-150, 84));
    second.angle = Math.PI;
    b.entities.push(second);
    const before = b.entities.length;
    tickBattle(b, 15000);
    expect(b.entities.slice(before).map((e) => e.kind)).toEqual(['lynx']);
    expect(b.training).toHaveLength(0);
  });
  test.each([0, -1, 1.5, 101, NaN, Infinity])(
    'invalid batch %s is rejected without spending or queuing anything',
    (quantity) => {
      const b = setup(),
        before = structuredClone(b);
      expect(() =>
        purchase(b, 'alice', 'ranger', 1000, undefined, quantity),
      ).toThrow('between 1 and');
      expect(b).toEqual(before);
    },
  );
  test('unaffordable batches and batched structures fail atomically', () => {
    const b = setup();
    b.commanders[0].credits = 999;
    const before = structuredClone(b);
    expect(() => purchase(b, 'alice', 'ranger', 1000, undefined, 10)).toThrow(
      'credits',
    );
    expect(() => purchase(b, 'alice', 'reactor', 1000, undefined, 5)).toThrow(
      'one structure',
    );
    expect(b).toEqual(before);
  });
  test('trained troops wait at the army limit and deploy once a slot opens without recharging', () => {
    const b = setup(['barracks', 'reactor']);
    for (let i = 0; i < 4; i++)
      b.entities.push(
        makeEntity(b, 'reactor', 'alice', 'blue', { x: -60 + i * 6, z: 100 }),
      );
    while (
      b.entities.filter((e) => e.owner === 'alice' && isUnit(e.kind)).length <
      COMMAND_LIMIT
    )
      b.entities.push(
        makeEntity(b, 'ranger', 'alice', 'blue', { x: -140, z: 110 }),
      );
    purchase(b, 'alice', 'ranger', 1000, undefined, 10);
    tickBattle(b, 9000);
    expect(trainingBlockReason(b, 'alice', 'ranger')).toContain('army space');
    expect(trainingCount(b, 'alice')).toBe(10);
    const unit = b.entities.find((e) => e.owner === 'alice' && isUnit(e.kind))!;
    unit.hp = 0;
    const credits = b.commanders[0].credits;
    tickBattle(b, 9250);
    expect(trainingCount(b, 'alice')).toBe(9);
    expect(b.commanders[0].credits).toBeGreaterThanOrEqual(credits);
    expect(b.training![0].readyAt).toBe(17250);
  });
  test('low power holds a completed unit, and restoring power resumes its batch', () => {
    const b = setup(['factory']);
    for (let i = 0; i < 4; i++)
      b.entities.push(
        makeEntity(b, 'tank', 'alice', 'blue', { x: -140 + i * 6, z: 110 }),
      );
    purchase(b, 'alice', 'lynx', 1000, undefined, 5);
    tickBattle(b, 23000);
    expect(trainingBlockReason(b, 'alice', 'lynx')).toContain('power');
    expect(trainingCount(b, 'alice')).toBe(5);
    place(b, 'reactor');
    tickBattle(b, 23250);
    expect(trainingCount(b, 'alice')).toBe(4);
    expect(b.training![0].readyAt).toBe(37250);
  });
  test('blocked exits hold ready troops until ground units move away', () => {
    const b = setup(),
      barracks = b.entities.find(
        (e) => e.owner === 'alice' && e.kind === 'barracks',
      )!;
    const exit = productionExit(barracks);
    // Another commander's units can block an exit without consuming our army slots.
    for (let dx = -12; dx <= 12; dx += 3)
      for (let dz = -12; dz <= 12; dz += 3)
        b.entities.push(
          makeEntity(b, 'ranger', 'ally', 'blue', {
            x: exit.x + dx,
            z: exit.z + dz,
          }),
        );
    purchase(b, 'alice', 'ranger', 1000, undefined, 5);
    tickBattle(b, 9000);
    expect(trainingBlockReason(b, 'alice', 'ranger')).toContain(
      'production exit',
    );
    expect(trainingCount(b, 'alice')).toBe(5);
    b.entities = b.entities.filter((e) => e.owner !== 'ally');
    tickBattle(b, 9250);
    expect(trainingCount(b, 'alice')).toBe(4);
  });
  test('losing the producer preserves prepaid armor until its replacement is complete', () => {
    const b = setup(['factory']),
      factory = b.entities.find(
        (e) => e.owner === 'alice' && e.kind === 'factory',
      )!;
    purchase(b, 'alice', 'lynx', 1000, undefined, 5);
    factory.hp = 0;
    tickBattle(b, 23000);
    expect(trainingBlockReason(b, 'alice', 'lynx')).toContain('Vehicle works');
    expect(trainingCount(b, 'alice')).toBe(5);
    place(b, 'factory');
    tickBattle(b, 23250);
    expect(trainingCount(b, 'alice')).toBe(4);
  });
  test('cancellation refunds only undeployed troops once, preserves other timers, and starts the next batch', () => {
    const b = setup(),
      first = purchase(b, 'alice', 'ranger', 1000, undefined, 5);
    const second = purchase(b, 'alice', 'ranger', 1000, undefined, 10);
    const last = purchase(b, 'alice', 'ranger', 1000, undefined, 5);
    tickBattle(b, 9000);
    expect(cancelTraining(b, 'alice', second, 10000)).toBe(1000);
    expect(b.training![0].readyAt).toBe(17000);
    expect(cancelTraining(b, 'alice', first, 10000)).toBe(400);
    expect(b.training![0]).toMatchObject({
      id: last,
      remaining: 5,
      readyAt: 18000,
    });
    const before = structuredClone(b);
    expect(() => cancelTraining(b, 'alice', first, 10000)).toThrow('no longer');
    expect(() => cancelTraining(b, 'bob', last, 10000)).toThrow('your queue');
    expect(b).toEqual(before);
    b.commanders[0].credits = CREDIT_CAP + 500;
    tickBattle(b, 11000);
    expect(b.commanders[0].credits).toBe(CREDIT_CAP + 500); // Refunds above the income cap are retained.
  });
  test('legacy orders retain payment and the running timer, and are migrated only once', () => {
    const b = setup();
    delete b.training;
    const legacy = makeEntity(
      b,
      'ranger',
      'alice',
      'blue',
      { x: -48, z: 30 },
      9000,
    );
    b.entities.push(legacy);
    const credits = b.commanders[0].credits;
    migrateTraining(b);
    migrateTraining(b);
    expect(b.training).toEqual([
      {
        id: legacy.id,
        owner: 'alice',
        kind: 'ranger',
        remaining: 1,
        total: 1,
        readyAt: 9000,
      },
    ]);
    expect(b.commanders[0].credits).toBe(credits);
    expect(b.entities.some((e) => e.id === legacy.id)).toBe(false);
    tickBattle(b, 9000);
    expect(trainingCount(b, 'alice')).toBe(0);
    expect(b.events[0].text).toBe('Jæger patrol ready.');
  });
  test('newly deployed units still trigger the commander ready call exactly once', () => {
    const b = setup(),
      detector = new BattleAudioDirector();
    purchase(b, 'alice', 'ranger', 1000, undefined, 5);
    tickBattle(b, 8500);
    detector.update({ ...structuredClone(b), id: 'sector' }, 'alice');
    tickBattle(b, 9000);
    const snapshot = { ...structuredClone(b), id: 'sector' };
    expect(detector.update(snapshot, 'alice').cues).toContain('unitReady');
    expect(detector.update(snapshot, 'alice').cues).not.toContain('unitReady');
  });
});

describe('Convex troop queues', () => {
  const alice = 'a'.repeat(64),
    bob = 'b'.repeat(64);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  async function withBarracks(
    t: ReturnType<typeof convexTest>,
    sectorId: Awaited<ReturnType<typeof t.mutation<typeof api.tactics.deploy>>>,
  ) {
    await t.run(async (ctx) => {
      const b = (await ctx.db.get(sectorId))!;
      const barracks = makeEntity(
        b,
        'barracks',
        b.commanders[0].id,
        'blue',
        sites.barracks,
      );
      barracks.angle = Math.PI;
      await ctx.db.patch(sectorId, {
        entities: [...b.entities, barracks],
        serial: b.serial,
      });
    });
  }
  test('batch orders persist across reads, cannot be cancelled by an ally, and cannot be refunded twice', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    const sectorId = await t.mutation(api.tactics.deploy, { token: alice });
    await t.mutation(api.tactics.deploy, { token: bob });
    await withBarracks(t, sectorId);
    await t.mutation(api.tactics.produce, {
      token: alice,
      sectorId,
      kind: 'ranger',
      quantity: 10,
    });
    const b = (await t.query(api.tactics.state, { token: alice }))!;
    expect(b.training).toHaveLength(1);
    expect(b.training![0].remaining).toBe(10);
    expect(b.commanders[0].credits).toBe(STARTING_CREDITS - 1000);
    await expect(
      t.mutation(api.tactics.produce, {
        token: alice,
        sectorId,
        kind: 'ranger',
        quantity: 10,
      }),
    ).rejects.toThrow('credits');
    const orderId = b.training![0].id;
    await expect(
      t.mutation(api.tactics.cancelTroops, { token: bob, sectorId, orderId }),
    ).rejects.toThrow('your queue');
    await expect(
      t.mutation(api.tactics.cancelTroops, { token: 'bad', sectorId, orderId }),
    ).rejects.toThrow('Reconnect');
    expect(
      await t.mutation(api.tactics.cancelTroops, {
        token: alice,
        sectorId,
        orderId,
      }),
    ).toBe(1000);
    await expect(
      t.mutation(api.tactics.cancelTroops, { token: alice, sectorId, orderId }),
    ).rejects.toThrow('no longer');
    const after = (await t.query(api.tactics.state, { token: alice }))!;
    expect(after.training).toEqual([]);
    expect(after.commanders.map((c) => c.credits)).toEqual([
      STARTING_CREDITS,
      STARTING_CREDITS,
    ]);
  });
  test('scheduler deploys one unit without a client; outage recovery preserves the remaining training time', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    const id = await t.mutation(api.tactics.deploy, { token: alice });
    await withBarracks(t, id);
    const start = Date.now();
    await t.mutation(api.tactics.produce, {
      token: alice,
      sectorId: id,
      kind: 'ranger',
      quantity: 5,
    });
    const queued = (await t.query(api.tactics.state, { token: alice }))!;
    const remainingMs = queued.training![0].readyAt - start;
    expect(remainingMs).toBeGreaterThan(0);
    vi.setSystemTime(start + 3600000);
    await t.mutation(internal.tactics.resumeStalledSector, {
      id,
      expected: start,
    });
    let b = (await t.query(api.tactics.state, { token: alice }))!;
    expect(b.training![0].readyAt - b.tickAt).toBe(remainingMs);
    vi.setSystemTime(start + 3600000 + remainingMs);
    await t.mutation(internal.tactics.tick, { id, expected: start + 3600000 });
    b = (await t.query(api.tactics.state, { token: alice }))!;
    expect(b.training![0].remaining).toBe(4);
    await t.mutation(internal.tactics.tick, { id, expected: start + 3600000 });
    expect(
      (await t.query(api.tactics.state, { token: alice }))!.training![0]
        .remaining,
    ).toBe(4);
  });
});
