import { describe, expect, test, vi } from 'vitest';
import { defaultTerrain, terrainFor } from '../lib/tactical-terrain';
import { openGround } from './helpers/open-ground';
import {
  ANTICIPATION_SECONDS,
  ANTICIPATION_TIMEOUT,
  sampleRoute,
  UnitMotion,
  type MotionPose,
} from '../lib/tactical-motion';
import {
  findPath,
  isUnit,
  joinBattle,
  newBattle,
  TACTICAL_TICK_MS,
  tickBattle,
  issueOrder,
  doctrineFor,
  TACTICAL_UNITS,
  mobilityFor,
  type Entity,
  type UnitKind,
} from '../lib/tactics';
import {
  advanceKinematics,
  createKinematicState,
} from '../lib/tactical-kinematics';
/** Metres a troop covers from a standstill on a long straight route. */
function travel(kind: UnitKind, seconds: number, scale = 1) {
  const state = createKinematicState(0, 0, 0);
  advanceKinematics(
    state,
    [{ x: 0, z: 100 }],
    mobilityFor({ kind }, scale)!,
    seconds,
    null,
  );
  return state.z;
}
/** Level, firm ground everywhere: presentation tests measure motion, not a map. */
const flat = {
  ...defaultTerrain,
  terrainSpeed: () => 1,
  groundAt: () => true,
};
const pose = (): MotionPose => ({
  x: 0,
  z: 0,
  angle: 0,
  moving: false,
  speed: 0,
  turnRate: 0,
});
/** Every command station: open-ground searches keep clear of bases and their patrols. */
const stations = (b: { entities: Entity[] }) =>
  b.entities.filter((e) => e.kind === 'hq');
const unit = (patch: Partial<Entity> = {}): Entity => ({
  id: 'one',
  kind: 'ranger',
  owner: 'alice',
  team: 'blue',
  hp: 160,
  x: 0,
  z: 30,
  angle: Math.PI / 2,
  path: [{ x: 30, z: 30 }],
  order: 'move',
  // Already marching at cruise speed, so the route samples at a constant pace.
  v: 6,
  readyAt: 0,
  firedAt: 0,
  shotX: 0,
  shotZ: 0,
  ...patch,
});
describe('Continuous tactical movement', () => {
  test('enemy interpolation validates the segment once and rechecks after new foundations', () => {
    const ground = vi.fn(() => true);
    const terrain = { ...defaultTerrain, groundAt: ground };
    const e = unit({ team: 'red', path: [] });
    const motion = new UnitMotion(e, 1000, 0, 1, terrain);
    const next = { ...e, x: 3.6 };
    const obstacles = [{ minX: 20, maxX: 25, minZ: 25, maxZ: 35 }];
    motion.sample(next, 1600, 0.6, true, obstacles);
    const checks = ground.mock.calls.length;
    for (let frame = 1; frame <= 30; frame++)
      motion.sample(next, 1600, 0.6 + frame / 60, true, obstacles);
    expect(ground).toHaveBeenCalledTimes(checks);
    expect(motion.pose.x).toBeCloseTo(3);
    // A newly placed wall invalidates the cached straight interpolation.
    const wall = { minX: 1.5, maxX: 2, minZ: 28, maxZ: 32 };
    expect(motion.sample(next, 1600, 1.11, true, [wall]).x).toBe(3.6);
  });
  test('60 frame samples move at constant speed across four authoritative snapshots', () => {
    let e = unit(),
      tick = 1000;
    const motion = new UnitMotion(e, tick, 0, 1, flat);
    let previous = 0;
    for (let frame = 1; frame <= 60; frame++) {
      const time = frame / 60;
      if (frame % 15 === 0) {
        tick = 1000 + time * 1000;
        e = unit({ x: time * 6 });
      }
      const rendered = motion.sample(e, tick, time, true);
      expect(rendered.x - previous).toBeCloseTo(0.1, 6);
      previous = rendered.x;
    }
    expect(previous).toBeCloseTo(6, 6);
  });
  test('slow authoritative ticks keep moving between snapshots, then stop on a stalled connection', () => {
    let e = unit(),
      tick = 1000;
    const motion = new UnitMotion(e, tick, 0, 1, flat);
    for (let frame = 1; frame <= 143; frame++) {
      const time = frame / 60;
      if (frame % 36 === 0) {
        tick = 1000 + time * 1000;
        e = unit({ x: time * 6 });
      }
      const rendered = motion.sample(e, tick, time, true);
      // After observing the first slow tick, cover the measured 600 ms cadence.
      if (time > 0.7) {
        expect(rendered.x).toBeCloseTo(time * 6, 6);
        expect(rendered.moving).toBe(true);
      }
    }
    const stopped = { ...motion.sample(e, tick, 5, true) };
    expect(stopped.moving).toBe(false);
    expect(stopped.x).toBeLessThanOrEqual(e.x + 6);
    expect(motion.sample(e, tick, 10, true)).toEqual(stopped);
  });
  test('an early snapshot does not shift the presentation clock and cause repeated speed corrections', () => {
    const motion = new UnitMotion(unit(), 1000, 0, 1, flat);
    motion.sample(unit({ x: 1.5 }), 1250, 0.2, true);
    const next = unit({ x: 3 });
    motion.sample(next, 1500, 0.5, true);
    expect(motion.sample(next, 1500, 0.65, true).x).toBeCloseTo(3.9);
  });
  test('enemy interpolation covers slow ticks without pausing halfway between observations', () => {
    const e = unit({ team: 'red', path: [] });
    const motion = new UnitMotion(e, 1000, 0, 1, flat);
    const next = { ...e, x: 3.6 };
    motion.sample(next, 1600, 0.6, true);
    expect(motion.sample(next, 1600, 1.1, true)).toMatchObject({
      x: expect.closeTo(3),
      moving: true,
    });
    expect(motion.sample(next, 1600, 3, true)).toMatchObject({
      x: 3.6,
      moving: false,
    });
  });
  test('route sampling preserves corners and crosses rivers only on land or bridges', () => {
    const terrain = defaultTerrain;
    const bridge = terrain.design.crossings.find((c) => c.style !== 'ford')!;
    const reach = bridge.length / 2 + 12,
      dx = Math.sin(bridge.angle) * reach,
      dz = Math.cos(bridge.angle) * reach;
    const from = { x: bridge.x - dx, z: bridge.z - dz },
      to = { x: bridge.x + dx, z: bridge.z + dz };
    const route = findPath(from, to, false, [], terrain);
    expect(route.length).toBeGreaterThan(0);
    const e = unit({ ...from, path: structuredClone(route) });
    const snapshot = structuredClone(e);
    for (let step = 0; step < 3000; step++) {
      const p = sampleRoute(e, 0.5, 1000, pose(), 1, terrain);
      expect(terrain.groundAt(p.x, p.z)).toBe(true);
      while (
        e.path.length &&
        Math.hypot(e.path[0].x - e.x, e.path[0].z - e.z) < 0.01
      )
        e.path.shift();
      const next = e.path[0];
      if (!next) break;
      const d = Math.hypot(next.x - e.x, next.z - e.z),
        travel = Math.min(d, 0.1);
      e.x += ((next.x - e.x) * travel) / d;
      e.z += ((next.z - e.z) * travel) / d;
    }
    expect(e.path).toHaveLength(0);
    const out = sampleRoute(snapshot, 0.2, 1000, pose(), 1, terrain);
    expect(out).not.toBe(snapshot);
    expect(snapshot.path).toEqual(route);
    const corner = unit({
      x: 0,
      z: 20,
      path: [
        { x: 1, z: 20 },
        { x: 1, z: 25 },
      ],
    });
    // The corner stays on the route; the soldier eases off a little to take it.
    const turned = sampleRoute(corner, 0.5, 1000, pose(), 1, flat);
    expect(turned.x).toBe(1);
    expect(turned.z).toBeGreaterThan(21.8);
    expect(turned.z).toBeLessThanOrEqual(22);
  });
  test('order acknowledgement does not restart prediction; redirects respond before the next tick', () => {
    const original = unit({ path: [], order: 'hold' });
    const motion = new UnitMotion(original, 1000, 0, 1, flat),
      moving = unit();
    motion.sample(moving, 1000, 0.01, true);
    expect(motion.sample(moving, 1000, 0.11, true).x).toBeCloseTo(0.6);
    expect(
      motion.sample(structuredClone(moving), 1000, 0.21, true).x,
    ).toBeCloseTo(1.2);
    const redirected = unit({ path: [{ x: -30, z: 30 }] });
    motion.sample(redirected, 1000, 0.22, true);
    expect(motion.sample(redirected, 1000, 0.32, true).x).toBeLessThan(0);
  });
  test('stalled connections, combat, unfinished units, hold, and ended battles stop prediction', () => {
    const e = unit();
    expect(sampleRoute(e, 20, 1000, pose(), 1, flat)).toMatchObject({
      x: 3,
      moving: false,
    });
    for (const patch of [
      { order: 'hold' as const },
      { readyAt: 2000 },
      { hp: 0 },
      { order: 'attack' as const, firedAt: 1000 },
    ])
      expect(
        sampleRoute(unit(patch), 0.2, 1000, pose(), 1, flat),
      ).toMatchObject({
        x: 0,
        moving: false,
      });
    const motion = new UnitMotion(e, 1000, 0, 1, flat);
    motion.sample(e, 1000, 0.2, true);
    expect(motion.sample(e, 1000, 1, false)).toMatchObject({
      x: 0,
      moving: false,
    });
  });
  test('enemy movement interpolates known observations without exposing or predicting a route', () => {
    const e = unit({ team: 'red', path: [] });
    const motion = new UnitMotion(e, 1000, 0, 1, flat);
    const next = { ...e, x: 1.5 };
    motion.sample(next, 1250, 0.25, true);
    expect(motion.sample(next, 1250, 0.375, true).x).toBeCloseTo(0.75);
    expect(motion.sample(next, 1250, 2, true)).toMatchObject({
      x: 1.5,
      moving: false,
    });
  });
  test('gunships interpolate over water without snapping to the latest observation', () => {
    const terrain = defaultTerrain;
    const water = terrain.design.rivers[0].path[1];
    const e = unit({
      team: 'red',
      kind: 'gunship',
      x: water.x,
      z: water.z,
      path: [],
    });
    expect(terrain.groundAt(e.x, e.z)).toBe(false);
    const motion = new UnitMotion(e, 1000, 0, 1, terrain);
    const next = { ...e, x: water.x + 1.5 };
    motion.sample(next, 1250, 0.25, true);
    expect(motion.sample(next, 1250, 0.375, true).x).toBeCloseTo(
      water.x + 0.75,
    );
  });
  test('an order issued between ticks only moves for the time since that command', () => {
    const b = newBattle(1000);
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const e = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    Object.assign(e, openGround(terrainFor(b), 40, stations(b)));
    const start = { x: e.x, z: e.z };
    issueOrder(
      b,
      'alice',
      [e.id],
      'move',
      { x: e.x, z: e.z - 10 },
      undefined,
      1200,
    );
    tickBattle(b, 1250);
    const scale = doctrineFor(b, 'alice').speed;
    expect(Math.hypot(e.x - start.x, e.z - start.z)).toBeCloseTo(
      travel('ranger', 0.05, scale),
    );
    tickBattle(b, 1500);
    expect(Math.hypot(e.x - start.x, e.z - start.z)).toBeCloseTo(
      travel('ranger', 0.3, scale),
    );
  });
  test('stopping between snapshots preserves distance already travelled and does not move twice', () => {
    const b = newBattle(1000);
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const e = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    const start = openGround(terrainFor(b), 40, stations(b));
    Object.assign(e, { ...start, angle: Math.PI / 2 });
    const scale = doctrineFor(b, 'alice').speed;
    issueOrder(
      b,
      'alice',
      [e.id],
      'move',
      { x: start.x + 20, z: start.z },
      undefined,
      1000,
    );
    tickBattle(b, 1250);
    expect(e.x - start.x).toBeCloseTo(travel('ranger', 0.25, scale));
    issueOrder(b, 'alice', [e.id], 'hold', undefined, undefined, 1400);
    expect(e.x - start.x).toBeCloseTo(travel('ranger', 0.4, scale));
    tickBattle(b, 1500);
    expect(e.x - start.x).toBeCloseTo(travel('ranger', 0.4, scale));
    expect(e.v).toBeUndefined();
    expect(e.path).toEqual([]);
  });
  test('quarter-second simulation preserves movement speed and income over one second', () => {
    const a = newBattle(1000);
    joinBattle(a, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const e = a.entities.find((e) => e.owner === 'alice' && isUnit(e.kind))!;
    issueOrder(a, 'alice', [e.id], 'move', { x: e.x, z: e.z - 10 });
    const b = structuredClone(a);
    tickBattle(a, 2000);
    for (let t = 1000 + TACTICAL_TICK_MS; t <= 2000; t += TACTICAL_TICK_MS)
      tickBattle(b, t);
    expect(b.entities.find((u) => u.id === e.id)!.x).toBeCloseTo(e.x);
    expect(b.entities.find((u) => u.id === e.id)!.z).toBeCloseTo(e.z);
    expect(b.commanders[0].credits).toEqual(a.commanders[0].credits);
  });
});
describe('Local order anticipation', () => {
  const idle = () => unit({ path: [], order: 'hold', orderAt: 500 });
  const frames = (
    motion: UnitMotion,
    e: Entity,
    tickAt: number,
    from: number,
    to: number,
    obstacles?: Parameters<UnitMotion['sample']>[4],
  ) => {
    const xs: number[] = [];
    for (let now = from; now <= to + 1e-9; now += 1 / 60)
      xs.push(motion.sample(e, tickAt, now, true, obstacles).x);
    return xs;
  };
  test('a troop faces and walks toward a fresh order on the next frame, for a bounded head start', () => {
    const e = idle(),
      motion = new UnitMotion(e, 1000, 0, 1, flat);
    motion.sample(e, 1000, 0, true);
    motion.anticipate({ x: 30, z: 30 }, 0, 'move');
    const first = motion.sample(e, 1000, 1 / 60, true);
    expect(first.angle).toBeCloseTo(Math.PI / 2);
    expect(first.moving).toBe(true);
    expect(first.x).toBeGreaterThan(0);
    // An ordinary tick without the order does not end the head start.
    motion.sample({ ...e }, 1250, 0.25, true);
    frames(motion, { ...e }, 1250, 0.25, 2);
    // A bounded head start from a standstill: it accelerates like the server would.
    // Frame-sized slices land within a few centimetres of the server's grid.
    expect(
      Math.abs(motion.pose.x - travel('ranger', ANTICIPATION_SECONDS)),
    ).toBeLessThan(0.1);
    expect(motion.pose.moving).toBe(false);
    expect(motion.anticipating).toBe(true);
  });
  test('the server route replaces the head start without pulling the troop backwards', () => {
    const e = idle(),
      motion = new UnitMotion(e, 1000, 0, 1, flat);
    motion.sample(e, 1000, 0, true);
    motion.anticipate({ x: 30, z: 30 }, 0, 'move');
    frames(motion, e, 1000, 1 / 60, 0.3);
    // The route lands at 0.3 s; the server then walks it with 250 ms snapshots.
    const speed = TACTICAL_UNITS.ranger.speed;
    const routed = (tick: number) =>
      unit({
        orderAt: 1250,
        x: (speed * (tick - 1250)) / 1000,
        path: [{ x: 30, z: 30 }],
      });
    const xs: number[] = [];
    for (let snapshot = 0; snapshot < 8; snapshot++) {
      const tick = 1250 + snapshot * 250,
        at = 0.3 + snapshot * 0.25;
      xs.push(...frames(motion, routed(tick), tick, at + 1 / 60, at + 0.25));
    }
    expect(motion.anticipating).toBe(false);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    // Once blended out, the troop follows the authoritative route again.
    expect(xs.at(-1)).toBeCloseTo(speed * (1.75 + 0.25), 0);
  });
  test('rejected or unanswered orders settle back onto the known position', () => {
    for (const reject of [true, false]) {
      const e = idle(),
        motion = new UnitMotion(e, 1000, 0, 1, flat);
      motion.sample(e, 1000, 0, true);
      motion.anticipate({ x: 30, z: 30 }, 0, 'move');
      frames(motion, e, 1000, 1 / 60, 0.5);
      expect(motion.pose.x).toBeGreaterThan(1);
      if (reject) motion.cancelAnticipation(0.5);
      const end = reject ? 2 : ANTICIPATION_TIMEOUT + 2;
      frames(motion, e, 1000, 0.5, end);
      expect(motion.anticipating).toBe(false);
      expect(motion.pose.x).toBeCloseTo(0);
    }
  });
  test('the head start stops at buildings, and troops exchanging fire keep fighting', () => {
    const e = idle(),
      motion = new UnitMotion(e, 1000, 0, 1, flat);
    const wall = [{ minX: 1.5, maxX: 2, minZ: 28, maxZ: 32 }];
    motion.sample(e, 1000, 0, true, wall);
    motion.anticipate({ x: 30, z: 30 }, 0, 'move');
    frames(motion, e, 1000, 1 / 60, 1, wall);
    expect(motion.pose.x).toBe(0);
    expect(motion.pose.angle).toBeCloseTo(Math.PI / 2);
    const firing = unit({ path: [], order: 'attackMove', firedAt: 900 });
    const fighter = new UnitMotion(firing, 1000, 0, 1, flat);
    fighter.sample(firing, 1000, 0, true);
    fighter.anticipate({ x: 30, z: 30 }, 0, 'attackMove');
    expect(fighter.anticipating).toBe(false);
    expect(fighter.sample(firing, 1000, 0.2, true).x).toBe(0);
  });
});
