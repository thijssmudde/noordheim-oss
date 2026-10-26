import { describe, expect, test } from 'vitest';
import {
  CARRIER_SPEED,
  FLAG_RADIUS,
  PICKUP_RADIUS,
  PICKUP_SECONDS,
  RETURN_SECONDS,
  carrierOf,
  flagHome,
  hostileGuards,
  isUnit,
  issueOrder,
  joinBattle,
  makeEntity,
  newBattle,
  placementError,
  speedScaleFor,
  tickBattle,
  visibleTo,
  type Battle,
  type Entity,
  type UnitKind,
} from '../lib/tactics';
import { terrainFor } from '../lib/tactical-terrain';
import { sampleRoute, type MotionPose } from '../lib/tactical-motion';
import { openGround } from './helpers/open-ground';
import {
  footprint,
  insideFootprint,
  productionExit,
} from '../lib/tactical-placement';

/** A quiet operation: no hostile troops, no counterattacks, one commander. */
function quiet(
  enemyCount = 1,
  difficulty: 'easy' | 'normal' | 'brutal' = 'normal',
) {
  const b = newBattle(1000, { seed: 5, enemyCount, difficulty });
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
  b.nextWaveAt = 1e12;
  b.hostileTraining = [];
  return b;
}
const hostileFlag = (b: Battle, owner = 'hostile-1') =>
  b.flags!.find((f) => f.owner === owner)!;
const ownFlag = (b: Battle, owner = 'alice') =>
  b.flags!.find((f) => f.owner === owner)!;
/** Remove every hostile troop and the production that would add more. */
function disarm(b: Battle) {
  b.entities = b.entities.filter(
    (e) =>
      e.team === 'blue' ||
      e.kind === 'hq' ||
      e.kind === 'reactor' ||
      e.kind === 'refinery',
  );
}
function put(
  b: Battle,
  kind: UnitKind,
  owner: string,
  p: { x: number; z: number },
) {
  const e = makeEntity(
    b,
    kind,
    owner,
    owner.startsWith('hostile') ? 'red' : 'blue',
    p,
  );
  e.order = 'hold';
  b.entities.push(e);
  return e;
}
/** Tick in quarter seconds, as the server does. */
function run(b: Battle, from: number, seconds: number) {
  let now = from;
  for (let i = 0; i < seconds * 4; i++) tickBattle(b, (now += 250));
  return now;
}
/** Run until `done` holds, in quarter-second ticks; returns the time reached. */
function until(
  b: Battle,
  from: number,
  limitSeconds: number,
  done: () => boolean,
) {
  let now = from;
  while (!done() && now < from + limitSeconds * 1000)
    tickBattle(b, (now += 250));
  return now;
}
const logged = (b: Battle, text: string) =>
  b.events.some((e) => e.text.includes(text));

describe('Flags', () => {
  test('every army plants a flag in open ground ahead of its command station, clear of foundations and exits', () => {
    const b = quiet(2);
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    const terrain = terrainFor(b);
    expect(b.flags).toHaveLength(4);
    for (const flag of b.flags!) {
      expect(flag.radius).toBe(FLAG_RADIUS);
      expect(flag.state).toBe('home');
      expect(flagHome(flag)).toEqual({ x: flag.x, z: flag.z });
      const hq = b.entities.find(
        (e) => e.owner === flag.owner && e.kind === 'hq',
      )!;
      expect(Math.hypot(hq.x - flag.x, hq.z - flag.z)).toBeLessThan(35);
      for (const e of b.entities.filter((e) => !isUnit(e.kind)))
        expect(
          insideFootprint(
            flag,
            footprint(e.kind as 'hq', e, e.angle),
            flag.radius,
          ),
          `${e.kind} over ${flag.name}'s flag`,
        ).toBe(false);
      expect(
        Math.hypot(
          productionExit(hq).x - flag.x,
          productionExit(hq).z - flag.z,
        ),
      ).toBeGreaterThan(flag.radius);
      for (let a = 0; a < 12; a++)
        expect(
          terrain.groundAt(
            flag.x + Math.sin(a) * (flag.radius - 1),
            flag.z + Math.cos(a) * (flag.radius - 1),
          ),
        ).toBe(true);
    }
    // Foundations keep off flag zones.
    const own = ownFlag(b);
    expect(
      placementError(b, 'alice', 'reactor', {
        position: { x: own.x, z: own.z },
        rotation: 0,
      }),
    ).toContain('flag');
  });

  test('rows stored before carrying existed load as flags at home', () => {
    const b = quiet();
    disarm(b);
    for (const f of b.flags!) {
      delete f.state;
      delete f.homeX;
      delete f.homeZ;
    }
    const flag = hostileFlag(b);
    const home = { x: flag.x, z: flag.z };
    tickBattle(b, 1250);
    expect(flag).toMatchObject({ state: 'home', homeX: home.x, homeZ: home.z });
  });

  test(`a troop at the flag for ${PICKUP_SECONDS} s picks it up; leaving range starts over`, () => {
    const b = quiet();
    disarm(b);
    const flag = hostileFlag(b);
    const raider = put(b, 'ranger', 'alice', { x: flag.x + 2, z: flag.z });
    let now = run(b, 1000, 1);
    expect(flag.pickupBy).toBe(raider.id);
    expect(flag.pickupProgress).toBeCloseTo(1, 5);
    // Stepping out of reach loses the progress.
    raider.x = flag.x + PICKUP_RADIUS + 2;
    now = run(b, now, 0.5);
    expect(flag.pickupBy).toBeUndefined();
    raider.x = flag.x + 2;
    now = run(b, now, PICKUP_SECONDS - 0.25);
    expect(flag.state).toBe('home');
    expect(carrierOf(flag)).toBeUndefined();
    now = run(b, now, 0.25);
    expect(flag.state).toBe('carried');
    expect(flag.carrier).toBe(raider.id);
    expect(logged(b, `${flag.name}'s flag taken!`)).toBe(true);
    // The flag rides with its carrier.
    raider.x += 3;
    run(b, now, 0.25);
    expect(flag.x).toBe(raider.x);
    expect(flagHome(flag)).not.toEqual({ x: flag.x, z: flag.z });
  });

  test('aircraft, harvesters and a carrier already holding a flag cannot pick one up', () => {
    const b = quiet(2);
    disarm(b);
    const flag = hostileFlag(b);
    put(b, 'drone', 'alice', flag);
    put(b, 'harvester', 'alice', { x: flag.x + 2, z: flag.z });
    run(b, 1000, 4);
    expect(flag.state).toBe('home');
    expect(flag.pickupBy).toBeUndefined();

    const second = hostileFlag(b, 'hostile-2');
    const raider = put(b, 'ranger', 'alice', { x: flag.x - 2, z: flag.z });
    let now = run(b, 5000, PICKUP_SECONDS);
    expect(flag.carrier).toBe(raider.id);
    Object.assign(raider, { x: second.x + 1, z: second.z });
    now = run(b, now, PICKUP_SECONDS * 2);
    expect(second.state).toBe('home');
    expect(second.pickupBy).toBeUndefined();
  });

  test(`a carrier moves at ${CARRIER_SPEED}x speed, and client prediction agrees with the server`, () => {
    const b = quiet();
    disarm(b);
    const flag = hostileFlag(b);
    const raider = put(b, 'ranger', 'alice', flag);
    const base = speedScaleFor(b, raider);
    let now = run(b, 1000, PICKUP_SECONDS);
    expect(carrierOf(flag)).toBe(raider.id);
    expect(speedScaleFor(b, raider)).toBeCloseTo(base * CARRIER_SPEED, 10);
    // Out in open ground, beside the same troop without a flag.
    const terrain = terrainFor(b);
    const field = openGround(terrain, 50, b.entities, 45);
    Object.assign(raider, { x: field.x - 10, z: field.z - 20 });
    const free = put(b, 'ranger', 'alice', {
      x: field.x + 10,
      z: field.z - 20,
    });
    now = run(b, now, 0.25);
    const starts = [raider, free].map((e) => ({ x: e.x, z: e.z }));
    // The carrier heads for its home zone (else it re-routes itself); the free troop runs parallel.
    const home = flagHome(ownFlag(b)),
      heading = Math.atan2(home.x - raider.x, home.z - raider.z),
      step = {
        x: home.x - raider.x,
        z: home.z - raider.z,
      };
    for (const e of [raider, free])
      Object.assign(e, {
        order: 'move',
        orderAt: now,
        angle: heading,
        v: 6 * speedScaleFor(b, e),
        path: [{ x: e.x + step.x, z: e.z + step.z }],
      });
    const pose: MotionPose = {
      x: 0,
      z: 0,
      angle: 0,
      moving: false,
      speed: 0,
      turnRate: 0,
    };
    for (let i = 0; i < 8; i++) {
      const snapshot: Entity = structuredClone(raider);
      const tickAt = now;
      now = run(b, now, 0.25);
      sampleRoute(
        snapshot,
        0.25,
        tickAt,
        pose,
        speedScaleFor(b, snapshot),
        terrain,
      );
      expect(pose.x).toBeCloseTo(raider.x, 6);
      expect(pose.z).toBeCloseTo(raider.z, 6);
    }
    const covered = (e: Entity, i: number) =>
      Math.hypot(e.x - starts[i].x, e.z - starts[i].z);
    expect(covered(raider, 0) / covered(free, 1)).toBeCloseTo(CARRIER_SPEED, 5);
  });

  test('a carrier runs home on its own, takes no orders, and captures the flag in its zone', () => {
    const b = quiet(2);
    disarm(b);
    const flag = hostileFlag(b);
    const raider = put(b, 'ranger', 'alice', flag);
    raider.hp = 1e9;
    let now = run(b, 1000, PICKUP_SECONDS);
    expect(carrierOf(flag)).toBe(raider.id);
    const home = flagHome(ownFlag(b));
    expect(raider.order).toBe('move');
    expect(() =>
      issueOrder(b, 'alice', [raider.id], 'stop', undefined, undefined, now),
    ).toThrow('Flag carriers run home on their own.');
    now = until(b, now, 240, () => flag.capturedAt !== undefined);
    expect(flag.capturedAt).toBeDefined();
    expect(
      Math.hypot(raider.x - home.x, raider.z - home.z),
    ).toBeLessThanOrEqual(FLAG_RADIUS + 1e-6);
    expect(b.entities.filter((e) => e.owner === 'hostile-1')).toEqual([]);
    expect(b.entities.some((e) => e.owner === 'hostile-2')).toBe(true);
    expect(logged(b, `Flag captured: ${flag.name}. Its army collapses.`)).toBe(
      true,
    );
    expect(b.status).toBe('active');
    // The captured flag hangs on its own pole again.
    expect(flag).toMatchObject({ state: 'home', x: flagHome(flag).x });
    expect(carrierOf(flag)).toBeUndefined();
  }, 60000);

  test("in co-op a carrier may score in an ally's zone; the last hostile flag wins", () => {
    const b = quiet();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    disarm(b);
    const flag = hostileFlag(b);
    const raider = put(b, 'ranger', 'alice', flag);
    run(b, 1000, PICKUP_SECONDS);
    expect(carrierOf(flag)).toBe(raider.id);
    Object.assign(raider, flagHome(ownFlag(b, 'bob')));
    tickBattle(b, 1000 + PICKUP_SECONDS * 1000 + 250);
    expect(flag.capturedAt).toBeDefined();
    expect(b.status).toBe('victory');
  });

  test('a fallen carrier drops the flag; the enemy may take it again, a touch returns it', () => {
    const b = quiet();
    disarm(b);
    const flag = hostileFlag(b);
    const raider = put(b, 'ranger', 'alice', flag);
    let now = run(b, 1000, PICKUP_SECONDS);
    Object.assign(raider, { x: flag.x + 20, z: flag.z });
    now = run(b, now, 0.25);
    const fell = { x: raider.x, z: raider.z };
    raider.hp = 0;
    now = run(b, now, 0.25);
    expect(flag.state).toBe('dropped');
    expect(flag.droppedAt).toBe(now);
    expect(carrierOf(flag)).toBeUndefined();
    expect(Math.hypot(flag.x - fell.x, flag.z - fell.z)).toBeLessThan(1e-6);
    expect(terrainFor(b).groundAt(flag.x, flag.z)).toBe(true);
    expect(logged(b, `${flag.name}'s flag dropped`)).toBe(true);

    // Another allied troop picks it up where it lies.
    const second = put(b, 'ranger', 'alice', { x: flag.x + 1, z: flag.z });
    now = run(b, now, PICKUP_SECONDS);
    expect(flag.carrier).toBe(second.id);
    second.hp = 0;
    now = run(b, now, 0.25);
    expect(flag.state).toBe('dropped');

    // A defender touching it sends it straight home.
    const guard = put(b, 'ranger', 'hostile-1', { x: flag.x + 2, z: flag.z });
    guard.hp = 1e9;
    run(b, now, 0.25);
    expect(flag.state).toBe('home');
    expect(flag).toMatchObject(flagHome(flag));
    expect(logged(b, `${flag.name}'s flag returned.`)).toBe(true);
  });

  test(`a dropped flag nobody touches returns home after ${RETURN_SECONDS} s`, () => {
    const b = quiet();
    disarm(b);
    const own = ownFlag(b);
    // Alice's own troops stay well clear of it.
    b.entities = b.entities.filter(
      (e) => e.owner !== 'alice' || !isUnit(e.kind),
    );
    const raider = put(b, 'ranger', 'hostile-1', own);
    let now = run(b, 1000, PICKUP_SECONDS);
    expect(carrierOf(own)).toBe(raider.id);
    expect(logged(b, 'Your flag has been taken!')).toBe(true);
    raider.hp = 0;
    now = run(b, now, 0.25);
    expect(own.state).toBe('dropped');
    b.entities = b.entities.filter((e) => e.team === 'blue' || !isUnit(e.kind));
    now = run(b, now, RETURN_SECONDS - 0.5);
    expect(own.state).toBe('dropped');
    run(b, now, 0.5);
    expect(own.state).toBe('home');
    expect(logged(b, 'returned on its own')).toBe(true);
  });

  test('an enemy carrier of your flag is always visible, and your troops fire on it first', () => {
    const b = quiet();
    disarm(b);
    const own = ownFlag(b);
    b.entities = b.entities.filter(
      (e) => e.owner !== 'alice' || !isUnit(e.kind),
    );
    const raider = put(b, 'ranger', 'hostile-1', own);
    raider.hp = 1e9;
    let now = run(b, 1000, PICKUP_SECONDS);
    expect(carrierOf(own)).toBe(raider.id);
    Object.assign(raider, { x: own.x + 30, z: own.z, path: [] });
    const decoy = put(b, 'ranger', 'hostile-1', { x: own.x + 21, z: own.z });
    decoy.hp = 1e9;
    // Nothing of Alice's sees that far, but the carrier stays on her map.
    expect(visibleTo('alice', raider, [], b)).toBe(true);
    expect(visibleTo('alice', decoy, [], b)).toBe(false);
    // Guard (stop) and attack-move troops prefer the carrier over a nearer enemy.
    const guard = put(b, 'tank', 'alice', { x: own.x + 12, z: own.z });
    guard.order = 'stop';
    now = run(b, now, 0.25);
    expect({ x: guard.shotX, z: guard.shotZ }).toEqual({
      x: raider.x,
      z: raider.z,
    });
    guard.order = 'attackMove';
    guard.path = [];
    run(b, now, 0.25);
    expect({ x: guard.shotX, z: guard.shotZ }).toEqual({
      x: raider.x,
      z: raider.z,
    });
  });

  test('defenders hunt a carrier holding their flag, then retrieve it when it falls', () => {
    const b = quiet(1, 'brutal');
    disarm(b);
    const flag = hostileFlag(b);
    const hq = b.entities.find(
      (e) => e.owner === 'hostile-1' && e.kind === 'hq',
    )!;
    const guard = put(b, 'tank', 'hostile-1', {
      x: hq.x + (hq.x - flag.x) * 0.6,
      z: hq.z + (hq.z - flag.z) * 0.6,
    });
    guard.order = 'stop';
    const raider = put(b, 'ranger', 'alice', flag);
    raider.hp = 1e9;
    let now = run(b, 1000, PICKUP_SECONDS);
    expect(carrierOf(flag)).toBe(raider.id);
    expect(guard.order).toBe('attack');
    expect(guard.target).toBe(raider.id);
    // It closes in on the carrier as it runs.
    Object.assign(raider, { x: flag.x + 25, z: flag.z, path: [] });
    const gap = Math.hypot(guard.x - raider.x, guard.z - raider.z);
    now = run(b, now, 3);
    expect(Math.hypot(guard.x - raider.x, guard.z - raider.z)).toBeLessThan(
      gap,
    );
    // The carrier falls; the guard stands down and goes to fetch the flag.
    raider.hp = 0;
    now = run(b, now, 0.5);
    expect(flag.state).toBe('dropped');
    now = until(b, now, 60, () => flag.state === 'home');
    expect(flag.state).toBe('home');
    expect(logged(b, `${flag.name}'s flag returned.`)).toBe(true);
    expect(guard.order).not.toBe('attack');
  }, 30000);

  test('on Easy only a thin guard answers, and late', () => {
    const b = quiet(1, 'easy');
    disarm(b);
    const flag = hostileFlag(b);
    const hq = b.entities.find(
      (e) => e.owner === 'hostile-1' && e.kind === 'hq',
    )!;
    const guards = Array.from({ length: 5 }, (_, i) => {
      const g = put(b, 'tank', 'hostile-1', {
        x: hq.x + (hq.x - flag.x) * 0.3 + i * 3,
        z: hq.z + (hq.z - flag.z) * 0.3,
      });
      g.order = 'stop';
      return g;
    });
    const raider = put(b, 'ranger', 'alice', flag);
    raider.hp = 1e9;
    run(b, 1000, PICKUP_SECONDS + 6);
    expect(carrierOf(flag)).toBe(raider.id);
    expect(
      guards.filter((g) => g.target === raider.id).length,
    ).toBeLessThanOrEqual(2);
  });

  test('the home guard falls back onto its flag when the zone is entered', () => {
    const b = quiet();
    const flag = hostileFlag(b);
    const hq = b.entities.find(
      (e) => e.owner === 'hostile-1' && e.kind === 'hq',
    )!;
    const guard = put(b, 'ranger', 'hostile-1', {
      x: hq.x + (hq.x - flag.x) * 0.5,
      z: hq.z + (hq.z - flag.z) * 0.5,
    });
    guard.order = 'stop';
    const raider = put(b, 'ranger', 'alice', flag);
    raider.hp = 1e9;
    tickBattle(b, 1250);
    expect(guard.order).toBe('move');
    const end = guard.path.at(-1)!;
    expect(Math.hypot(end.x - flag.x, end.z - flag.z)).toBeLessThan(
      flag.radius,
    );
  });

  test('a brutal raid picks up the flag and carries it home to end the commander', () => {
    const b = newBattle(1000, { seed: 11, difficulty: 'brutal' });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const own = ownFlag(b);
    // Alice's troops are away; her base stands (it outlasts the raid) but nobody guards the flag.
    b.entities = b.entities.filter(
      (e) => e.owner !== 'alice' || !isUnit(e.kind),
    );
    b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!.hp = 1e9;
    b.hostileTraining = [];
    const hq = b.entities.find(
      (e) => e.owner === 'hostile-1' && e.kind === 'hq',
    )!;
    const exit = productionExit(hq);
    for (let i = 0; i < hostileGuards(b) + 6; i++) {
      const e = makeEntity(b, 'tank', 'hostile-1', 'red', {
        x: exit.x + (i % 4) * 4 - 6,
        z: exit.z + Math.floor(i / 4) * 4,
      });
      e.order = 'stop';
      b.entities.push(e);
    }
    b.nextWaveAt = 1000;
    let now = until(b, 1000, 6 * 60, () => own.state === 'carried');
    expect(b.wave).toBeGreaterThanOrEqual(1);
    expect(logged(b, "advancing on Alice's flag")).toBe(true);
    expect(own.state).toBe('carried');
    expect(logged(b, 'Your flag has been taken!')).toBe(true);
    const carrier = b.entities.find((e) => e.id === own.carrier)!;
    expect(carrier.team).toBe('red');
    // The carrier makes for its own flag zone; the rest of the column escorts it.
    const home = flagHome(hostileFlag(b));
    expect(carrier.order).toBe('move');
    const end = carrier.path.at(-1)!;
    expect(Math.hypot(end.x - home.x, end.z - home.z)).toBeLessThan(
      FLAG_RADIUS,
    );
    now = run(b, now, 10);
    expect(own.state).toBe('carried');
    const escort = b.entities.filter(
      (e) =>
        e.team === 'red' &&
        e !== carrier &&
        // Tanks no longer shove one another, so the carrier opens a small lead.
        Math.hypot(e.x - carrier.x, e.z - carrier.z) < 40,
    );
    expect(escort.length).toBeGreaterThan(1);
    now = until(b, now, 6 * 60, () => own.capturedAt !== undefined);
    expect(own.capturedAt).toBeDefined();
    expect(b.entities.some((e) => e.owner === 'alice')).toBe(false);
    expect(b.commanders[0].eliminatedAt).toBeDefined();
    expect(b.status).toBe('defeat');
    expect(logged(b, 'Flag captured: Alice.')).toBe(true);
  }, 60000);
});
