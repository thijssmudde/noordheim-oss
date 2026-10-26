import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { getConvexSize } from 'convex/values';
import { stressBattle } from './fixtures/stress-battle';
import { MAPS } from '../lib/maps';
import {
  applyBattleOrder,
  isUnit,
  isHarvester,
  tickBattle,
  type PendingBattleOrder,
} from '../lib/tactics';

// Run alone with NOORDHEIM_BENCHMARK_OUTPUT=/tmp/noordheim to export cloud probe inputs.
test('full lobbies and maximum solo armies keep routing bounded and complete their orders', () => {
  const report = [];
  for (const [map, players] of [
    ['nordlys', 8],
    ['glaciercrown', 4],
    ['skerryharbour', 4],
    ['ironpass', 4],
    ['nordlys', 1],
  ] as const) {
    const b = stressBattle(map, MAPS[map].capacity.enemies, players);
    const label = `${map}-${players}`;
    const output = process.env.NOORDHEIM_BENCHMARK_OUTPUT;
    if (output) writeFileSync(`${output}-${label}.json`, JSON.stringify(b));
    const hq = b.entities.find((e) => e.team === 'red' && e.kind === 'hq')!;
    const intent: PendingBattleOrder = {
      owner: 'bench0',
      ids: b.entities
        .filter(
          (e) => e.owner === 'bench0' && isUnit(e.kind) && !isHarvester(e.kind),
        )
        .map((e) => e.id),
      order: 'attackMove',
      point: { x: hq.x + 15, z: hq.z + 15 },
    };
    const count = intent.ids.length;
    const samples = [],
      errors = [];
    let completedAt = 0;
    for (let i = 0; i < 80; i++) {
      const start = performance.now();
      if (intent.ids.length) errors.push(...applyBattleOrder(b, intent));
      if (!intent.ids.length && !completedAt) completedAt = i + 1;
      tickBattle(b, b.tickAt + 250);
      samples.push(performance.now() - start);
    }
    expect(intent.ids, label).toHaveLength(0);
    expect(errors, label).toEqual([]);
    expect(
      new Set(intent.destinations!.map((p) => `${p.point.x},${p.point.z}`))
        .size,
    ).toBe(count);
    expect(getConvexSize(b)).toBeLessThan(256 * 1024);
    expect(b.entities.length).toBeLessThanOrEqual(512);
    expect(b.status).toBe('active');
    report.push({
      label,
      entities: b.entities.length,
      bytes: getConvexSize(b),
      completedAt,
      maxMs: Math.max(...samples),
      meanMs: samples.reduce((a, b) => a + b) / samples.length,
    });
  }
  if (process.env.NOORDHEIM_BENCHMARK_OUTPUT)
    writeFileSync(
      `${process.env.NOORDHEIM_BENCHMARK_OUTPUT}-results.json`,
      JSON.stringify(report, null, 2),
    );
}, 60000);
