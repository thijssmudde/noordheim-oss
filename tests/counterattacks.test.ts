import { describe, expect, test } from 'vitest';
import {
  BATTLE_ENTITY_LIMIT,
  battleHasRoom,
  commandLimit,
  harvesterLimit,
  HOSTILE_ARMY_BUDGET,
  hostileArmies,
  hostileGuards,
  hostileReserve,
  joinBattle,
  makeEntity,
  newBattle,
  STRUCTURE_LIMIT,
  tickBattle,
  waveComposition,
  type Battle,
  type Entity,
  type UnitKind,
} from '../lib/tactics';
import { DIFFICULTIES, type Difficulty } from '../lib/tactical-difficulty';
import { terrainFor } from '../lib/tactical-terrain';
import { productionExit } from '../lib/tactical-placement';

/** Stand `count` trained troops beside a hostile command station, as its own production would. */
function muster(
  b: Battle,
  owner: string,
  count: number,
  kind: UnitKind = 'ranger',
) {
  const hq = b.entities.find((e) => e.owner === owner && e.kind === 'hq')!;
  const exit = productionExit(hq);
  const { groundAt } = terrainFor(b);
  const buildings = b.entities.filter(
    (e) =>
      e.team === 'red' &&
      !['ranger', 'rocket', 'lynx', 'tank'].includes(e.kind),
  );
  const placed: Entity[] = [];
  for (let ring = 4; ring <= 40 && placed.length < count; ring += 3)
    for (let i = 0; i < 12 && placed.length < count; i++) {
      const angle = (i * Math.PI) / 6;
      const p = {
        x: exit.x + Math.sin(angle) * ring,
        z: exit.z + Math.cos(angle) * ring,
      };
      if (
        !groundAt(p.x, p.z) ||
        buildings.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 9)
      )
        continue;
      const e = makeEntity(b, kind, owner, 'red', p);
      b.entities.push(e);
      placed.push(e);
    }
  if (placed.length < count)
    throw new Error(`Could only muster ${placed.length} of ${count}`);
  return placed;
}
const marching = (b: Battle) =>
  b.entities.filter((e) => e.team === 'red' && e.order === 'attackMove');
const kinds = (b: Battle, ids: (string | undefined)[]) =>
  ids.map((id) => b.entities.find((e) => e.id === id)?.kind);

describe('Column composition', () => {
  test('late columns keep growing into combined arms instead of plateauing', () => {
    const at = (wave: number, difficulty: Difficulty = 'normal') =>
      waveComposition(wave, difficulty, 3);
    expect(at(8).length).toBeLessThan(at(12).length);
    expect(at(12).length).toBeLessThan(at(20).length);
    expect(at(6)).toContain('drone');
    const late = at(24);
    for (const kind of ['tank', 'howitzer', 'gunship', 'jotun'] as const)
      expect(late.filter((k) => k === kind).length).toBeGreaterThanOrEqual(3);
    // Early patrols stay light on every setting except Brutal, whose escalation brings armor at once.
    expect(at(1)).not.toContain('tank');
    expect(at(1, 'hard')).not.toContain('tank');
    expect(at(1, 'brutal')).toContain('tank');
    for (const difficulty of ['easy', 'normal', 'hard', 'brutal'] as const)
      expect(at(30, difficulty).length).toBeGreaterThan(
        at(3, difficulty).length,
      );
  });
});

describe('Counterattack launches', () => {
  test('harder settings march several armies on one cadence, each with its own target', () => {
    for (const [difficulty, columns] of [
      ['normal', 1],
      ['hard', 2],
      ['brutal', 3],
    ] as const) {
      const b = newBattle(1000, {
        seed: 21,
        difficulty,
        enemyCount: 4,
        mapId: 'glaciercrown',
      });
      joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
      for (const owner of hostileArmies(b))
        muster(b, owner, hostileGuards(b) + 6);
      b.nextWaveAt = 1000;
      tickBattle(b, 2000);
      expect(b.wave, difficulty).toBe(1);
      expect(new Set(marching(b).map((e) => e.owner)).size, difficulty).toBe(
        columns,
      );
      expect(b.nextWaveAt).toBe(2000 + DIFFICULTIES[difficulty].waveIntervalMs);
      // Every army keeps its home guard: the column is what stands beyond it.
      for (const owner of hostileArmies(b))
        expect(
          marching(b).filter((e) => e.owner === owner).length,
        ).toBeLessThanOrEqual(6);
    }
  });

  test('eight armies march twice the columns of four on one shared home guard, at every difficulty', () => {
    for (const difficulty of Object.keys(DIFFICULTIES) as Difficulty[]) {
      const four = newBattle(1000, { difficulty, enemyCount: 4, mapId: 'nordlys' }),
        eight = newBattle(1000, { difficulty, enemyCount: 8, mapId: 'nordlys' });
      expect(8 * hostileGuards(eight), difficulty).toBeLessThanOrEqual(
        4 * hostileGuards(four),
      );
      joinBattle(eight, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
      for (const owner of hostileArmies(eight))
        muster(eight, owner, hostileGuards(eight) + 6);
      eight.nextWaveAt = 1000;
      tickBattle(eight, 2000);
      expect(
        new Set(marching(eight).map((e) => e.owner)).size,
        difficulty,
      ).toBe(2 * DIFFICULTIES[difficulty].columns);
    }
    expect(HOSTILE_ARMY_BUDGET({ enemyCount: 8 })).toBe(192);
  });

  test('columns march on flags; raids strike refineries, plants and outposts on Normal and above, never on Easy', () => {
    const seen: Record<string, Set<string>> = {
      easy: new Set(),
      hard: new Set(),
    };
    for (const difficulty of ['easy', 'hard'] as const)
      for (let seed = 0; seed < 24; seed++) {
        const b = newBattle(1000, { seed, difficulty, enemyCount: 1 });
        joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
        const hq = b.entities.find(
          (e) => e.owner === 'alice' && e.kind === 'hq',
        )!;
        b.entities.push(
          makeEntity(b, 'refinery', 'alice', 'blue', {
            x: hq.x + 22,
            z: hq.z + 6,
          }),
        );
        b.entities.push(
          makeEntity(b, 'outpost', 'alice', 'blue', {
            x: hq.x - 22,
            z: hq.z + 6,
          }),
        );
        // An unfinished plant is never a raid target.
        b.entities.push(
          makeEntity(
            b,
            'reactor',
            'alice',
            'blue',
            { x: hq.x, z: hq.z + 20 },
            99000,
          ),
        );
        muster(b, 'hostile-1', hostileGuards(b) + 6);
        b.nextWaveAt = 1000;
        tickBattle(b, 2000);
        if (b.wave !== 1) continue;
        const targets = new Set(
          kinds(
            b,
            marching(b).map((e) => e.target),
          ),
        );
        expect(targets.size).toBe(1);
        // A column without a structure target marches on the flag zone.
        for (const kind of targets) seen[difficulty].add(kind ?? 'flag');
      }
    expect([...seen.easy]).toEqual(['flag']);
    expect(seen.hard.has('flag')).toBe(true);
    expect(seen.hard.has('refinery') || seen.hard.has('outpost')).toBe(true);
    expect(seen.hard.has('reactor')).toBe(false);
  }, 60000);

  test('a launch routes its lead on its own allowance, even when troops have spent the update budget', () => {
    const b = newBattle(1000, { seed: 8, difficulty: 'normal', enemyCount: 1 });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const { groundAt, bounds } = terrainFor(b);
    // A hostile sentry stranded in the sea: every attack on it burns a route search and fails.
    let sea: { x: number; z: number } | undefined;
    for (let z = bounds.maxZ - 1; z > bounds.minZ && !sea; z -= 2)
      for (let x = bounds.minX + 1; x < bounds.maxX && !sea; x += 2)
        if (
          !groundAt(x, z) &&
          b.entities.every((e) => Math.hypot(e.x - x, e.z - z) > 70)
        )
          sea = { x, z };
    expect(sea).toBeDefined();
    const bait = makeEntity(b, 'turret', 'hostile-1', 'red', sea!);
    b.entities.push(bait);
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    for (let i = 0; i < 6; i++) {
      const e = makeEntity(b, 'ranger', 'alice', 'blue', {
        x: hq.x - 10 + i * 3,
        z: hq.z - 20,
      });
      e.order = 'attack';
      e.target = bait.id;
      b.entities.push(e);
    }
    muster(b, 'hostile-1', hostileGuards(b) + 6);
    b.nextWaveAt = 1000;
    tickBattle(b, 2000);
    expect(b.wave).toBe(1);
    expect(marching(b).some((e) => e.path.length)).toBe(true);
  });
});

describe('Battlefield reserve for hostile armies', () => {
  test('allied growth stops short of the room each garrison needs for a guard and a column', () => {
    const b = newBattle(1000, { seed: 3, difficulty: 'normal', enemyCount: 2 });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    expect(hostileReserve(b)).toBe(2 * (hostileGuards(b) + 6));
    const living = () => b.entities.filter((e) => e.hp > 0).length;
    while (living() < BATTLE_ENTITY_LIMIT - hostileReserve(b))
      b.entities.push(makeEntity(b, 'ranger', 'alice', 'blue', { x: 0, z: 0 }));
    expect(battleHasRoom(b)).toBe(false);
    expect(battleHasRoom(b, 'red')).toBe(true);
    b.entities.pop();
    expect(battleHasRoom(b)).toBe(true);
    // Fielded hostile troops release their share of the reserve.
    for (let i = 0; i < hostileReserve(b); i++)
      b.entities.push(
        makeEntity(b, 'ranger', 'hostile-1', 'red', { x: 0, z: 0 }),
      );
    expect(living()).toBe(BATTLE_ENTITY_LIMIT - 1);
    expect(battleHasRoom(b)).toBe(true);
    b.entities.push(makeEntity(b, 'ranger', 'alice', 'blue', { x: 0, z: 0 }));
    expect(battleHasRoom(b)).toBe(false);
    expect(battleHasRoom(b, 'red')).toBe(false);
    // A headless army no longer reserves anything.
    for (const e of b.entities)
      if (e.owner === 'hostile-2' && e.kind === 'hq') e.hp = 0;
    expect(hostileReserve(b)).toBe(hostileGuards(b) + 6);
  });

  // Regression: a full eight-player lobby against eight armies filled the battlefield
  // with allied forces and enemy bases, so no garrison could ever train a column.
  test('a full eight-player lobby against eight armies still receives counterattacks', () => {
    const b = newBattle(1000, {
      seed: 947,
      difficulty: 'brutal',
      enemyCount: 8,
      playerSlots: 8,
      mapId: 'nordlys',
    });
    const terrain = terrainFor(b);
    for (let i = 0; i < 8; i++)
      joinBattle(b, { id: `p${i}`, name: `P${i}`, culture: 'neutral' }, 1000);
    // Allies grow exactly as far as purchases would let them: up to the hostile reserve.
    const put = (
      owner: string,
      kind: UnitKind | 'reactor' | 'refinery' | 'turret',
      i: number,
      row: number,
    ) => {
      if (!battleHasRoom(b)) return;
      const hq = b.entities.find((e) => e.owner === owner && e.kind === 'hq')!;
      for (let attempt = 0; attempt < 60; attempt++) {
        const p = {
          x: hq.x - 30 + ((i + attempt) % 12) * 5,
          z: hq.z + row + Math.floor((i + attempt) / 12) * 6,
        };
        if (!terrain.groundAt(p.x, p.z)) continue;
        b.entities.push(makeEntity(b, kind, owner, 'blue', p));
        return;
      }
    };
    for (const c of b.commanders) {
      for (let i = 3; i < commandLimit(b); i++)
        put(c.id, (['ranger', 'tank', 'rocket'] as const)[i % 3], i, 20);
      for (let i = 0; i < harvesterLimit(b, c.id); i++)
        put(c.id, 'harvester', i, -16);
      let placed = 0;
      for (
        let i = 0;
        placed < STRUCTURE_LIMIT - 1 && i < 200 && battleHasRoom(b);
        i++
      ) {
        const hq = b.entities.find((e) => e.owner === c.id && e.kind === 'hq')!;
        const p = {
          x: hq.x - 40 + (i % 5) * 18,
          z: hq.z - 44 - Math.floor(i / 5) * 18,
        };
        if (!terrain.buildableAt(p.x, p.z)) continue;
        b.entities.push(
          makeEntity(
            b,
            (['reactor', 'refinery', 'turret'] as const)[i % 3],
            c.id,
            'blue',
            p,
          ),
        );
        placed++;
      }
    }
    expect(b.entities.length).toBe(BATTLE_ENTITY_LIMIT - hostileReserve(b));
    expect(battleHasRoom(b)).toBe(false);
    expect(battleHasRoom(b, 'red')).toBe(true);
    for (let t = 1250; t <= 1000 + 5 * 60000 && b.wave < 1; t += 250)
      tickBattle(b, t);
    expect(b.wave).toBeGreaterThanOrEqual(1);
    expect(marching(b).length).toBeGreaterThan(0);
  }, 120000);
});

describe('Fire on the move', () => {
  function duel(order: 'move' | 'attackMove') {
    const b = newBattle(1000, { seed: 4 });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const { groundAt } = terrainFor(b);
    const ranger = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    // Send the patrol north past a hostile scout standing eight metres ahead.
    const foe = makeEntity(b, 'ranger', 'hostile-1', 'red', {
      x: ranger.x + 6,
      z: ranger.z - 8,
    });
    foe.order = 'hold';
    expect(groundAt(foe.x, foe.z)).toBe(true);
    b.entities.push(foe);
    ranger.order = order;
    ranger.orderAt = 1000;
    ranger.path = [{ x: ranger.x, z: ranger.z - 30 }];
    const start = { x: ranger.x, z: ranger.z };
    tickBattle(b, 2000);
    return { moved: Math.hypot(ranger.x - start.x, ranger.z - start.z), foe };
  }
  test('a moving patrol keeps walking while it shoots; attack-move stops to fight', () => {
    const moving = duel('move');
    expect(moving.foe.hp).toBeLessThan(160);
    expect(moving.moved).toBeGreaterThan(4);
    const fighting = duel('attackMove');
    expect(fighting.foe.hp).toBeLessThan(160);
    expect(fighting.moved).toBe(0);
  });
});
