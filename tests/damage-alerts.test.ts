import { describe, expect, test } from 'vitest';
import {
  ALERT_COOLDOWN_MS,
  ALERT_PING_MS,
  DamageAlertTracker,
  EMPTY_ALERTS,
  alertKind,
  trackDamage,
  type DamageAlertLog,
} from '../lib/damage-alerts';
import {
  joinBattle,
  makeEntity,
  newBattle,
  type Battle,
  type EntityKind,
} from '../lib/tactics';

type Snapshot = Battle & { id: string };
function battle(): Snapshot {
  const b: Snapshot = { ...newBattle(1000), id: 'sector-a' };
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
  b.entities = b.entities.filter((e) => e.team === 'red');
  for (const [kind, owner, x] of [
    ['refinery', 'alice', 0],
    ['harvester', 'alice', 200],
    ['ranger', 'alice', 400],
    ['ranger', 'bob', 600],
  ] as [EntityKind, string, number][])
    b.entities.push(makeEntity(b, kind, owner, 'blue', { x, z: 0 }));
  return b;
}
/** The next snapshot, `ms` later, with `hits` removing health from entities by kind. */
function next(
  b: Snapshot,
  hits: Partial<Record<EntityKind, number>> = {},
  ms = 1000,
  owner = 'alice',
): Snapshot {
  const n = structuredClone(b);
  n.tickAt += ms;
  for (const e of n.entities)
    if (e.owner === owner && hits[e.kind]) e.hp -= hits[e.kind]!;
  return n;
}
function run(...snapshots: Snapshot[]) {
  return snapshots.reduce<DamageAlertLog>(
    (log, s) => trackDamage(log, s, 'alice'),
    EMPTY_ALERTS,
  );
}

describe('Under-attack alerts', () => {
  test('classifies structures, harvesters and troops', () => {
    expect(alertKind('hq')).toBe('base');
    expect(alertKind('refinery')).toBe('base');
    expect(alertKind('harvester')).toBe('harvester');
    expect(alertKind('ranger')).toBe('units');
    expect(alertKind('tank')).toBe('units');
  });

  test('the first snapshot is only a baseline', () => {
    const log = run(battle());
    expect(log.recent).toEqual([]);
    expect(log.latest).toBeNull();
  });

  test('raises one alert per damaged category at its location', () => {
    const a = battle();
    const log = run(a, next(a, { refinery: 50, harvester: 10, ranger: 5 }));
    expect(log.recent.map((x) => [x.kind, x.x])).toEqual([
      ['base', 0],
      ['harvester', 200],
      ['units', 400],
    ]);
    // The notice and Space jump go to the most important new alert.
    expect(log.latest?.kind).toBe('base');
  });

  test("ignores allies' damage, healing and freshly built entities", () => {
    const a = battle();
    const b = next(a, { ranger: 20 }, 1000, 'bob');
    b.entities.push(makeEntity(b, 'reactor', 'alice', 'blue', { x: 0, z: 90 }));
    const c = next(b);
    c.entities.find((e) => e.kind === 'refinery')!.hp += 10;
    expect(run(a, b, c).recent).toEqual([]);
  });

  test('throttles repeats per category and area', () => {
    const a = battle();
    const b = next(a, { refinery: 10 });
    const c = next(b, { refinery: 10 });
    const log = run(a, b, c);
    expect(log.recent).toHaveLength(1);
    // A structure in another cell still warns.
    const d = next(c);
    const far = makeEntity(d, 'reactor', 'alice', 'blue', { x: 0, z: 300 });
    d.entities.push(far);
    const e = next(d);
    e.entities.find((x) => x.id === far.id)!.hp -= 10;
    expect(run(a, b, c, d, e).recent.map((x) => x.z)).toEqual([0, 300]);
  });

  test('warns again after the cooldown, and pings fade', () => {
    let s = battle();
    const snapshots = [s];
    for (let t = 0; t < ALERT_COOLDOWN_MS; t += 1000) {
      s = next(s, { refinery: 5 });
      snapshots.push(s);
    }
    let log = run(...snapshots);
    expect(log.recent).toHaveLength(0);
    expect(log.latest?.at).toBe(snapshots[1].tickAt);
    log = trackDamage(log, next(s, { refinery: 5 }), 'alice');
    expect(log.recent).toHaveLength(1);
    expect(log.latest!.at - snapshots[1].tickAt).toBeGreaterThanOrEqual(
      ALERT_COOLDOWN_MS,
    );
    expect(log.latest!.id).toBeGreaterThan(1);
    expect(ALERT_PING_MS).toBeLessThan(ALERT_COOLDOWN_MS);
  });

  test('a reconnect gap or a new operation re-baselines without alerts', () => {
    const a = battle();
    expect(run(a, next(a, { refinery: 40 }, 9000)).recent).toEqual([]);
    const other = { ...next(a, { refinery: 40 }), id: 'sector-b' };
    expect(run(a, other).recent).toEqual([]);
  });

  test('stale snapshots change nothing', () => {
    const a = battle();
    const b = next(a, { refinery: 40 });
    const log = run(a, b);
    expect(trackDamage(log, a, 'alice')).toBe(log);
    expect(trackDamage(log, b, 'alice')).toBe(log);
  });

  test('the tracker is idempotent per snapshot', () => {
    const t = new DamageAlertTracker(),
      a = battle(),
      b = next(a, { harvester: 5 });
    t.observe(a, 'alice');
    const first = t.observe(b, 'alice');
    expect(t.observe(b, 'alice')).toBe(first);
    expect(first.recent).toHaveLength(1);
  });
});
