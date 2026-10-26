import { expect, test } from 'vitest';
import { joinBattle, newBattle, tickBattle } from '../lib/tactics';
import { difficultyKeys } from '../lib/tactical-difficulty';
import { terrainFor } from '../lib/tactical-terrain';
import { productionExit } from '../lib/tactical-placement';
import { findPath } from '../lib/tactics';
import { withRoutingBudget } from '../lib/tactical-navigation';
test('one through eight distinct armies generate across difficulties and seeds with reachable bases', () => {
  for (const difficulty of difficultyKeys)
    for (const enemyCount of [1, 2, 3, 4, 5, 6, 7, 8])
      for (let seed = 0; seed < 2; seed++) {
        const b = newBattle(1000, {
          difficulty,
          enemyCount,
          seed,
          mapId: 'nordlys',
        });
        joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
        const bases = b.entities.filter(
          (e) => e.team === 'red' && e.kind === 'hq',
        );
        expect(bases, `${difficulty}/${enemyCount}/${seed}`).toHaveLength(
          enemyCount,
        );
        expect(new Set(bases.map((e) => e.owner)).size).toBe(enemyCount);
        expect(b.objectives).toEqual([]);
        const home = productionExit(
          b.entities.find((e) => e.owner === 'p' && e.kind === 'hq')!,
        );
        for (const base of bases)
          expect(
            withRoutingBudget(
              () =>
                findPath(home, productionExit(base), false, [], terrainFor(b)),
              Infinity,
            ).length,
          ).toBeGreaterThan(0);
      }
}, 120000);
test('every enemy flag must be captured to win; razing their forces is not enough', () => {
  const b = newBattle(1000, { enemyCount: 2, seed: 1 });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  b.entities = b.entities.filter((e) => e.team === 'blue');
  tickBattle(b, 2000);
  expect(b.status).toBe('active');
  const [first, second] = b.flags!.filter((f) => f.team === 'red');
  first.capturedAt = 2000;
  tickBattle(b, 3000);
  expect(b.status).toBe('active');
  second.capturedAt = 3000;
  tickBattle(b, 4000);
  expect(b.status).toBe('victory');
});
test('enemy count rejects invalid inputs and counts beyond the map', () => {
  for (const enemyCount of [0, 9, 1.5, NaN, Infinity])
    expect(() => newBattle(1000, { enemyCount, mapId: 'nordlys' })).toThrow(
      'Nordlys Valley holds between 1 and 8 enemies.',
    );
  expect(() => newBattle(1000, { enemyCount: 3 })).toThrow(
    'Fjordmouth holds between 1 and 2 enemies.',
  );
});

test('eight enemies can still launch counterattacks within the population budget', () => {
  const b = newBattle(1000, {
    enemyCount: 8,
    seed: 947,
    difficulty: 'brutal',
    mapId: 'nordlys',
  });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  for (let t = 3000; t < b.nextWaveAt; t += 2000) tickBattle(b, t);
  tickBattle(b, b.nextWaveAt);
  expect(b.wave).toBe(1);
  expect(
    b.entities.filter((e) => e.order === 'attackMove' && e.team === 'red')
      .length,
  ).toBeGreaterThan(0);
});
