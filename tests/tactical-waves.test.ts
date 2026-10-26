import { test, expect } from 'vitest';
import {
  hostileArmies,
  hostileGuards,
  hostileMustered,
  isUnit,
  joinBattle,
  newBattle,
  TACTICAL_UNITS,
  tickBattle,
  type Battle,
} from '../lib/tactics';
import { productionExit } from '../lib/tactical-placement';
import { difficultyKeys } from '../lib/tactical-difficulty';

/** Advance the sector two seconds at a time, the largest step the simulation accepts. */
function advance(b: Battle, until: number) {
  let t = b.tickAt;
  while (t < until && b.status === 'active') {
    t = Math.min(until, t + 2000);
    tickBattle(b, t);
  }
}

test('operations begin with hostile structures only; every enemy soldier is trained in a base', () => {
  for (const difficulty of difficultyKeys)
    for (let seed = 0; seed < 8; seed++) {
      const b = newBattle(1000, { seed, difficulty });
      const label = `${difficulty}/${seed}`;
      expect(
        b.entities.filter((e) => e.team === 'red' && isUnit(e.kind)),
        label,
      ).toHaveLength(0);
      for (const owner of hostileArmies(b))
        for (const kind of ['barracks', 'factory'])
          expect(
            b.entities.some((e) => e.owner === owner && e.kind === kind),
            `${label} ${owner} ${kind}`,
          ).toBe(true);
    }
  // Compact bases in larger matches keep a works and muster infantry at the station.
  const crowded = newBattle(1000, {
    seed: 0,
    difficulty: 'normal',
    enemyCount: 8,
    mapId: 'nordlys',
  });
  for (const owner of hostileArmies(crowded))
    expect(
      crowded.entities.some((e) => e.owner === owner && e.kind === 'factory'),
      `${owner} factory`,
    ).toBe(true);
}, 60000);

test('hostile bases train a home guard and then a column, deploying from their own production exits', () => {
  const b = newBattle(1000, { seed: 947, difficulty: 'normal' });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  const producers = b.entities.filter(
    (e) => e.team === 'red' && (e.kind === 'barracks' || e.kind === 'factory'),
  );
  const seen = new Set<string>();
  for (let t = 3000; t <= 90000; t += 2000) {
    const before = new Set(b.entities.map((e) => e.id));
    tickBattle(b, t);
    for (const e of b.entities)
      if (!before.has(e.id) && e.team === 'red') {
        seen.add(e.id);
        // Fresh troops appear beside the exit of a building that can train them.
        const producer = producers.find(
          (p) =>
            p.owner === e.owner &&
            p.kind === TACTICAL_UNITS[e.kind as 'ranger'].producer,
        )!;
        const exit = productionExit(producer);
        expect(Math.hypot(e.x - exit.x, e.z - exit.z)).toBeLessThan(12);
        expect(b.training ?? []).toEqual([]);
      }
  }
  expect(seen.size).toBeGreaterThanOrEqual(hostileGuards(b));
  // Nothing marches before the cadence allows it; the guard stands by at home.
  expect(b.wave).toBe(0);
  const [owner] = hostileArmies(b);
  expect(hostileMustered(b, owner).length).toBeGreaterThanOrEqual(
    hostileGuards(b),
  );
});

test('every difficulty sends a trained, routed column to an undefended landing across seeds', () => {
  const failures: string[] = [];
  for (const difficulty of difficultyKeys)
    for (let seed = 0; seed < 12; seed++) {
      const b = newBattle(1000, { seed, difficulty });
      joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
      b.entities = b.entities.filter(
        (e) => e.team === 'red' || e.kind === 'hq',
      );
      const start = b.nextWaveAt;
      advance(b, start);
      const column = b.entities.filter(
        (e) => e.team === 'red' && e.order === 'attackMove',
      );
      if (!column.length || b.wave !== 1) {
        failures.push(`${difficulty}/${seed}: no column (wave ${b.wave})`);
        continue;
      }
      const hq = b.entities.find((e) => e.owner === 'p' && e.kind === 'hq')!;
      const flag = b.flags!.find((f) => f.owner === 'p')!;
      advance(b, start + 180000);
      // Arrived: at the landing, or already off with its flag (or home with it).
      if (
        !column.some((e) => Math.hypot(e.x - hq.x, e.z - hq.z) < 30) &&
        flag.state === 'home' &&
        flag.capturedAt === undefined
      )
        failures.push(
          `${difficulty}/${seed}: stalled ${column.map((e) => `${e.kind}:${Math.round(Math.hypot(e.x - hq.x, e.z - hq.z))}/${e.path.length}`).join(',')}`,
        );
    }
  expect(failures).toEqual([]);
}, 180000);

test('a base whose exits are blocked keeps retrying without consuming the cadence, then marches when reopened', () => {
  const b = newBattle(1000, { seed: 947, difficulty: 'normal' });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  const bases = b.entities.filter((e) => e.team === 'red' && !isUnit(e.kind));
  const positions = bases.map((e) => ({ x: e.x, z: e.z }));
  for (const base of bases) {
    base.x = 1000;
    base.z = 1000;
  }
  const due = b.nextWaveAt;
  advance(b, due);
  expect(b.entities.filter((e) => e.team === 'red' && isUnit(e.kind))).toEqual(
    [],
  );
  expect(b.wave).toBe(0);
  expect(b.nextWaveAt).toBe(due + 10000);
  bases.forEach((base, i) => Object.assign(base, positions[i]));
  let marched = 0;
  while (b.wave === 0 && b.tickAt < due + 150000) {
    advance(b, b.tickAt + 2000);
    marched = b.entities.filter(
      (e) => e.team === 'red' && e.order === 'attackMove',
    ).length;
  }
  expect(b.wave).toBe(1);
  expect(marched).toBeGreaterThanOrEqual(4);
});

test('a headless army stops training and unfinished orders die with their production building', () => {
  const b = newBattle(1000, { seed: 3, difficulty: 'normal' });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  advance(b, 5000);
  expect(b.hostileTraining!.length).toBeGreaterThan(0);
  for (const e of b.entities)
    if (e.team === 'red' && e.kind !== 'hq' && !isUnit(e.kind)) e.hp = 0;
  advance(b, 11000);
  // Vehicle orders died with the works; the station still musters infantry.
  expect(
    b.hostileTraining!.every(
      (q) => TACTICAL_UNITS[q.kind].category === 'infantry',
    ),
  ).toBe(true);
  for (const e of b.entities) if (e.team === 'red' && e.kind === 'hq') e.hp = 0;
  advance(b, 15000);
  expect(b.hostileTraining).toEqual([]);
  // A fallen station no longer takes its army with it: the flag still has to fall.
  expect(b.status).toBe('active');
  expect(b.flags!.every((f) => f.capturedAt === undefined)).toBe(true);
});

test('brutal columns keep growing as the garrison mobilises instead of plateauing', () => {
  const b = newBattle(1000, { seed: 947, difficulty: 'brutal' });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  const home = b.entities.find((e) => e.owner === 'p' && e.kind === 'hq')!;
  const sent: number[] = [];
  const counted = new Set<string>();
  for (let t = 3000; t <= 760000 && b.status === 'active'; t += 2000) {
    const wave = b.wave;
    tickBattle(b, t);
    // A stand-in defence: attackers die at the gates, so the base survives.
    for (const e of b.entities)
      if (e.team === 'red' && isUnit(e.kind) && Math.hypot(e.x - home.x, e.z - home.z) < 70)
        e.hp = 0;
    if (b.wave === wave) continue;
    const column = b.entities.filter(
      (e) =>
        e.team === 'red' &&
        isUnit(e.kind) &&
        e.hp > 0 &&
        e.order === 'attackMove' &&
        !counted.has(e.id),
    );
    column.forEach((e) => counted.add(e.id));
    sent.push(column.length);
  }
  expect(sent.length).toBeGreaterThanOrEqual(8);
  // Every column is a real force, and late columns dwarf the opening ones.
  expect(Math.min(...sent)).toBeGreaterThanOrEqual(6);
  expect(Math.max(...sent.slice(-3))).toBeGreaterThan(sent[0] * 1.6);
}, 60000);
