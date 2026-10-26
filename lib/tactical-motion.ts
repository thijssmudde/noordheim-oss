import { defaultTerrain, type TerrainMap } from './tactical-terrain';
import {
  isAir,
  isUnit,
  mobilityFor,
  TACTICAL_TICK_MS,
  TACTICAL_UNITS,
  type Entity,
  type Point,
} from './tactics';
import {
  advanceKinematics,
  copyKinematicState,
  createKinematicState,
  KINEMATIC_STEP,
  routeTail,
  turnToward,
  wrapAngle,
  type KinematicState,
  type Mobility,
} from './tactical-kinematics';
import {
  insideFootprint,
  segmentIntersectsFootprint,
  type Footprint,
} from './tactical-placement';
export type MotionPose = Point & {
  angle: number;
  moving: boolean;
  /** Presented ground speed, m/s, for wheel spin and gait. */
  speed: number;
  /** Presented hull yaw rate, rad/s (positive turns toward +x from +z). */
  turnRate: number;
};
const NO_OBSTACLES: Footprint[] = [];
/** Seconds a troop may walk toward a fresh order before the server's route arrives. */
export const ANTICIPATION_SECONDS = 0.35;
/** A server that never applies the order: the troop settles back after this long. */
export const ANTICIPATION_TIMEOUT = 4;
/** Troops stop anticipating this close to the ordered point; their formation slot may differ. */
const ANTICIPATION_ARRIVAL = 2;
type Anticipation = {
  point: Point;
  /** The head start's own one-point route, pulled back from the ordered point. */
  goal: Point[];
  state: KinematicState;
  /** The server's order timestamp when anticipation began; a new one means the route landed. */
  orderAt: number | undefined;
  start: number;
  last: number;
  travelled: number;
  /** Obstacles the whole head start was validated against. */
  checked: Footprint[] | undefined;
  blocked: boolean;
};
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const samePoint = (a?: Point, b?: Point) => a?.x === b?.x && a?.z === b?.z;
function sameMotion(a: Entity, b: Entity) {
  if (a === b) return true;
  return (
    a.x === b.x &&
    a.z === b.z &&
    a.angle === b.angle &&
    a.v === b.v &&
    a.pace === b.pace &&
    a.order === b.order &&
    a.readyAt === b.readyAt &&
    a.firedAt === b.firedAt &&
    a.path.length === b.path.length &&
    a.path.every((p, i) => samePoint(p, b.path[i]))
  );
}
/** Whether the snapshot's route may be predicted at all. */
function predictable(e: Entity, tickAt: number) {
  return !(
    !isUnit(e.kind) ||
    e.readyAt ||
    e.hp <= 0 ||
    e.order === 'hold' ||
    (e.order !== 'move' && e.firedAt > 0 && e.firedAt >= tickAt)
  );
}
function resetState(s: KinematicState, e: Entity) {
  s.x = e.x;
  s.z = e.z;
  s.angle = e.angle;
  s.v = e.path.length ? (e.v ?? 0) : 0;
  s.index = 0;
  s.turnRate = 0;
  s.tail = routeTail(e.path, 0);
  s.halted = !e.path.length;
  s.factor = 1;
  s.untilSample = 0;
  return s;
}
/**
 * Presents a snapshot `seconds` ahead on the server's own fixed integration
 * grid: whole kinematic slices, then a blend toward the next slice. A cursor
 * reuses the previous frame's slices, so a frame usually costs one slice.
 */
class RouteCursor {
  private source: Entity | null = null;
  private mobility: Mobility | null = null;
  private terrain: TerrainMap | null = null;
  private slice = 0;
  private readonly before = createKinematicState(0, 0, 0);
  private readonly after = createKinematicState(0, 0, 0);
  reset() {
    this.source = null;
  }
  sample(
    e: Entity,
    seconds: number,
    mobility: Mobility,
    terrain: TerrainMap,
    out: MotionPose,
  ) {
    const speed = (s: KinematicState) => s.v * s.factor;
    if (
      e !== this.source ||
      terrain !== this.terrain ||
      !this.mobility ||
      this.mobility.speed !== mobility.speed ||
      seconds < this.slice * KINEMATIC_STEP - 1e-9
    ) {
      this.source = e;
      this.terrain = terrain;
      this.mobility = mobility;
      this.slice = 0;
      resetState(this.before, e);
      this.step(e, mobility, terrain);
    }
    while (seconds >= (this.slice + 1) * KINEMATIC_STEP - 1e-9) {
      copyKinematicState(this.after, this.before);
      this.slice++;
      this.step(e, mobility, terrain);
    }
    const t = clamp(
      (seconds - this.slice * KINEMATIC_STEP) / KINEMATIC_STEP,
      0,
      1,
    );
    const a = this.before,
      b = this.after;
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.angle = wrapAngle(a.angle + wrapAngle(b.angle - a.angle) * t);
    out.turnRate = b.turnRate;
    out.speed = b.halted && t >= 1 ? 0 : speed(a) + (speed(b) - speed(a)) * t;
    out.moving =
      !(a.halted && b.halted) &&
      (out.speed > 0.05 || Math.abs(out.turnRate) > 0.05);
    return out;
  }
  private step(e: Entity, mobility: Mobility, terrain: TerrainMap) {
    copyKinematicState(this.before, this.after);
    advanceKinematics(
      this.after,
      e.path,
      mobility,
      KINEMATIC_STEP,
      mobility.drive === 'air' ? null : terrain.terrainSpeed,
    );
  }
}
const sharedCursor = new RouteCursor();
/**
 * Samples the route with the server's turn rates, acceleration and braking;
 * corners stay on the route. Never mutates a Convex snapshot.
 */
export function sampleRoute(
  e: Entity,
  seconds: number,
  tickAt: number,
  out: MotionPose,
  speedScale = 1,
  terrain: TerrainMap = defaultTerrain,
  predictionSeconds = 0.5,
  cursor?: RouteCursor,
): MotionPose {
  out.x = e.x;
  out.z = e.z;
  out.angle = e.angle;
  out.moving = false;
  out.speed = 0;
  out.turnRate = 0;
  const mobility = predictable(e, tickAt) && mobilityFor(e, speedScale);
  if (!mobility || !e.path.length) return out;
  // Stop extrapolating on a stalled connection; the server remains authoritative.
  const horizon = clamp(predictionSeconds, 0, 1);
  if (!cursor) {
    // Stateless callers may mutate their entity between calls; start afresh.
    cursor = sharedCursor;
    cursor.reset();
  }
  cursor.sample(e, clamp(seconds, 0, horizon), mobility, terrain, out);
  if (!(seconds >= 0 && seconds < horizon)) {
    out.moving = false;
    out.speed = 0;
    out.turnRate = 0;
  }
  return out;
}
function clearCorrection(
  from: Point,
  to: Point,
  air: boolean,
  obstacles: Footprint[],
  terrain: TerrainMap = defaultTerrain,
) {
  const { groundAt } = terrain;

  if (air) return true;
  for (const box of obstacles) {
    if (
      !insideFootprint(from, box, 1) &&
      segmentIntersectsFootprint(from, to, box)
    )
      return false;
  }
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) * 2),
  );
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!groundAt(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t))
      return false;
  }
  return true;
}

/** Frame-rate-independent presentation of authoritative positions and approved routes. */
export class UnitMotion {
  readonly pose: MotionPose;
  private source: Entity;
  private tickAt: number;
  private origin: number;
  private received: number;
  private from: Point;
  private correction: Point = { x: 0, z: 0 };
  private target: MotionPose;
  private blendSeconds = TACTICAL_TICK_MS / 1000;
  private predictionSeconds = 0.5;
  private interpolationObstacles: Footprint[] | undefined;
  private interpolationClear = false;
  private correctionSeconds = 0.08;
  private anticipation: Anticipation | null = null;
  /** Separate cursors: reconciling the old route must not evict the new one. */
  private cursor = new RouteCursor();
  private spareCursor = new RouteCursor();
  /** Presented heading, eased at the hull's own turn rate; NaN before the first frame. */
  private heading = Number.NaN;
  private lastFrame = Number.NaN;
  private readonly turn: number;
  constructor(
    e: Entity,
    tickAt: number,
    now: number,
    readonly speedScale = 1,
    readonly terrain: TerrainMap = defaultTerrain,
  ) {
    this.source = e;
    this.tickAt = tickAt;
    this.origin = now;
    this.received = now;
    this.pose = {
      x: e.x,
      z: e.z,
      angle: e.angle,
      moving: false,
      speed: 0,
      turnRate: 0,
    };
    this.from = { x: e.x, z: e.z };
    this.target = { ...this.pose };
    this.turn = isUnit(e.kind) ? TACTICAL_UNITS[e.kind].turn : 0;
  }
  /**
   * Respond to a local order before the server's route arrives: swing toward
   * the ordered point at the hull's turn rate and start moving (tracked hulls
   * pivot first). When the route lands, the difference blends out over a few
   * hundred milliseconds instead of pulling the troop back.
   */
  anticipate(point: Point, now: number, order: 'move' | 'attackMove') {
    const e = this.source;
    if (!isUnit(e.kind) || e.team !== 'blue' || e.readyAt || e.hp <= 0) return;
    // A troop exchanging fire keeps fighting until the server says otherwise.
    if (
      order === 'attackMove' &&
      e.firedAt > 0 &&
      e.firedAt >= this.tickAt - 1000
    )
      return;
    const dx = point.x - this.pose.x,
      dz = point.z - this.pose.z,
      d = Math.hypot(dx, dz);
    const stop = Math.max(0, d - ANTICIPATION_ARRIVAL) / Math.max(d, 1e-9);
    const state = createKinematicState(
      this.pose.x,
      this.pose.z,
      Number.isNaN(this.heading) ? this.pose.angle : this.heading,
      this.pose.speed,
    );
    const goal = [{ x: this.pose.x + dx * stop, z: this.pose.z + dz * stop }];
    this.anticipation = {
      point: { x: point.x, z: point.z },
      goal,
      state,
      orderAt: e.orderAt,
      start: now,
      last: now,
      travelled: 0,
      checked: undefined,
      blocked: false,
    };
  }
  /** Drop an order the server rejected; the troop settles back onto its known route. */
  cancelAnticipation(now: number) {
    if (this.anticipation) this.anticipation.start = now - ANTICIPATION_TIMEOUT;
  }
  get anticipating() {
    return this.anticipation !== null;
  }
  private advanceAnticipation(
    a: Anticipation,
    now: number,
    obstacles: Footprint[],
  ) {
    const dt = clamp(now - a.last, 0, 0.1);
    a.last = now;
    const e = this.source;
    const mobility = mobilityFor(e, this.speedScale)!;
    const air = mobility.drive === 'air';
    const s = a.state,
      goal = a.goal[0];
    this.pose.moving = false;
    this.pose.speed = 0;
    this.pose.turnRate = 0;
    const distance = Math.hypot(a.point.x - s.x, a.point.z - s.z);
    if (distance < 1e-6) return this.pose;
    if (a.checked !== obstacles) {
      // Validate the whole head start once: frame-sized steps would slip
      // through a footprint's exit margin, and rescanning every frame is waste.
      const reach = Math.min(
        Math.hypot(goal.x - s.x, goal.z - s.z),
        mobility.speed * (ANTICIPATION_SECONDS - a.travelled) + 1,
      );
      const dx = goal.x - s.x,
        dz = goal.z - s.z,
        d = Math.hypot(dx, dz) || 1;
      a.blocked = !clearCorrection(
        s,
        { x: s.x + (dx / d) * reach, z: s.z + (dz / d) * reach },
        air,
        obstacles,
        this.terrain,
      );
      a.checked = obstacles;
    }
    const time = Math.min(dt, ANTICIPATION_SECONDS - a.travelled);
    if (time > 0 && s.index < a.goal.length) {
      if (a.blocked) {
        // Face the order in place; the route will lead around the obstacle.
        const facing = Math.atan2(a.point.x - s.x, a.point.z - s.z);
        const before = s.angle;
        s.angle = turnToward(s.angle, facing, mobility.turn * time);
        this.pose.turnRate = wrapAngle(s.angle - before) / time;
        s.v = 0;
      } else {
        advanceKinematics(
          s,
          a.goal,
          mobility,
          time,
          air ? null : this.terrain.terrainSpeed,
        );
        this.pose.turnRate = s.turnRate;
        this.pose.speed = s.v;
      }
      a.travelled += time;
      this.pose.moving =
        this.pose.speed > 0.05 || Math.abs(this.pose.turnRate) > 0.05;
    } else if (!a.blocked && s.index >= a.goal.length) s.v = 0;
    this.pose.x = s.x;
    this.pose.z = s.z;
    this.pose.angle = this.heading = s.angle;
    return this.pose;
  }
  sample(
    e: Entity,
    tickAt: number,
    now: number,
    active: boolean,
    obstacles: Footprint[] = NO_OBSTACLES,
  ): MotionPose {
    const frame = Number.isNaN(this.lastFrame)
      ? 0
      : clamp(now - this.lastFrame, 0, 0.25);
    this.lastFrame = now;
    const a = this.anticipation;
    let settle = false;
    if (a) {
      if (
        active &&
        e.hp > 0 &&
        e.orderAt === a.orderAt &&
        now - a.start < ANTICIPATION_TIMEOUT
      ) {
        // The server has not routed this order yet; keep its snapshot without rendering it.
        this.source = e;
        this.tickAt = tickAt;
        this.origin = this.received = now;
        return this.advanceAnticipation(a, now, obstacles);
      }
      this.anticipation = null;
      settle = true;
      // Blend the head start out slowly enough that the troop only eases off, never reverses.
      this.correctionSeconds = clamp(a.travelled * 2.5, 0.25, 1);
    }
    if (settle || tickAt !== this.tickAt || !sameMotion(e, this.source)) {
      // Reconcile against where the previous route would be now, not last frame.
      if (!settle) {
        this.present(
          this.source,
          this.tickAt,
          now,
          active,
          obstacles,
          this.cursor,
        );
        // The old route's cursor is spent; the new snapshot starts on the spare.
        const spent = this.cursor;
        this.cursor = this.spareCursor;
        this.spareCursor = spent;
        // A slow blend still under way keeps its pace; squeezing the rest of it
        // into one short correction would jerk the troop backwards.
        this.correctionSeconds = Math.max(
          0.08,
          this.correctionSeconds - (now - this.received),
        );
      }
      const interval = (tickAt - this.tickAt) / 1000;
      // The scheduler and transport add to the nominal 250 ms cadence. Cover
      // observed gaps plus jitter, while still stopping within one second.
      if (interval > 0)
        this.predictionSeconds = clamp(
          Math.max(interval, now - this.received) * 1.5,
          0.5,
          1,
        );
      const continuing =
        interval > 0 &&
        interval <= 1 &&
        e.order === this.source.order &&
        e.path.length > 0 &&
        this.source.path.length > 0 &&
        samePoint(e.path.at(-1), this.source.path.at(-1));
      this.origin = continuing ? this.origin + interval : now;
      // Keep the clock through small early arrivals; resetting on every early
      // packet accumulates drift and forces the next snapshot to pull us back.
      // Only real discontinuities (e.g. a suspended tab) reset it to receipt.
      if (
        now - this.origin > this.predictionSeconds ||
        this.origin - now > this.predictionSeconds
      )
        this.origin = now;
      this.received = now;
      this.from.x = this.pose.x;
      this.from.z = this.pose.z;
      this.interpolationObstacles = undefined;
      this.blendSeconds = clamp(interval || TACTICAL_TICK_MS / 1000, 0.08, 1);
      this.source = e;
      this.tickAt = tickAt;
      sampleRoute(
        e,
        now - this.origin,
        tickAt,
        this.target,
        this.speedScale,
        this.terrain,
        this.predictionSeconds,
        this.cursor,
      );
      this.correction.x = this.pose.x - this.target.x;
      this.correction.z = this.pose.z - this.target.z;
      if (Math.hypot(this.correction.x, this.correction.z) > (settle ? 12 : 4))
        this.correction.x = this.correction.z = 0;
    }
    this.present(e, tickAt, now, active, obstacles, this.cursor);
    this.ease(frame);
    return this.pose;
  }
  /** Rotate the presented heading at no more than the hull's own turn rate. */
  private ease(frame: number) {
    const goal = this.pose.angle;
    if (Number.isNaN(this.heading) || !frame || !this.turn) {
      this.heading = goal;
      return;
    }
    const before = this.heading;
    // A little faster than the hull, so presentation never lags the server by much.
    this.heading = turnToward(before, goal, this.turn * 1.5 * frame);
    this.pose.angle = this.heading;
    const rate = wrapAngle(this.heading - before) / frame;
    if (Math.abs(rate) > Math.abs(this.pose.turnRate))
      this.pose.turnRate = rate;
  }
  private present(
    e: Entity,
    tickAt: number,
    now: number,
    active: boolean,
    obstacles: Footprint[],
    cursor: RouteCursor,
  ) {
    if (!active) {
      this.pose.x = e.x;
      this.pose.z = e.z;
      this.pose.angle = e.angle;
      this.pose.moving = false;
      this.pose.speed = 0;
      this.pose.turnRate = 0;
      this.origin = now;
      this.heading = Number.NaN;
      return;
    }
    if (e.team === 'red') {
      // Enemy routes remain private. Interpolate observed positions, never their future orders.
      // Validate the whole observed segment once, rather than scanning every
      // building and resampling the same ground on each rendered frame.
      if (this.interpolationObstacles !== obstacles) {
        this.interpolationClear = clearCorrection(
          this.from,
          e,
          isAir(e.kind),
          obstacles,
          this.terrain,
        );
        this.interpolationObstacles = obstacles;
      }
      const t = clamp((now - this.received) / this.blendSeconds, 0, 1);
      this.target.x = this.from.x + (e.x - this.from.x) * t;
      this.target.z = this.from.z + (e.z - this.from.z) * t;
      if (!this.interpolationClear) {
        this.target.x = e.x;
        this.target.z = e.z;
      }
      const gap = Math.hypot(e.x - this.from.x, e.z - this.from.z);
      this.pose.moving = t < 1 && gap > 0.01;
      this.pose.speed = this.pose.moving ? gap / this.blendSeconds : 0;
      this.pose.turnRate = 0;
      this.pose.x = this.target.x;
      this.pose.z = this.target.z;
      this.pose.angle = e.angle;
      return;
    }
    sampleRoute(
      e,
      now - this.origin,
      tickAt,
      this.pose,
      this.speedScale,
      this.terrain,
      this.predictionSeconds,
      cursor,
    );
    const correction =
      1 - clamp((now - this.received) / this.correctionSeconds, 0, 1);
    if (correction > 0 && (this.correction.x || this.correction.z)) {
      this.target.x = this.pose.x + this.correction.x * correction;
      this.target.z = this.pose.z + this.correction.z * correction;
      if (
        clearCorrection(
          this.pose,
          this.target,
          isAir(e.kind),
          obstacles,
          this.terrain,
        )
      ) {
        this.pose.x = this.target.x;
        this.pose.z = this.target.z;
      }
    }
  }
}

type LocalOrder = {
  serial: number;
  point: Point;
  order: 'move' | 'attackMove';
  cancelled: boolean;
};
/**
 * Orders this client just issued, read by frame loops so troops and the
 * ground marker respond on the next frame rather than after the server's
 * route arrives. Presentation only; the server remains authoritative.
 */
export class LocalOrders {
  private serial = 0;
  readonly units = new Map<string, LocalOrder>();
  ping: { serial: number; point: Point; order: 'move' | 'attackMove' } | null =
    null;
  issue(ids: string[], order: 'move' | 'attackMove', point: Point) {
    const serial = ++this.serial;
    for (const id of ids)
      this.units.set(id, { serial, point, order, cancelled: false });
    this.ping = { serial, point, order };
    return serial;
  }
  /** A rejected order releases only the troops still waiting on it. */
  cancel(ids: string[], serial: number) {
    for (const id of ids) {
      const local = this.units.get(id);
      if (local?.serial === serial) local.cancelled = true;
    }
  }
}
