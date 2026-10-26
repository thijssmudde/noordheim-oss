import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import {
  aimYawFor,
  animateRig,
  collectRig,
  gaitAdvance,
  recoilOffset,
  slew,
  type RigState,
} from '../lib/unit-rig';

const node = (name: string, parent: THREE.Object3D, y = 0, z = 0) => {
  const n = new THREE.Object3D();
  n.name = name;
  n.position.set(0, y, z);
  parent.add(n);
  return n;
};
function soldier() {
  const root = new THREE.Group();
  node('leg_left', root, 1);
  node('leg_right', root, 1);
  const torso = node('torso', root, 1);
  node('arm_left', torso, 0.6);
  node('arm_right', torso, 0.6);
  return root;
}
function tank() {
  const root = new THREE.Group();
  root.userData.wheelRadius = 0.5;
  node('wheel_front', root, 0.5, 2);
  node('wheel_rear', root, 0.5, -2);
  node('track_left', root, 0.4);
  const turret = node('turret', root, 1.6);
  const barrel = node('barrel', turret, 0.2, 0.8);
  barrel.rotation.x = -0.3; // pitched up
  node('muzzle', barrel, 0, 3);
  return root;
}
function gunship() {
  const root = new THREE.Group();
  node('rotor_pivot', root, 2);
  const mount = node('tail_rotor_mount', root, 1.5, -5);
  node('rotor_pivot_tail', mount);
  return root;
}
const idle = (patch: Partial<RigState> = {}): RigState => ({
  time: 0,
  dt: 1 / 60,
  speed: 0,
  turnRate: 0,
  aimYaw: null,
  firedAt: Infinity,
  cargo: 0,
  moving: false,
  ...patch,
});
function play(
  rig: ReturnType<typeof collectRig>,
  seconds: number,
  patch: Partial<RigState> | ((t: number) => Partial<RigState>),
) {
  for (let t = 0; t < seconds; t += 1 / 60)
    animateRig(
      rig,
      idle({ time: t, ...(typeof patch === 'function' ? patch(t) : patch) }),
    );
}

describe('Rig maths', () => {
  test('slew takes the short way and never overshoots', () => {
    expect(slew(0, 1, 2, 0.1)).toBeCloseTo(0.2);
    expect(slew(0.95, 1, 2, 0.1)).toBe(1);
    expect(slew(3, -3, 1, 0.1)).toBeCloseTo(3.1);
  });
  test('recoil kicks within a few frames and settles back', () => {
    expect(recoilOffset(0, 0.3)).toBe(0);
    expect(recoilOffset(0.04, 0.3)).toBeCloseTo(0.3);
    expect(recoilOffset(0.3, 0.3)).toBeLessThan(0.05);
    expect(recoilOffset(1, 0.3)).toBe(0);
    expect(recoilOffset(Infinity, 0.3)).toBe(0);
  });
  test('gait cadence follows distance; a run takes longer strides', () => {
    expect(gaitAdvance(0, 1)).toBe(0);
    expect(gaitAdvance(3, 1) * 2).toBeCloseTo(gaitAdvance(6, 1) * (2.6 / 1.9));
  });
  test('aim bearing is relative to the hull', () => {
    expect(aimYawFor(0, 0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
    expect(aimYawFor(0, 0, Math.PI / 2, 10, 0)).toBeCloseTo(0);
    expect(aimYawFor(0, 0, Math.PI, 0, 10)).toBeCloseTo(-Math.PI);
  });
});

describe('Infantry gait', () => {
  test('legs alternate and arms counter-swing while walking, then settle', () => {
    const rig = collectRig(soldier());
    expect(rig.kind).toBe('infantry');
    let spread = 0,
      opposed = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      animateRig(rig, idle({ time: t, speed: 6, moving: true }));
      const left = rig.legLeft!.node.rotation.x,
        right = rig.legRight!.node.rotation.x;
      spread = Math.max(spread, Math.abs(left - right));
      if (left * rig.armLeft!.node.rotation.x < 0) opposed++;
    }
    expect(spread).toBeGreaterThan(1);
    expect(opposed).toBeGreaterThan(60);
    play(rig, 2, { speed: 0 });
    expect(Math.abs(rig.legLeft!.node.rotation.x)).toBeLessThan(0.05);
  });
  test('idle soldiers breathe; aiming raises the rifle and twists the torso', () => {
    const rig = collectRig(soldier());
    const heights = new Set<number>();
    for (let t = 0; t < 2; t += 0.1) {
      animateRig(rig, idle({ time: t }));
      heights.add(Math.round(rig.torso!.node.position.y * 1e4));
    }
    expect(heights.size).toBeGreaterThan(3);
    play(rig, 1, { aimYaw: 0.6, firedAt: 0.1 });
    expect(rig.armRight!.node.rotation.x).toBeLessThan(-1);
    expect(rig.torso!.node.rotation.y).toBeCloseTo(0.6, 1);
  });
});

describe('Vehicle rig', () => {
  test('wheels spin by distance travelled', () => {
    const rig = collectRig(tank());
    expect(rig.kind).toBe('vehicle');
    expect(rig.wheelRadius).toBe(0.5);
    play(rig, 1, { speed: 5, moving: true });
    // Five metres on a half-metre wheel: ten radians.
    expect(rig.wheels[0].node.rotation.x).toBeCloseTo(10, 0);
    expect(rig.trackTravel).toBeCloseTo(5, 0);
  });
  test('the hull squats under acceleration and rolls into a turn', () => {
    const rig = collectRig(tank());
    play(rig, 0.3, (t) => ({ speed: t * 8, moving: true }));
    expect(rig.body.node.rotation.x).toBeLessThan(-0.02);
    play(rig, 1, { speed: 5, turnRate: 1, moving: true });
    expect(rig.body.node.rotation.z).toBeLessThan(-0.02);
  });
  test('the turret slews to the target at its rate, then returns forward', () => {
    const rig = collectRig(tank());
    animateRig(rig, idle({ aimYaw: 2 }));
    expect(rig.turret!.node.rotation.y).toBeCloseTo(rig.turretSlew / 60);
    play(rig, 2, { aimYaw: 2 });
    expect(rig.turret!.node.rotation.y).toBeCloseTo(2);
    play(rig, 2, { aimYaw: null });
    expect(rig.turret!.node.rotation.y).toBeCloseTo(0);
  });
  test('the barrel kicks back along its own pitched axis and eases home', () => {
    const rig = collectRig(tank());
    const barrel = rig.barrel!.node,
      home = barrel.position.clone();
    animateRig(rig, idle({ firedAt: 0 }));
    animateRig(rig, idle({ firedAt: 0.04, dt: 0.04 }));
    const offset = barrel.position.clone().sub(home);
    expect(offset.length()).toBeCloseTo(rig.recoilKick, 2);
    // Pitched up by 0.3 rad: recoil runs back and down.
    expect(offset.z).toBeLessThan(0);
    expect(offset.y).toBeLessThan(0);
    play(rig, 1, (t) => ({ firedAt: 0.04 + t }));
    expect(barrel.position.distanceTo(home)).toBeLessThan(1e-3);
  });
  test('continuous server fire kicks only once per weapon interval', () => {
    const rig = collectRig(tank());
    rig.shotInterval = 1;
    let kicks = 0,
      last = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      // The server re-stamps firedAt every 250 ms tick.
      animateRig(rig, idle({ time: t, firedAt: t % 0.25 }));
      const d = rig.barrel!.node.position.z - rig.barrel!.pz;
      if (d < -0.1 && last >= -0.1) kicks++;
      last = d;
    }
    expect(kicks).toBe(2);
  });
  test('cargo fills from the bin floor', () => {
    const root = tank();
    node('cargo_fill', root, 1.5);
    const rig = collectRig(root);
    animateRig(rig, idle({ cargo: 0 }));
    expect(rig.cargo!.node.visible).toBe(false);
    play(rig, 1, { cargo: 0.5 });
    expect(rig.cargo!.node.visible).toBe(true);
    expect(rig.cargo!.node.scale.y).toBeCloseTo(0.5, 2);
    expect(rig.cargo!.node.position.y).toBe(1.5);
  });
});

describe('Air rig', () => {
  test('rotors spin, the gunship banks into turns and dips its nose to accelerate', () => {
    const rig = collectRig(gunship());
    expect(rig.kind).toBe('air');
    expect(rig.rotors).toHaveLength(2);
    play(rig, 0.5, (t) => ({ speed: t * 16, moving: true }));
    expect(rig.body.node.rotation.x).toBeGreaterThan(0.05);
    play(rig, 2, { speed: 10, turnRate: 0.8, moving: true });
    expect(rig.body.node.rotation.z).toBeLessThan(-0.2);
    expect(rig.rotors[0].node.rotation.y).not.toBe(0);
  });
  test('animation allocates nothing per frame', () => {
    const rig = collectRig(tank());
    const state = idle({ speed: 4, moving: true, aimYaw: 1, firedAt: 0.1 });
    const before = rig.recoilDirection;
    for (let i = 0; i < 100; i++) animateRig(rig, state);
    expect(rig.recoilDirection).toBe(before);
  });
});
