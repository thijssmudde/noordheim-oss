import { describe, expect, test } from 'vitest';
import {
  CAMERA,
  angleDelta,
  ORBIT_KEYS,
  isOrbitGesture,
  isSpaceTap,
  SPACE_TAP_MS,
  SCROLL_KEYS,
  cameraOffset,
  clampPose,
  edgeVelocity,
  keyVelocity,
  pitchFor,
  zoomBy,
} from '../lib/tactical-camera';
import { SECTOR } from '../lib/tactics';

describe('Command camera', () => {
  test('a quick Space tap jumps to the alert; a hold or a Space-drag pans', () => {
    expect(isSpaceTap(120, false)).toBe(true);
    expect(isSpaceTap(120, true)).toBe(false);
    expect(isSpaceTap(SPACE_TAP_MS, false)).toBe(false);
    expect(isSpaceTap(900, false)).toBe(false);
  });
  test('north stays up: the camera is due south of its look-at point', () => {
    for (const d of [CAMERA.minDistance, 100, CAMERA.maxDistance]) {
      const o = cameraOffset(d);
      expect(o.x).toBe(0);
      expect(o.z).toBeGreaterThan(0);
      expect(o.y).toBeGreaterThan(0);
      expect(Math.hypot(o.y, o.z)).toBeCloseTo(d, 6);
    }
  });
  test('the view tips towards the horizon as it zooms in', () => {
    expect(pitchFor(CAMERA.minDistance)).toBeLessThan(
      pitchFor(CAMERA.maxDistance),
    );
    expect(pitchFor(0)).toBe(CAMERA.nearPitch);
    expect(pitchFor(1e9)).toBe(CAMERA.farPitch);
  });
  test('the look-at point cannot leave the sector by more than the margin', () => {
    const p = clampPose({ x: -9999, z: 9999, distance: 5 });
    expect(p).toEqual({
      x: SECTOR.minX - CAMERA.margin,
      z: SECTOR.maxZ + CAMERA.margin,
      distance: CAMERA.minDistance,
    });
    expect(clampPose({ x: 0, z: 0, distance: 1e6 }).distance).toBe(
      CAMERA.maxDistance,
    );
  });
  test('wheel zoom is multiplicative, clamped and reversible', () => {
    const out = zoomBy(100, 200);
    expect(out).toBeGreaterThan(100);
    expect(zoomBy(out, -200)).toBeCloseTo(100, 6);
    expect(zoomBy(100, 1e6)).toBe(CAMERA.maxDistance);
    expect(zoomBy(100, -1e6)).toBe(CAMERA.minDistance);
  });
  test('arrow keys scroll in screen directions and diagonals are not faster', () => {
    const up = keyVelocity(['arrowup'], CAMERA.maxDistance);
    expect(up).toEqual({ x: 0, z: -CAMERA.keySpeed });
    const diagonal = keyVelocity(
      ['arrowright', 'arrowdown'],
      CAMERA.maxDistance,
    );
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(CAMERA.keySpeed, 6);
    expect(diagonal.x).toBeGreaterThan(0);
    expect(diagonal.z).toBeGreaterThan(0);
    expect(keyVelocity(['arrowleft', 'arrowright'], 100)).toEqual({
      x: 0,
      z: 0,
    });
    expect(keyVelocity(['arrowup'], CAMERA.maxDistance / 2).z).toBeCloseTo(
      -CAMERA.keySpeed / 2,
      6,
    );
  });
  test('WASD scrolls exactly like the arrow keys', () => {
    const d = CAMERA.maxDistance;
    expect(keyVelocity(['w'], d)).toEqual(keyVelocity(['arrowup'], d));
    expect(keyVelocity(['s'], d)).toEqual(keyVelocity(['arrowdown'], d));
    expect(keyVelocity(['a'], d)).toEqual(keyVelocity(['arrowleft'], d));
    expect(keyVelocity(['d'], d)).toEqual(keyVelocity(['arrowright'], d));
    expect(keyVelocity(['w', 'arrowup'], d)).toEqual(keyVelocity(['w'], d));
    for (const k of [
      'w',
      'a',
      's',
      'd',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
    ])
      expect(SCROLL_KEYS.has(k)).toBe(true);
    expect(SCROLL_KEYS.has('q')).toBe(false);
  });
  test('edge scrolling only pushes from inside the edge zone', () => {
    const size = { width: 800, height: 600 };
    expect(edgeVelocity({ x: 400, y: 300 }, size, 100)).toEqual({ x: 0, z: 0 });
    const left = edgeVelocity({ x: 0, y: 300 }, size, CAMERA.maxDistance);
    expect(left.x).toBeCloseTo(-CAMERA.edgeSpeed, 6);
    expect(left.z).toBe(0);
    const bottom = edgeVelocity({ x: 400, y: 599 }, size, CAMERA.maxDistance);
    expect(bottom.z).toBeCloseTo(CAMERA.edgeSpeed, 6);
    const glancing = edgeVelocity(
      { x: CAMERA.edgeZone - 1, y: 300 },
      size,
      100,
    );
    expect(Math.abs(glancing.x)).toBeLessThan(Math.abs(left.x));
    expect(edgeVelocity({ x: -5, y: 300 }, size, 100)).toEqual({ x: 0, z: 0 });
  });
});

describe('3D camera rotation', () => {
  test('Ctrl and Command drags belong to the camera, including macOS control-click', () => {
    const pointer = {
      pointerType: 'mouse',
      button: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(isOrbitGesture({ ...pointer, ...modifier })).toBe(true);
      expect(isOrbitGesture({ ...pointer, ...modifier, button: 2 })).toBe(true);
    }
    expect(isOrbitGesture(pointer)).toBe(false);
    expect(isOrbitGesture({ ...pointer, shiftKey: true })).toBe(false);
    expect(isOrbitGesture({ ...pointer, button: 2 })).toBe(false);
    expect(
      isOrbitGesture({ ...pointer, ctrlKey: true, pointerType: 'touch' }),
    ).toBe(false);
    expect(isOrbitGesture({ ...pointer, altKey: true })).toBe(true);
    expect(isOrbitGesture({ ...pointer, button: 1, shiftKey: true })).toBe(
      true,
    );
  });
  test('an orbit preserves distance and points towards the same focus at every heading', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
      const o = cameraOffset(66, yaw);
      expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(66, 6);
      expect(o.x).toBeCloseTo(Math.sin(yaw) * 66 * Math.cos(pitchFor(66)), 6);
      expect(o.z).toBeCloseTo(Math.cos(yaw) * 66 * Math.cos(pitchFor(66)), 6);
    }
  });
  test('keyboard and edge panning remain aligned with the screen after a quarter turn', () => {
    const yaw = Math.PI / 2;
    const right = keyVelocity(['d'], CAMERA.maxDistance, yaw);
    expect(right.x).toBeCloseTo(0);
    expect(right.z).toBeCloseTo(-CAMERA.keySpeed);
    const up = keyVelocity(['w'], CAMERA.maxDistance, yaw);
    expect(up.x).toBeCloseTo(-CAMERA.keySpeed);
    expect(up.z).toBeCloseTo(0);
    const edge = edgeVelocity(
      { x: 799, y: 300 },
      { width: 800, height: 600 },
      CAMERA.maxDistance,
      yaw,
    );
    expect(edge.x).toBeCloseTo(0);
    expect(edge.z).toBeCloseTo(-CAMERA.edgeSpeed);
  });
  test('tilt stops short of the horizon and cannot flip over the focus', () => {
    for (const tilt of [-999, 999]) {
      const o = cameraOffset(66, 1, tilt);
      const pitch = Math.asin(o.y / 66);
      expect(pitch).toBeGreaterThanOrEqual(CAMERA.minPitch - 1e-8);
      expect(pitch).toBeLessThanOrEqual(CAMERA.maxPitch + 1e-8);
    }
  });
  test('rotation smoothing takes the short path across north', () => {
    expect(angleDelta(Math.PI * 2 - 0.1, 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(ORBIT_KEYS.has('q')).toBe(false);
  });
});
