import type { SectorBounds } from './tactical-terrain';
import { SECTOR, type Point } from './tactics';

/** Orbiting RTS camera with screen-relative scrolling and bounded ground focus. */
export const CAMERA = {
  minDistance: 30,
  maxDistance: 190,
  /** Pitch below the horizon (radians) at the closest and furthest zoom. */
  nearPitch: 0.84,
  farPitch: 1.1,
  /** How far past the sector edge the look-at point may travel. */
  margin: 12,
  /** Ground units per second at maxDistance; scales down with zoom. */
  keySpeed: 150,
  edgeSpeed: 120,
  /** Width of the screen-edge scroll zone in CSS pixels. */
  edgeZone: 18,
  /** Pointer travel before a right/touch drag counts as a pan, not a click. */
  dragThreshold: 6,
  minPitch: 0.48,
  maxPitch: 1.38,
  rotateSpeed: 1.2,
};

export type CameraPose = {
  x: number;
  z: number;
  distance: number;
  yaw?: number;
  tilt?: number;
};
export type CameraFocus = Point & {
  serial: number;
  north?: boolean;
  distance?: number;
};
/** Space pressed and released within this time, without a drag, is a tap (jump to alert). */
export const SPACE_TAP_MS = 350;
export const isSpaceTap = (heldMs: number, dragged: boolean) =>
  !dragged && heldMs < SPACE_TAP_MS;
export const ORBIT_KEYS: ReadonlySet<string> = new Set(['[', ']', '\\']);
/** Shared by camera and command input so orbit drags never become orders. */
export function isOrbitGesture(
  e: Pick<
    PointerEvent,
    'pointerType' | 'button' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
  >,
) {
  if (e.pointerType === 'touch') return false;
  // macOS can report Control-left-click as the secondary button.
  return (
    ((e.ctrlKey || e.metaKey) && (e.button === 0 || e.button === 2)) ||
    (e.altKey && e.button === 0) ||
    (e.shiftKey && e.button === 1)
  );
}
/** Signed shortest turn, including across the north seam. */
export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));
/** Convert screen-right / screen-down velocity into world ground coordinates. */
export function screenToGround(p: Point, yaw = 0): Point {
  return {
    x: p.x * Math.cos(yaw) + p.z * Math.sin(yaw),
    z: -p.x * Math.sin(yaw) + p.z * Math.cos(yaw),
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function clampPose(
  pose: CameraPose,
  bounds: SectorBounds = SECTOR,
): CameraPose {
  const m = CAMERA.margin;
  return {
    ...pose,
    ...(pose.tilt === undefined
      ? {}
      : {
          tilt: clamp(
            pose.tilt,
            CAMERA.minPitch - pitchFor(pose.distance),
            CAMERA.maxPitch - pitchFor(pose.distance),
          ),
        }),
    x: clamp(pose.x, bounds.minX - m, bounds.maxX + m),
    z: clamp(pose.z, bounds.minZ - m, bounds.maxZ + m),
    distance: clamp(pose.distance, CAMERA.minDistance, CAMERA.maxDistance),
  };
}

/** Pitch below the horizon for a zoom distance: steep when far, flatter when close. */
export function pitchFor(distance: number) {
  const t = clamp(
    (distance - CAMERA.minDistance) / (CAMERA.maxDistance - CAMERA.minDistance),
    0,
    1,
  );
  return CAMERA.nearPitch + (CAMERA.farPitch - CAMERA.nearPitch) * t;
}

/** Orbit around the ground focus, keeping a useful downward viewing angle. */
export function cameraOffset(distance: number, yaw = 0, tilt = 0) {
  const pitch = clamp(
    pitchFor(distance) + tilt,
    CAMERA.minPitch,
    CAMERA.maxPitch,
  );
  const radius = distance * Math.cos(pitch);
  return {
    x: radius * Math.sin(yaw),
    y: distance * Math.sin(pitch),
    z: radius * Math.cos(yaw),
  };
}

/** Multiplicative zoom for a wheel delta; positive delta zooms out. */
export function zoomBy(distance: number, delta: number) {
  return clamp(
    distance * Math.exp(delta * 0.0016),
    CAMERA.minDistance,
    CAMERA.maxDistance,
  );
}

/** Keys that scroll the camera: the arrow keys and WASD. */
export const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'a',
  'd',
  'w',
  's',
]);

/** Ground velocity for held scroll keys (arrows or WASD), in ground units per second. */
export function keyVelocity(
  keys: Iterable<string>,
  distance: number,
  yaw = 0,
): Point {
  let x = 0,
    z = 0;
  for (const k of keys) {
    if (k === 'arrowleft' || k === 'a') x -= 1;
    else if (k === 'arrowright' || k === 'd') x += 1;
    else if (k === 'arrowup' || k === 'w') z -= 1;
    else if (k === 'arrowdown' || k === 's') z += 1;
  }
  const n = Math.hypot(x, z);
  if (!n) return { x: 0, z: 0 };
  const speed = (CAMERA.keySpeed * distance) / CAMERA.maxDistance;
  return screenToGround({ x: (x / n) * speed, z: (z / n) * speed }, yaw);
}

/**
 * Ground velocity for a mouse resting in the screen-edge scroll zone. Ramps up
 * the closer the pointer is to the edge so a glancing touch only nudges.
 */
export function edgeVelocity(
  pointer: { x: number; y: number },
  size: { width: number; height: number },
  distance: number,
  yaw = 0,
): Point {
  const zone = CAMERA.edgeZone;
  const push = (d: number) => (d < 0 || d >= zone ? 0 : 1 - d / zone);
  const x = push(size.width - 1 - pointer.x) - push(pointer.x),
    z = push(size.height - 1 - pointer.y) - push(pointer.y);
  const speed = (CAMERA.edgeSpeed * distance) / CAMERA.maxDistance;
  return screenToGround({ x: x * speed, z: z * speed }, yaw);
}

/** Exponential approach factor: framerate independent smoothing. */
export const approach = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
