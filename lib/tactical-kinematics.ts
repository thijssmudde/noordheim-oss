/**
 * Deterministic troop kinematics shared by the server simulation and the
 * client's presentation: hull turn rates, acceleration and braking along an
 * approved route. Positions always stay on the route's validated polyline;
 * turning and speed are what change, so a turning vehicle slows down and
 * sweeps its hull round instead of snapping to the next waypoint.
 *
 * Both sides integrate in fixed {@link KINEMATIC_STEP} slices from the same
 * state, so the client's prediction of a quarter-second lands exactly where
 * the next server tick puts the unit.
 */
export type Drive = 'foot' | 'wheels' | 'tracks' | 'air';
export type Mobility = {
  /** Cruising speed in m/s, after doctrine, research and any group pace. */
  speed: number;
  /** Maximum hull yaw rate, rad/s. */
  turn: number;
  /** Acceleration in m/s²; braking is {@link BRAKING} times stronger. */
  accel: number;
  drive: Drive;
};
type XZ = { x: number; z: number };
/** Mutable integration state. `index` is the next waypoint on the route. */
export type KinematicState = {
  x: number;
  z: number;
  angle: number;
  /** Ground speed before terrain slowdown, m/s. */
  v: number;
  index: number;
  /** Signed yaw rate of the last step, rad/s. */
  turnRate: number;
  /** Route length beyond the current waypoint, maintained incrementally. */
  tail: number;
  /** Set when the route ended or was stopped at a blocked segment. */
  halted: boolean;
  /** Terrain slowdown last sampled (fords, marsh) and metres until the next sample. */
  factor: number;
  untilSample: number;
};
/** Ground is re-read every this many metres, like the old two-metre strides. */
export const TERRAIN_SAMPLE = 1.5;
/** Seconds per integration slice. 250 ms server ticks are exactly five slices. */
export const KINEMATIC_STEP = 0.05;
export const BRAKING = 1.5;
/** Speed a unit keeps until its final metre, so braking never becomes Zeno's creep. */
const CRAWL = 0.6;
const TAU = Math.PI * 2;
export const wrapAngle = (a: number) =>
  a - TAU * Math.floor((a + Math.PI) / TAU);

export function createKinematicState(
  x: number,
  z: number,
  angle: number,
  v = 0,
): KinematicState {
  return {
    x,
    z,
    angle,
    v,
    index: 0,
    turnRate: 0,
    tail: 0,
    halted: false,
    factor: 1,
    untilSample: 0,
  };
}
export function copyKinematicState(from: KinematicState, to: KinematicState) {
  to.x = from.x;
  to.z = from.z;
  to.angle = from.angle;
  to.v = from.v;
  to.index = from.index;
  to.turnRate = from.turnRate;
  to.tail = from.tail;
  to.halted = from.halted;
  to.factor = from.factor;
  to.untilSample = from.untilSample;
  return to;
}
/** Route length after waypoint `index`. */
export function routeTail(path: readonly XZ[], index: number) {
  let tail = 0;
  for (let k = index + 1; k < path.length; k++)
    tail += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
  return tail;
}
/** How much of its cruise a unit may use while its hull is `error` radians off course. */
export function alignment(drive: Drive, error: number) {
  switch (drive) {
    case 'foot':
      return error < 1.2 ? 1 : 0.35;
    case 'tracks':
      // Tracked hulls pivot on the spot, then drive off once roughly lined up.
      return error <= 0.3 ? 1 : error >= 0.85 ? 0 : 1 - (error - 0.3) / 0.55;
    case 'wheels':
      // Wheels cannot pivot: they keep rolling slowly and turn on a tight arc.
      return Math.max(0.22, Math.cos(Math.min(error, Math.PI / 2)));
    case 'air':
      return Math.max(0.4, Math.cos(error * 0.6));
  }
}
/** Speed fraction a unit carries through a corner of `bend` radians. */
export function cornering(drive: Drive, bend: number) {
  const sharp = Math.min(1, bend / Math.PI);
  switch (drive) {
    case 'foot':
      return 1 - sharp * 0.3;
    case 'tracks':
      return 1 - sharp * 0.75;
    case 'wheels':
      return 1 - sharp * 0.6;
    case 'air':
      return 1 - sharp * 0.4;
  }
}
/**
 * Advance `s` along `path` for `seconds` in fixed slices (a trailing partial
 * slice covers the remainder). `terrainSpeed` scales ground travel (fords,
 * marsh); `segmentClear` may veto starting a new segment, which halts the
 * unit at the waypoint for the caller to re-route. Never allocates.
 */
export function advanceKinematics(
  s: KinematicState,
  path: readonly XZ[],
  mobility: Mobility,
  seconds: number,
  terrainSpeed: ((x: number, z: number) => number) | null,
  segmentClear?: (from: XZ, to: XZ) => boolean,
) {
  let left = seconds;
  while (left > 1e-9 && !s.halted) {
    const h = left < KINEMATIC_STEP + 1e-9 ? left : KINEMATIC_STEP;
    stepKinematics(s, path, mobility, h, terrainSpeed, segmentClear);
    left -= h;
  }
  if (s.index >= path.length) {
    s.halted = true;
    s.v = 0;
  }
  return s;
}
function stepKinematics(
  s: KinematicState,
  path: readonly XZ[],
  m: Mobility,
  h: number,
  terrainSpeed: ((x: number, z: number) => number) | null,
  segmentClear?: (from: XZ, to: XZ) => boolean,
) {
  // Skip waypoints we are standing on; they carry no heading.
  while (s.index < path.length) {
    const p = path[s.index];
    if (Math.hypot(p.x - s.x, p.z - s.z) >= 1e-6) break;
    s.index++;
    s.tail = routeTail(path, s.index);
  }
  if (s.index >= path.length) {
    s.halted = true;
    s.v = 0;
    s.turnRate = 0;
    return;
  }
  const p = path[s.index];
  const dx = p.x - s.x,
    dz = p.z - s.z,
    d = Math.hypot(dx, dz);
  let desired = Math.atan2(dx, dz);
  const next = s.index + 1 < path.length ? path[s.index + 1] : null;
  let bend = 0;
  if (next) {
    const onward = Math.atan2(next.x - p.x, next.z - p.z);
    bend = Math.abs(wrapAngle(onward - desired));
    // Vehicles start sweeping round a corner before they reach it.
    if (m.drive !== 'foot') {
      const lead = Math.min(4, Math.max(0.5, s.v / m.turn));
      if (d < lead)
        desired += wrapAngle(onward - desired) * 0.5 * (1 - d / lead);
    }
  }
  const error = wrapAngle(desired - s.angle);
  const maxTurn = m.turn * h;
  const yaw = error > maxTurn ? maxTurn : error < -maxTurn ? -maxTurn : error;
  s.angle = wrapAngle(s.angle + yaw);
  s.turnRate = yaw / h;
  const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - s.angle));
  const decel = m.accel * BRAKING;
  let target = m.speed * alignment(m.drive, Math.min(off, Math.abs(error)));
  // Brake for the end of the route, and for corners sharper than the drive can carry.
  const brake = Math.max(CRAWL, Math.sqrt(2 * decel * (d + s.tail)));
  if (brake < target) target = brake;
  if (next) {
    const corner = m.speed * cornering(m.drive, bend);
    const reach = Math.sqrt(corner * corner + 2 * decel * d);
    if (reach < target) target = reach;
  }
  if (s.v < target) s.v = Math.min(target, s.v + m.accel * h);
  else s.v = Math.max(target, s.v - decel * h);
  if (m.drive === 'air' || !terrainSpeed) s.factor = 1;
  else if (s.untilSample <= 0) {
    s.factor = terrainSpeed(s.x, s.z) || 1;
    s.untilSample = TERRAIN_SAMPLE;
  }
  let distance = s.v * s.factor * h;
  s.untilSample -= distance;
  while (distance > 0 && s.index < path.length) {
    const q = path[s.index];
    const ex = q.x - s.x,
      ez = q.z - s.z,
      gap = Math.hypot(ex, ez);
    if (distance < gap) {
      s.x += (ex / gap) * distance;
      s.z += (ez / gap) * distance;
      return;
    }
    s.x = q.x;
    s.z = q.z;
    distance -= gap;
    s.index++;
    s.tail = routeTail(path, s.index);
    if (
      s.index < path.length &&
      segmentClear &&
      !segmentClear(s, path[s.index])
    ) {
      s.halted = true;
      return;
    }
  }
  if (s.index >= path.length) {
    s.halted = true;
    s.v = 0;
  }
}
/** Rotate `angle` toward `goal` by at most `maxStep` radians. */
export function turnToward(angle: number, goal: number, maxStep: number) {
  const error = wrapAngle(goal - angle);
  if (Math.abs(error) <= maxStep) return wrapAngle(goal);
  return wrapAngle(angle + Math.sign(error) * maxStep);
}
