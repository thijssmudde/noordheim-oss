import * as THREE from 'three';

/**
 * Per-frame troop animation for the diorama models (art/blender/diorama_troops.py).
 *
 * `collectRig(model)` finds the named pivots once and records their rest
 * transforms; `animateRig(rig, state)` poses them every frame relative to
 * rest. The rig also owns the model root's pitch, roll and bob (suspension,
 * banking, breathing), so pass the model object that sits *inside* the group
 * the renderer positions and yaws. No allocations per frame.
 *
 * Node contract (models face +Z, origins at pivots): `torso`, `leg_left`,
 * `leg_right`, `arm_left`, `arm_right` (infantry); `turret` (yaw), `barrel`
 * (recoils along its own -Z), `muzzle`; `wheel_*` (spin about X);
 * `track_left`, `track_right`; `rotor_pivot*` and `tail_rotor_mount` >
 * `rotor_pivot_tail` (spin about their own Y); `cargo_fill` (scale Y).
 */
export type RigState = {
  /** Shared animation clock, seconds. */
  time: number;
  /** Frame duration, seconds. */
  dt: number;
  /** Actual presented ground speed, m/s (UnitMotion pose.speed). */
  speed: number;
  /** Presented hull yaw rate, rad/s; positive turns toward +X (UnitMotion pose.turnRate). */
  turnRate: number;
  /** Weapon bearing relative to the hull, radians, or null to face forward. */
  aimYaw: number | null;
  /** Seconds since the last shot (Infinity if it never fired). */
  firedAt: number;
  /** Harvester load, 0..1. */
  cargo: number;
  moving: boolean;
  /** Construction progress 0..1; below 1 the model holds its rest pose. */
  construction?: number;
};
export type RigClass = 'infantry' | 'vehicle' | 'air';
type Rest = {
  node: THREE.Object3D;
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  sy: number;
};
export type UnitRig = {
  kind: RigClass;
  body: Rest;
  torso: Rest | null;
  legLeft: Rest | null;
  legRight: Rest | null;
  armLeft: Rest | null;
  armRight: Rest | null;
  turret: Rest | null;
  barrel: Rest | null;
  /** Unit vector along the barrel's own -Z in its parent's space. */
  recoilDirection: THREE.Vector3;
  muzzle: THREE.Object3D | null;
  wheels: Rest[];
  tracks: Rest[];
  rotors: Rest[];
  cargo: Rest | null;
  /** From the GLB root extras (`wheelRadius`), metres. */
  wheelRadius: number;
  /** Tuning, adjustable per kind by the caller after collectRig. */
  turretSlew: number;
  recoilKick: number;
  /** Seconds between visible kicks; the server re-stamps firedAt every tick while firing. */
  shotInterval: number;
  seed: number;
  // Live state.
  phase: number;
  stride: number;
  aim: number;
  turretYaw: number;
  wheelAngle: number;
  /** Metres rolled, for track texture scrolling. */
  trackTravel: number;
  rotorAngle: number;
  lastSpeed: number;
  pitch: number;
  roll: number;
  lastRecency: number;
  kickAge: number;
  cargoLevel: number;
};

const rest = (node: THREE.Object3D): Rest => ({
  node,
  px: node.position.x,
  py: node.position.y,
  pz: node.position.z,
  rx: node.rotation.x,
  ry: node.rotation.y,
  rz: node.rotation.z,
  sy: node.scale.y,
});
function reset(r: Rest) {
  r.node.position.set(r.px, r.py, r.pz);
  r.node.rotation.set(r.rx, r.ry, r.rz);
}
function findExtra(root: THREE.Object3D, key: string): number | undefined {
  let value: number | undefined;
  root.traverse((n) => {
    const v = (n.userData as Record<string, unknown>)[key];
    if (value === undefined && typeof v === 'number') value = v;
  });
  return value;
}

/** Find the rig's pivots once, when a model is cloned. */
export function collectRig(root: THREE.Object3D, seed = 0): UnitRig {
  const named = (name: string) => {
    const node = root.getObjectByName(name);
    return node ? rest(node) : null;
  };
  const wheels: Rest[] = [],
    tracks: Rest[] = [],
    rotors: Rest[] = [];
  root.traverse((n) => {
    if (n.name.startsWith('wheel_')) wheels.push(rest(n));
    else if (n.name === 'track_left' || n.name === 'track_right')
      tracks.push(rest(n));
    else if (n.name.startsWith('rotor_pivot')) rotors.push(rest(n));
  });
  const barrel = named('barrel');
  const recoilDirection = new THREE.Vector3(0, 0, -1);
  if (barrel) recoilDirection.applyQuaternion(barrel.node.quaternion);
  const legLeft = named('leg_left'),
    legRight = named('leg_right');
  const kind: RigClass =
    legLeft || legRight ? 'infantry' : rotors.length ? 'air' : 'vehicle';
  return {
    kind,
    body: rest(root),
    torso: named('torso'),
    legLeft,
    legRight,
    armLeft: named('arm_left'),
    armRight: named('arm_right'),
    turret: named('turret'),
    barrel,
    recoilDirection,
    muzzle: root.getObjectByName('muzzle') ?? null,
    wheels,
    tracks,
    rotors,
    cargo: named('cargo_fill'),
    wheelRadius: findExtra(root, 'wheelRadius') ?? 0.45,
    turretSlew: 2.2,
    recoilKick: kind === 'infantry' ? 0.06 : 0.3,
    shotInterval: 0,
    seed,
    phase: (seed % 628) / 100,
    stride: 0,
    aim: 0,
    turretYaw: 0,
    wheelAngle: 0,
    trackTravel: 0,
    rotorAngle: (seed % 314) / 100,
    lastSpeed: 0,
    pitch: 0,
    roll: 0,
    lastRecency: Infinity,
    kickAge: Infinity,
    cargoLevel: -1,
  };
}

// ---------------------------------------------------------------- pure parts
const TAU = Math.PI * 2;
export const wrap = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
/** Frame-rate-independent exponential approach. */
export const ease = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));
/** Turn `angle` toward `target` by at most `rate * dt`, the short way round. */
export function slew(angle: number, target: number, rate: number, dt: number) {
  const error = wrap(target - angle),
    step = rate * dt;
  return Math.abs(error) <= step ? target : angle + Math.sign(error) * step;
}
/** Gait cycle advance: one full cycle per two steps, longer strides when running. */
export function gaitAdvance(speed: number, dt: number) {
  const strideLength = speed > 4.5 ? 2.6 : 1.9;
  return (speed * dt * TAU) / strideLength;
}
/** Barrel offset `age` seconds after a shot: sharp kick, eased return. */
export function recoilOffset(age: number, kick: number) {
  if (!(age >= 0) || age > 0.8) return 0;
  if (age < 0.04) return (kick * age) / 0.04;
  return kick * Math.exp(-(age - 0.04) * 8);
}
/** Weapon bearing relative to the hull, for `RigState.aimYaw`. */
export function aimYawFor(
  x: number,
  z: number,
  hullAngle: number,
  targetX: number,
  targetZ: number,
) {
  return wrap(Math.atan2(targetX - x, targetZ - z) - hullAngle);
}

// ---------------------------------------------------------------- animation
/** Pose every rig node for this frame. */
export function animateRig(rig: UnitRig, state: RigState) {
  const dt = clamp(state.dt, 0, 0.1);
  if (state.construction !== undefined && state.construction < 1) return;
  // A new shot resets the recency; start the kick.
  rig.kickAge += dt;
  if (
    state.firedAt < rig.lastRecency - 1e-3 &&
    state.firedAt < 0.3 &&
    rig.kickAge >= rig.shotInterval
  )
    rig.kickAge = state.firedAt;
  rig.lastRecency = state.firedAt;
  const accel = dt > 0 ? (state.speed - rig.lastSpeed) / dt : 0;
  rig.lastSpeed = state.speed;
  if (rig.kind === 'infantry') animateInfantry(rig, state, dt);
  else if (rig.kind === 'air') animateAir(rig, state, dt, accel);
  else animateVehicle(rig, state, dt, accel);
  animateWeapon(rig, state, dt);
  if (rig.cargo) {
    const load = clamp(state.cargo, 0, 1);
    rig.cargoLevel =
      rig.cargoLevel < 0 ? load : ease(rig.cargoLevel, load, 12, dt);
    rig.cargo.node.visible = rig.cargoLevel > 0.003;
    rig.cargo.node.scale.y = rig.cargo.sy * Math.max(0.001, rig.cargoLevel);
  }
}

function animateInfantry(rig: UnitRig, s: RigState, dt: number) {
  const walking = s.moving && s.speed > 0.15;
  rig.stride = ease(rig.stride, walking ? 1 : 0, 10, dt);
  rig.phase = (rig.phase + gaitAdvance(s.speed, dt)) % (TAU * 64);
  const running = clamp((s.speed - 3.5) / 3, 0, 1);
  const swing = (0.5 + 0.3 * running) * rig.stride;
  const legs = Math.sin(rig.phase) * swing;
  const aiming = s.aimYaw !== null || s.firedAt < 1.2;
  rig.aim = ease(rig.aim, aiming ? 1 : 0, 9, dt);
  if (rig.legLeft) rig.legLeft.node.rotation.x = rig.legLeft.rx + legs;
  if (rig.legRight) rig.legRight.node.rotation.x = rig.legRight.rx - legs;
  // Arms counter-swing the legs, and come up to the shoulder to shoot.
  const armSwing = legs * 0.8 * (1 - rig.aim);
  const breath = Math.sin(s.time * 1.7 + rig.seed) * (1 - rig.stride);
  if (rig.armLeft)
    rig.armLeft.node.rotation.x =
      rig.armLeft.rx - armSwing - 1.05 * rig.aim + breath * 0.03;
  if (rig.armRight)
    rig.armRight.node.rotation.x =
      rig.armRight.rx + armSwing - 1.25 * rig.aim + breath * 0.03;
  const bob =
    Math.abs(Math.sin(rig.phase)) * (0.05 + 0.04 * running) * rig.stride;
  const kick = recoilOffset(rig.kickAge, 1) * rig.aim;
  if (rig.torso) {
    const t = rig.torso;
    t.node.position.y = t.py + bob * 0.5 + breath * 0.012;
    // Lean into a run, twist toward the target, rock back on each shot.
    t.node.rotation.x = t.rx + 0.12 * running * rig.stride - 0.06 * kick;
    t.node.rotation.y =
      t.ry + clamp(s.aimYaw ?? 0, -1.1, 1.1) * rig.aim + legs * 0.12;
    rig.body.node.position.y = rig.body.py + bob * 0.5;
  } else rig.body.node.position.y = rig.body.py + bob + breath * 0.01;
  // Lean into sharp turns a little, like a soldier cutting a corner.
  rig.roll = ease(
    rig.roll,
    clamp(-s.turnRate * s.speed * 0.012, -0.12, 0.12),
    8,
    dt,
  );
  rig.body.node.rotation.z = rig.body.rz + rig.roll;
}

function animateVehicle(rig: UnitRig, s: RigState, dt: number, accel: number) {
  const travel = s.speed * dt;
  rig.wheelAngle = (rig.wheelAngle + travel / rig.wheelRadius) % (TAU * 1024);
  rig.trackTravel += travel;
  for (const w of rig.wheels) w.node.rotation.x = w.rx + rig.wheelAngle;
  const rumble = s.moving ? Math.min(1, s.speed / 3 + Math.abs(s.turnRate)) : 0;
  for (let i = 0; i < rig.tracks.length; i++) {
    const t = rig.tracks[i];
    t.node.position.y =
      t.py + Math.sin(rig.trackTravel * 5 + i * 1.7) * 0.015 * rumble;
  }
  // Suspension: squat back under acceleration, dive under braking, roll into turns.
  rig.pitch = ease(rig.pitch, clamp(-accel * 0.012, -0.07, 0.07), 6, dt);
  rig.roll = ease(
    rig.roll,
    clamp(-s.turnRate * s.speed * 0.01, -0.06, 0.06),
    6,
    dt,
  );
  const b = rig.body;
  b.node.rotation.x = b.rx + rig.pitch;
  b.node.rotation.z = b.rz + rig.roll;
  b.node.position.y = b.py + Math.sin(s.time * 31 + rig.seed) * 0.012 * rumble;
}

function animateAir(rig: UnitRig, s: RigState, dt: number, accel: number) {
  const rotorSpeed = rig.rotors.length > 2 ? 60 : 34;
  rig.rotorAngle = (rig.rotorAngle + rotorSpeed * dt) % (TAU * 1024);
  for (let i = 0; i < rig.rotors.length; i++) {
    const r = rig.rotors[i];
    // Quad rotors counter-rotate in diagonal pairs.
    const direction = rig.rotors.length > 2 && i % 2 ? -1 : 1;
    r.node.rotation.y = r.ry + rig.rotorAngle * direction;
  }
  const drone = rig.rotors.length > 2;
  // Nose down to accelerate and to hold forward flight; bank into turns.
  const pitchGoal = clamp(
    accel * 0.03 + s.speed * 0.012,
    -0.12,
    drone ? 0.2 : 0.28,
  );
  const rollGoal = clamp(
    -s.turnRate * Math.max(s.speed, 2) * 0.035,
    -0.45,
    0.45,
  );
  rig.pitch = ease(rig.pitch, pitchGoal, 3, dt);
  rig.roll = ease(rig.roll, rollGoal, 3, dt);
  const b = rig.body;
  b.node.rotation.x = b.rx + rig.pitch;
  b.node.rotation.z = b.rz + rig.roll;
  const bob = drone ? 0.14 : 0.08;
  b.node.position.y = b.py + Math.sin(s.time * 2.1 + rig.seed) * bob;
}

function animateWeapon(rig: UnitRig, s: RigState, dt: number) {
  if (rig.turret) {
    rig.turretYaw = slew(rig.turretYaw, s.aimYaw ?? 0, rig.turretSlew, dt);
    rig.turret.node.rotation.y = rig.turret.ry + rig.turretYaw;
  }
  if (rig.barrel) {
    const kick = recoilOffset(rig.kickAge, rig.recoilKick);
    const b = rig.barrel,
      d = rig.recoilDirection;
    b.node.position.set(
      b.px + d.x * kick,
      b.py + d.y * kick,
      b.pz + d.z * kick,
    );
  }
}

/** Return every rig node to its authored pose (e.g. before a portrait capture). */
export function resetRig(rig: UnitRig) {
  for (const r of [
    rig.body,
    rig.torso,
    rig.legLeft,
    rig.legRight,
    rig.armLeft,
    rig.armRight,
    rig.turret,
    rig.barrel,
    ...rig.wheels,
    ...rig.tracks,
    ...rig.rotors,
  ])
    if (r) reset(r);
  rig.turretYaw = 0;
}
