import { describe, expect, test } from 'vitest';
import {
  advanceKinematics,
  createKinematicState,
  KINEMATIC_STEP,
  routeTail,
  type Mobility,
} from '../lib/tactical-kinematics';
import { UnitMotion, type MotionPose } from '../lib/tactical-motion';
import { mobilityFor, TACTICAL_UNITS, type Entity } from '../lib/tactics';

const mobile = (kind: Parameters<typeof mobilityFor>[0]['kind']) =>
  mobilityFor({ kind })!;
function run(
  mobility: Mobility,
  path: { x: number; z: number }[],
  seconds: number,
  angle = 0,
  v = 0,
) {
  const s = createKinematicState(0, 0, angle, v);
  s.tail = routeTail(path, 0);
  return advanceKinematics(s, path, mobility, seconds, null);
}

describe('Troop kinematics', () => {
  test('every troop declares a drive, a turn rate and an acceleration', () => {
    for (const spec of Object.values(TACTICAL_UNITS)) {
      expect(['foot', 'wheels', 'tracks', 'air']).toContain(spec.drive);
      expect(spec.turn).toBeGreaterThan(0.5);
      expect(spec.accel).toBeGreaterThan(2);
    }
    // Infantry turn near-instantly; the Jotun is the slowest hull to come round.
    expect(TACTICAL_UNITS.ranger.turn).toBeGreaterThan(10);
    expect(TACTICAL_UNITS.jotun.turn).toBeLessThan(TACTICAL_UNITS.tank.turn);
  });

  test('a tracked hull pivots on the spot before driving off', () => {
    const tank = mobile('tank');
    // Facing +z, ordered to go -z: a half turn.
    const pivoting = run(tank, [{ x: 0, z: -20 }], 0.5);
    expect(Math.hypot(pivoting.x, pivoting.z)).toBeLessThan(1e-9);
    expect(Math.abs(pivoting.turnRate)).toBeCloseTo(tank.turn);
    const driving = run(tank, [{ x: 0, z: -20 }], 3);
    expect(driving.z).toBeLessThan(-1);
    expect(Math.abs(Math.abs(driving.angle) - Math.PI)).toBeLessThan(0.01);
  });

  test('wheels cannot pivot: they keep rolling slowly while they come round', () => {
    const lynx = mobile('lynx');
    const s = run(lynx, [{ x: 0, z: -20 }], 0.5);
    expect(s.v).toBeGreaterThan(0);
    expect(s.z).toBeLessThan(0);
    // Far slower than a straight run over the same time.
    expect(-s.z).toBeLessThan(run(lynx, [{ x: 0, z: 20 }], 0.5).z * 0.6);
  });

  test('infantry face a new heading almost at once', () => {
    const s = run(mobile('ranger'), [{ x: 0, z: -20 }], 0.25);
    expect(Math.abs(Math.abs(s.angle) - Math.PI)).toBeLessThan(1e-9);
    expect(s.z).toBeLessThan(-0.5);
  });

  test('speed ramps up, then brakes into an exact arrival', () => {
    const tank = mobile('tank');
    const speeds: number[] = [];
    const s = createKinematicState(0, 0, 0);
    const path = [{ x: 0, z: 30 }];
    s.tail = routeTail(path, 0);
    for (let t = 0; t < 10 && !s.halted; t += KINEMATIC_STEP) {
      advanceKinematics(s, path, tank, KINEMATIC_STEP, null);
      speeds.push(s.v);
    }
    expect(s.z).toBe(30);
    expect(s.v).toBe(0);
    const peak = speeds.indexOf(Math.max(...speeds));
    expect(speeds[0]).toBeLessThan(tank.speed * 0.2);
    expect(Math.max(...speeds)).toBeCloseTo(tank.speed);
    // Monotonic ramp up, monotonic braking; the last moving slice is well below cruise.
    for (let i = 1; i <= peak; i++)
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    for (let i = peak + 1; i < speeds.length - 1; i++)
      expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-9);
    expect(speeds.at(-2)!).toBeLessThan(tank.speed * 0.5);
  });

  test('vehicles slow for sharp corners and stay on the route', () => {
    const lynx = mobile('lynx');
    const path = [
      { x: 0, z: 20 },
      { x: 20, z: 20 },
    ];
    const s = createKinematicState(0, 0, 0, lynx.speed);
    s.tail = routeTail(path, 0);
    let slowest = Infinity;
    for (let t = 0; t < 6 && !s.halted; t += KINEMATIC_STEP) {
      advanceKinematics(s, path, lynx, KINEMATIC_STEP, null);
      if (s.index === 0) expect(s.x).toBe(0);
      else expect(s.z).toBeCloseTo(20);
      if (Math.abs(s.x) < 1 && Math.abs(s.z - 20) < 1)
        slowest = Math.min(slowest, s.v);
    }
    expect(slowest).toBeLessThan(lynx.speed * 0.8);
    expect(s).toMatchObject({ x: 20, z: 20, halted: true });
  });

  test('quarter-second ticks land exactly where one long integration does', () => {
    const tank = mobile('tank');
    const path = [
      { x: 10, z: 10 },
      { x: 10, z: 40 },
    ];
    const whole = run(tank, path, 2);
    const s = createKinematicState(0, 0, 0);
    s.tail = routeTail(path, 0);
    for (let i = 0; i < 8; i++) advanceKinematics(s, path, tank, 0.25, null);
    expect(s.x).toBeCloseTo(whole.x, 9);
    expect(s.z).toBeCloseTo(whole.z, 9);
    expect(s.angle).toBeCloseTo(whole.angle, 9);
  });

  test('a blocked next segment halts the unit at the waypoint', () => {
    const s = createKinematicState(0, 0, 0, 6);
    const path = [
      { x: 0, z: 1 },
      { x: 0, z: 10 },
    ];
    s.tail = routeTail(path, 0);
    advanceKinematics(s, path, mobile('ranger'), 1, null, () => false);
    expect(s).toMatchObject({ x: 0, z: 1, halted: true, index: 1 });
  });
});

describe('Presented motion for the rig', () => {
  const unit = (patch: Partial<Entity> = {}): Entity => ({
    id: 'one',
    kind: 'tank',
    owner: 'alice',
    team: 'blue',
    hp: 1100,
    x: 0,
    z: 0,
    angle: 0,
    path: [{ x: 0, z: -30 }],
    order: 'move',
    readyAt: 0,
    firedAt: 0,
    shotX: 0,
    shotZ: 0,
    ...patch,
  });
  test('a pivoting tank reports its turn rate, then its speed', () => {
    const e = unit();
    const motion = new UnitMotion(e, 1000, 0);
    let pose: MotionPose = motion.sample(e, 1000, 0, true);
    pose = motion.sample(e, 1000, 0.2, true);
    expect(Math.abs(pose.turnRate)).toBeGreaterThan(1);
    expect(pose.speed).toBe(0);
    expect(pose.moving).toBe(true);
    // A later server tick: lined up and rolling.
    const rolling = unit({ angle: Math.PI, v: 4, path: [{ x: 0, z: -30 }] });
    motion.sample(rolling, 1250, 0.25, true);
    pose = motion.sample(rolling, 1250, 0.4, true);
    expect(pose.speed).toBeGreaterThan(4);
  });
  test('an enemy hull swings round at its own turn rate rather than snapping', () => {
    const e = unit({ team: 'red', path: [] });
    const motion = new UnitMotion(e, 1000, 0);
    motion.sample(e, 1000, 0, true);
    const turned = { ...e, angle: Math.PI / 2 };
    const pose = motion.sample(turned, 1250, 1 / 60, true);
    expect(pose.angle).toBeGreaterThan(0);
    expect(pose.angle).toBeLessThan(0.1);
    expect(pose.turnRate).toBeGreaterThan(1);
    for (let t = 2; t <= 90; t++) motion.sample(turned, 1250, t / 60, true);
    expect(motion.pose.angle).toBeCloseTo(Math.PI / 2);
  });
});
