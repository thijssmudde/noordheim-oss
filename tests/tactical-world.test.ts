import { describe, expect, test } from 'vitest';
import {
  newBattle,
  joinBattle,
  findPath,
  isUnit,
  waveComposition,
  tickBattle,
} from '../lib/tactics';
import { difficultyKeys, DIFFICULTIES } from '../lib/tactical-difficulty';
import {
  footprint,
  footprintsOverlap,
  footprintSamples,
  productionExit,
  hasExit,
  insideFootprint,
} from '../lib/tactical-placement';
import { terrainFor } from '../lib/tactical-terrain';
import { MAPS, mapIds } from '../lib/maps';
import { withRoutingBudget } from '../lib/tactical-navigation';

const cases = mapIds.flatMap((mapId) =>
  Array.from({ length: MAPS[mapId].capacity.enemies }, (_, i) =>
    difficultyKeys.map((difficulty) => ({
      mapId,
      enemyCount: i + 1,
      difficulty,
    })),
  ).flat(),
);

describe('Generated operations', () => {
  test('one seed reproduces a layout, and different seeds move the fortress', () => {
    expect(newBattle(1000, { seed: 123 })).toEqual(
      newBattle(1000, { seed: 123 }),
    );
    const battles = Array.from({ length: 12 }, (_, seed) =>
      newBattle(1000, { seed }),
    );
    expect(
      new Set(
        battles.map((b) =>
          JSON.stringify(b.entities.filter((e) => e.kind !== 'hq')),
        ),
      ).size,
    ).toBe(12);
    expect(battles.every((b) => b.objectives.length === 0)).toBe(true);
    // Every stronghold keeps its headquarters near its heart.
    const hold = MAPS.fjordmouth.strongholds[0];
    for (const b of battles) {
      const hq = b.entities.find((e) => e.kind === 'hq')!;
      expect(Math.hypot(hq.x - hold.x, hq.z - hold.z)).toBeLessThanOrEqual(
        hold.radius * 0.35 * Math.SQRT2 + 1,
      );
    }
  }, 30000);
  // Every map, at every enemy count and difficulty, must chart a layout.
  test.each(cases)(
    '$mapId with $enemyCount enemies on $difficulty keeps foundations, ore and exits usable',
    ({ mapId, enemyCount, difficulty }) => {
      const seed = 947 + enemyCount * 31;
      const b = newBattle(1000, { seed, difficulty, mapId, enemyCount });
      const map = terrainFor(b);
      const { groundAt, buildableAt } = map;
      const design = MAPS[mapId];
      const label = `${mapId}/${enemyCount}/${difficulty}`;
      expect(b.objectives, label).toHaveLength(0);
      expect(b.deposits, label).toHaveLength(
        design.landings.length + design.ore.length + enemyCount,
      );
      const buildings = b.entities.filter((e) => !isUnit(e.kind));
      const boxes = buildings.map((e) => footprint(e.kind as 'hq', e, e.angle));
      for (let i = 0; i < buildings.length; i++) {
        expect(
          footprintSamples(boxes[i]).every((p) => buildableAt(p.x, p.z)),
          label,
        ).toBe(true);
        for (let j = i + 1; j < boxes.length; j++)
          expect(footprintsOverlap(boxes[i], boxes[j], 1), label).toBe(false);
        if (hasExit(buildings[i].kind as 'hq')) {
          const exit = productionExit(buildings[i]);
          expect(groundAt(exit.x, exit.z), label).toBe(true);
          expect(
            boxes.some((box) => insideFootprint(exit, box, 1)),
            label,
          ).toBe(false);
        }
      }
      for (const p of [...b.entities, ...b.deposits!])
        expect(groundAt(p.x, p.z), label).toBe(true);
      // Each army builds inside its own stronghold; its production faces the front.
      for (let enemy = 0; enemy < enemyCount; enemy++) {
        const hold = map.strongholdAt(enemy);
        const own = buildings.filter(
          (e) => e.owner === `hostile-${enemy + 1}`,
        );
        const base = own.filter(
          (e) =>
            !['turret', 'bunker', 'battery', 'flak', 'weathermast'].includes(
              e.kind,
            ),
        );
        // Every army raises one Weather Mast, except on Easy.
        expect(
          own.filter((e) => e.kind === 'weathermast'),
          label,
        ).toHaveLength(DIFFICULTIES[difficulty].mast ? 1 : 0);
        expect(base.map((e) => e.kind).sort(), label).toEqual(
          ['airfield', 'barracks', 'factory', 'hq', 'reactor', 'refinery'],
        );
        for (const e of base)
          expect(
            Math.hypot(e.x - hold.x, e.z - hold.z),
            `${label} ${e.kind}`,
          ).toBeLessThanOrEqual(hold.radius);
        const front =
          Math.round(hold.facing / (Math.PI / 2)) * (Math.PI / 2);
        expect(
          base.filter(
            (e) => hasExit(e.kind as 'hq') && Math.abs(e.angle - front) < 1e-6,
          ).length,
          label,
        ).toBeGreaterThanOrEqual(3);
      }
      // One flag per army, in open ground clear of every foundation.
      const flags = b.flags!.filter((f) => f.team === 'red');
      expect(flags.map((f) => f.owner).sort(), label).toEqual(
        Array.from({ length: enemyCount }, (_, i) => `hostile-${i + 1}`).sort(),
      );
      for (const flag of flags) {
        expect(groundAt(flag.x, flag.z), label).toBe(true);
        for (const box of boxes)
          expect(insideFootprint(flag, box, flag.radius), label).toBe(false);
      }
      // Fair home seams beside every landing, clear of hostile structures.
      design.landings.forEach((home, slot) => {
        const seam = b.deposits!.find(
          (d) => d.name === `Landing zone ${slot + 1} ore`,
        )!;
        expect(seam, label).toMatchObject({
          ...map.homeOreAt(slot),
          amount: 16000,
        });
        expect(
          b.entities.every((e) => Math.hypot(home.x - e.x, home.z - e.z) >= 55),
          label,
        ).toBe(true);
      });
      // The design's seams, with a guard on every rich one.
      for (const ore of design.ore) {
        expect(
          b.deposits!.some(
            (d) => d.name === ore.name && d.x === ore.x && d.z === ore.z,
          ),
          label,
        ).toBe(true);
        if (ore.rich)
          expect(
            b.entities.some(
              (e) =>
                e.kind === 'turret' &&
                Math.hypot(e.x - ore.x, e.z - ore.z) <= 16,
            ),
            `${label} guard at ${ore.name}`,
          ).toBe(true);
      }
    },
    30000,
  );
  test('capacity is enforced with clear errors', () => {
    expect(() =>
      newBattle(1000, { mapId: 'fjordmouth', enemyCount: 3 }),
    ).toThrow('Fjordmouth holds between 1 and 2 enemies.');
    expect(() =>
      newBattle(1000, { mapId: 'ironpass', playerSlots: 5 }),
    ).toThrow('Iron Pass holds between 1 and 4 players.');
    expect(newBattle(1000, { mapId: 'nordlys', enemyCount: 8, playerSlots: 8 }).mapScale).toBe(1);
  });
  test('ground forces can reach every seam and enemy production exit', () => {
    for (const mapId of mapIds) {
      const enemyCount = MAPS[mapId].capacity.enemies;
      const b = newBattle(1000, { seed: 17, difficulty: 'brutal', mapId, enemyCount });
      const map = terrainFor(b);
      const buildings = b.entities.filter((e) => !isUnit(e.kind));
      const obstacles = buildings.map((e) =>
        footprint(e.kind as 'hq', e, e.angle),
      );
      for (const p of [
        ...b.deposits!,
        ...buildings.filter((e) => hasExit(e.kind as 'hq')).map(productionExit),
      ])
        expect(
          withRoutingBudget(
            () => findPath(map.baseAt(0), p, false, obstacles, map),
            Infinity,
          ).length,
          `${mapId}: ${JSON.stringify(p)}`,
        ).toBeGreaterThan(0);
    }
  }, 60000);
  test('difficulty changes credits, defenses, wave size and timing', () => {
    let previous = 0;
    for (const difficulty of difficultyKeys) {
      const b = newBattle(1000, { seed: 12, difficulty });
      joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
      expect(b.commanders[0].credits).toBe(DIFFICULTIES[difficulty].credits);
      expect(b.nextWaveAt).toBe(1000 + DIFFICULTIES[difficulty].firstWaveMs);
      const { groundAt } = terrainFor(b);
      const enemies = b.entities.filter((e) => e.team === 'red');
      expect(enemies.length).toBeGreaterThan(previous);
      previous = enemies.length;
      expect(enemies.every((e) => !isUnit(e.kind))).toBe(true);
      const due = b.nextWaveAt;
      for (let t = 3000; t < due; t += 2000) tickBattle(b, t);
      tickBattle(b, due);
      expect(b.wave).toBe(1);
      expect(b.nextWaveAt - b.tickAt).toBe(
        DIFFICULTIES[difficulty].waveIntervalMs,
      );
      const wave = b.entities.filter(
        (e) => e.team === 'red' && e.order === 'attackMove',
      );
      expect(wave.length).toBeGreaterThan(0);
      expect(wave.every((e) => groundAt(e.x, e.z))).toBe(true);
      expect(wave.some((e) => e.path.length)).toBe(true);
      // Columns march from the base they were trained in.
      expect(
        wave.every((e) =>
          enemies.some(
            (base) =>
              base.owner === e.owner &&
              base.kind === 'hq' &&
              Math.hypot(e.x - base.x, e.z - base.z) < 60,
          ),
        ),
      ).toBe(true);
      // The lead establishes the approach; remaining troops route within the tick budget.
      const pending = new Set(
        wave.filter((e) => !e.path.length).map((e) => e.id),
      );
      for (let t = due + 250; pending.size && t <= due + 10000; t += 250) {
        tickBattle(b, t);
        for (const e of wave) if (e.path.length) pending.delete(e.id);
      }
      expect(pending.size).toBe(0);
    }
    expect(waveComposition(8, 'easy').length).toBeLessThan(
      waveComposition(8, 'normal').length,
    );
    expect(waveComposition(8, 'normal').length).toBeLessThan(
      waveComposition(8, 'hard').length,
    );
    expect(waveComposition(8, 'hard').length).toBeLessThan(
      waveComposition(8, 'brutal').length,
    );
  });
});

// Exercise the real mutations so settings cannot be changed by a late join or lost on a tick.
import { beforeEach, afterEach, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
const modules = import.meta.glob('../convex/**/*.ts');

describe('Shared operation settings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  test('settings persist through joins, reads, ticks and redeployment', async () => {
    const t = convexTest(schema, modules);
    const alice = 'a'.repeat(64),
      bob = 'b'.repeat(64);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    const id = await t.mutation(api.tactics.deploy, {
      token: alice,
      difficulty: 'hard',
    });
    const initial = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(initial.difficulty).toBe('hard');
    expect(Number.isInteger(initial.seed)).toBe(true);
    expect(
      await t.mutation(api.tactics.deploy, {
        token: alice,
        difficulty: 'easy',
      }),
    ).toBe(id);
    await expect(
      t.mutation(api.tactics.deploy, { token: bob, difficulty: 'easy' }),
    ).rejects.toThrow('different difficulty');
    expect(await t.mutation(api.tactics.deploy, { token: bob })).toBe(id);
    expect((await t.query(api.players.lobby, {})).operation?.difficulty).toBe(
      'hard',
    );
    const joined = (await t.query(api.tactics.state, { token: bob }))!;
    expect(joined.difficulty).toBe('hard');
    expect(joined.seed).toBe(initial.seed);
    expect(joined.commanders.map((c) => c.credits)).toEqual([1250, 1250]);
    vi.setSystemTime(1250);
    await t.mutation(internal.tactics.tick, { id, expected: 1000 });
    const after = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(after.seed).toBe(initial.seed);
    expect(after.difficulty).toBe(initial.difficulty);
    expect(after.objectives).toEqual(initial.objectives);
    await t.run((ctx) => ctx.db.patch(id, { status: 'defeat' }));
    const nextId = await t.mutation(api.tactics.deploy, {
      token: alice,
      difficulty: 'easy',
    });
    expect(nextId).not.toBe(id);
    const next = (await t.run((ctx) => ctx.db.get(nextId)))!;
    expect(next.difficulty).toBe('easy');
    expect(next.seed).not.toBe(initial.seed);
    expect(next.commanders[0].credits).toBe(2200);
    expect((await t.run((ctx) => ctx.db.get(id)))!.status).toBe('defeat');
  });
  test('legacy sectors default to normal without regenerating persisted positions', async () => {
    const t = convexTest(schema, modules),
      token = 'c'.repeat(64);
    await t.mutation(api.players.connect, { token, name: 'Charlie' });
    const id = await t.mutation(api.tactics.deploy, { token });
    const before = (await t.run((ctx) => ctx.db.get(id)))!;
    await t.run((ctx) =>
      ctx.db.patch(id, { difficulty: undefined, seed: undefined }),
    );
    const state = (await t.query(api.tactics.state, { token }))!;
    expect(state.objectives).toEqual(before.objectives);
    expect((await t.query(api.players.lobby, {})).operation?.difficulty).toBe(
      'normal',
    );
  });
});
