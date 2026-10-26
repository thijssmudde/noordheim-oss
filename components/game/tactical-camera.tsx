import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  CAMERA,
  SCROLL_KEYS,
  ORBIT_KEYS,
  isOrbitGesture,
  angleDelta,
  type CameraFocus,
  approach,
  cameraOffset,
  clampPose as clampCameraPose,
  edgeVelocity,
  isSpaceTap,
  keyVelocity,
  zoomBy,
  type CameraPose,
} from '@/lib/tactical-camera';
import { useTerrain } from './terrain-context';
import type { Point } from '@/lib/tactics';

/** Height of the flat plane pointer rays are resolved against. */
export const GROUND_Y = 0.65;
export const HOME_DISTANCE = 66;
export const HOME_YAW = -Math.PI / 5;

/** Where the camera should rest to look at a ground point from a zoom distance. */
export function cameraPosition(
  target: Point,
  distance: number,
  yaw = 0,
  tilt = 0,
) {
  const o = cameraOffset(distance, yaw, tilt);
  return new THREE.Vector3(target.x + o.x, GROUND_Y + o.y, target.z + o.z);
}

function applyPose(camera: THREE.Camera, pose: CameraPose) {
  camera.position.copy(
    cameraPosition(pose, pose.distance, pose.yaw, pose.tilt),
  );
  camera.lookAt(pose.x, GROUND_Y, pose.z);
  camera.updateMatrixWorld();
}

const EDITABLE =
  'input, textarea, select, [contenteditable], [data-slot=dialog-content]';

type Drag = {
  id: number;
  grab: Point;
  startX: number;
  startY: number;
  active: boolean;
  immediate: boolean;
};

/**
 * Orbiting command camera. Ctrl/Command/Alt-drag rotates and tilts; brackets rotate; backslash resets north. Pans by grabbing the ground (middle drag,
 * right drag, space + left drag, one-finger touch), zooms towards the pointer
 * (wheel, trackpad pinch, two-finger pinch), scrolls with the arrow keys, WASD and
 * the screen edges, and glides to minimap and Home jumps. A tap of Space without
 * a drag calls `onSpaceTap` (jump to the latest alert); holding it still grabs.
 */
export function CameraRig({
  focus,
  home,
  placement,
  onViewport,
  onSpaceTap,
}: {
  focus: CameraFocus;
  home: Point;
  placement: boolean;
  onViewport?: (corners: Point[]) => void;
  onSpaceTap?: () => void;
}) {
  const { gl, camera } = useThree();
  const { bounds } = useTerrain();
  const clampPose = useCallback(
    (pose: CameraPose) => clampCameraPose(pose, bounds),
    [bounds],
  );
  const live = useRef({ placement, onViewport, onSpaceTap });
  useEffect(() => {
    live.current = { placement, onViewport, onSpaceTap };
  }, [placement, onViewport, onSpaceTap]);
  const s = useRef({
    pose: {
      x: home.x,
      z: home.z - 8,
      distance: HOME_DISTANCE,
      yaw: HOME_YAW,
      tilt: 0,
    } as CameraPose,
    goal: {
      x: home.x,
      z: home.z - 8,
      distance: HOME_DISTANCE,
      yaw: HOME_YAW,
      tilt: 0,
    } as CameraPose,
    keys: new Set<string>(),
    space: false,
    /** When Space went down, and whether a pan or orbit began while it was held. */
    spaceAt: 0,
    spaceUsed: false,
    mouse: null as { x: number; y: number } | null,
    buttons: 0,
    drag: null as Drag | null,
    orbit: null as {
      id: number;
      x: number;
      y: number;
      yaw: number;
      tilt: number;
    } | null,
    touches: new Map<number, { x: number; y: number }>(),
    pinch: null as { distance: number; angle: number; grab: Point } | null,
    anchor: null as { sx: number; sy: number; ground: Point } | null,
    serial: focus.serial,
    reported: [] as Point[],
  });
  useEffect(() => {
    const canvas = gl.domElement,
      st = s.current;
    const apply = () => applyPose(camera, st.pose);
    const ray = new THREE.Raycaster(),
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y),
      hit = new THREE.Vector3();
    const ground = (cx: number, cy: number): Point | null => {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((cx - r.left) / r.width) * 2 - 1,
          (-(cy - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
    };
    const snap = (p: Partial<CameraPose>) => {
      st.goal = clampPose({ ...st.goal, ...p });
      st.pose = { ...st.goal };
      apply();
    };
    // Shift the view so the grabbed ground point sits under the pointer again.
    const dragTo = (grab: Point, cx: number, cy: number) => {
      const now = ground(cx, cy);
      if (now)
        snap({ x: st.goal.x + grab.x - now.x, z: st.goal.z + grab.z - now.z });
    };
    const setGrab = () => {
      const grabbing = st.drag?.active || st.pinch || st.orbit;
      if (grabbing) canvas.dataset.grab = 'active';
      else if (st.space) canvas.dataset.grab = '';
      else delete canvas.dataset.grab;
    };
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      st.buttons = e.buttons;
      if (st.space) st.spaceUsed = true;
      if (isOrbitGesture(e)) {
        st.anchor = null;
        st.drag = null;
        st.orbit = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          yaw: st.pose.yaw ?? 0,
          tilt: st.pose.tilt ?? 0,
        };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        setGrab();
        return;
      }
      if (e.pointerType === 'touch') {
        st.mouse = null;
        st.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (st.touches.size === 2) {
          st.drag = null;
          const [a, b] = [...st.touches.values()];
          const mid = ground((a.x + b.x) / 2, (a.y + b.y) / 2);
          st.pinch = mid
            ? {
                distance: Math.hypot(a.x - b.x, a.y - b.y),
                angle: Math.atan2(b.y - a.y, b.x - a.x),
                grab: mid,
              }
            : null;
        } else if (st.touches.size === 1 && !live.current.placement) {
          const grab = ground(e.clientX, e.clientY);
          if (grab)
            st.drag = {
              id: e.pointerId,
              grab,
              startX: e.clientX,
              startY: e.clientY,
              active: false,
              immediate: false,
            };
        }
        setGrab();
        return;
      }
      const pan =
        e.button === 1 || e.button === 2 || (e.button === 0 && st.space);
      if (!pan || st.drag) return;
      const grab = ground(e.clientX, e.clientY);
      if (!grab) return;
      st.drag = {
        id: e.pointerId,
        grab,
        startX: e.clientX,
        startY: e.clientY,
        active: e.button !== 2,
        immediate: e.button !== 2,
      };
      if (st.drag.active) {
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
      setGrab();
    };
    const move = (e: PointerEvent) => {
      st.buttons = e.buttons;
      if (st.orbit?.id === e.pointerId) {
        snap({
          yaw: st.orbit.yaw - (e.clientX - st.orbit.x) * 0.006,
          tilt: st.orbit.tilt + (e.clientY - st.orbit.y) * 0.004,
        });
        return;
      }
      if (e.pointerType === 'touch') {
        st.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (st.pinch && st.touches.size === 2) {
          const [a, b] = [...st.touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > 0 && st.pinch.distance > 0)
            snap({
              distance: st.goal.distance * (st.pinch.distance / d),
              yaw:
                (st.goal.yaw ?? 0) +
                angleDelta(st.pinch.angle, Math.atan2(b.y - a.y, b.x - a.x)),
            });
          st.pinch.angle = Math.atan2(b.y - a.y, b.x - a.x);
          st.pinch.distance = d;
          dragTo(st.pinch.grab, (a.x + b.x) / 2, (a.y + b.y) / 2);
          return;
        }
      } else st.mouse = local(e);
      const drag = st.drag;
      if (!drag || drag.id !== e.pointerId) return;
      if (
        !drag.active &&
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >
          CAMERA.dragThreshold
      ) {
        drag.active = true;
        if (e.pointerType !== 'touch') canvas.setPointerCapture(e.pointerId);
        setGrab();
      }
      if (drag.active) dragTo(drag.grab, e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      st.buttons = e.buttons;
      st.touches.delete(e.pointerId);
      if (st.orbit?.id === e.pointerId) {
        if (canvas.hasPointerCapture(e.pointerId))
          canvas.releasePointerCapture(e.pointerId);
        st.orbit = null;
      }
      if (st.touches.size < 2) st.pinch = null;
      if (st.drag?.id === e.pointerId) {
        if (canvas.hasPointerCapture(e.pointerId) && st.drag.immediate)
          canvas.releasePointerCapture(e.pointerId);
        st.drag = null;
      }
      setGrab();
    };
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') st.mouse = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const delta = e.deltaY * scale * (e.ctrlKey || e.metaKey ? 8 : 1);
      const settled = Math.abs(st.goal.distance - st.pose.distance) < 0.05;
      if (!st.anchor || settled) {
        const g = ground(e.clientX, e.clientY);
        st.anchor = g ? { sx: e.clientX, sy: e.clientY, ground: g } : null;
      }
      st.goal.distance = zoomBy(st.goal.distance, delta);
    };
    const keydown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== ' ' && !SCROLL_KEYS.has(k) && !ORBIT_KEYS.has(k)) return;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement && e.target.closest(EDITABLE)) ||
        document.querySelector('[data-slot=dialog-content]')
      )
        return;
      if (k === '\\') {
        e.preventDefault();
        st.anchor = null;
        st.goal.yaw = (st.pose.yaw ?? 0) + angleDelta(st.pose.yaw ?? 0, 0);
        st.goal.tilt = 0;
      } else if (k === ' ') {
        if (!(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          if (!st.space) {
            // Event timestamps, not handler time, so a hitching frame can't turn a tap into a hold.
            st.spaceAt = e.timeStamp;
            st.spaceUsed = false;
          }
          st.space = true;
          setGrab();
        }
      } else {
        e.preventDefault();
        st.keys.add(k);
        if (!e.repeat && (k === '[' || k === ']')) {
          st.goal.yaw =
            (st.goal.yaw ?? 0) + ((k === ']' ? 1 : -1) * Math.PI) / 12;
          st.anchor = null;
        }
      }
    };
    const keyup = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ') {
        if (st.space && isSpaceTap(e.timeStamp - st.spaceAt, st.spaceUsed))
          live.current.onSpaceTap?.();
        st.space = false;
        setGrab();
      } else st.keys.delete(k);
    };
    const blur = () => {
      st.keys.clear();
      st.orbit = null;
      st.drag = null;
      st.pinch = null;
      st.touches.clear();
      st.buttons = 0;
      st.space = false;
      st.mouse = null;
      setGrab();
    };
    const context = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', context);
    // Keep camera movement available when a building or panel control has focus.
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      delete canvas.dataset.grab;
    };
  }, [gl, camera, clampPose]);
  useFrame(({ gl: renderer }, dt) => {
    const st = s.current,
      step = Math.min(dt, 0.1);
    const apply = () => applyPose(camera, st.pose);
    if (st.serial !== focus.serial) {
      st.serial = focus.serial;
      st.goal = clampPose({
        ...st.goal,
        x: focus.north ? st.goal.x : focus.x,
        z: focus.north ? st.goal.z : focus.z,
        distance: focus.distance ?? st.goal.distance,
        ...(focus.north
          ? {
              yaw: (st.pose.yaw ?? 0) + angleDelta(st.pose.yaw ?? 0, 0),
              tilt: 0,
            }
          : {}),
      });
    }
    const turn = Number(st.keys.has(']')) - Number(st.keys.has('['));
    if (turn) {
      st.goal.yaw = (st.goal.yaw ?? 0) + turn * CAMERA.rotateSpeed * step;
      st.anchor = null;
    }
    const v = keyVelocity(st.keys, st.goal.distance, st.pose.yaw);
    if (
      st.mouse &&
      !st.buttons &&
      !st.drag &&
      !st.orbit &&
      !st.space &&
      document.hasFocus()
    ) {
      const r = gl.domElement.getBoundingClientRect();
      const e = edgeVelocity(st.mouse, r, st.goal.distance, st.pose.yaw);
      v.x += e.x;
      v.z += e.z;
    }
    if (v.x || v.z)
      st.goal = clampPose({
        ...st.goal,
        x: st.goal.x + v.x * step,
        z: st.goal.z + v.z * step,
      });
    const k = approach(step, 14);
    st.pose = {
      x: st.pose.x + (st.goal.x - st.pose.x) * k,
      z: st.pose.z + (st.goal.z - st.pose.z) * k,
      distance: st.pose.distance + (st.goal.distance - st.pose.distance) * k,
      yaw:
        (st.pose.yaw ?? 0) + angleDelta(st.pose.yaw ?? 0, st.goal.yaw ?? 0) * k,
      tilt:
        (st.pose.tilt ?? 0) + ((st.goal.tilt ?? 0) - (st.pose.tilt ?? 0)) * k,
    };
    apply();
    if (process.env.NODE_ENV !== 'production')
      renderer.domElement.dataset.cameraPose = JSON.stringify(st.pose);
    if (st.anchor) {
      const { sx, sy, ground: g } = st.anchor;
      const r = gl.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster(),
        hit = new THREE.Vector3();
      ray.setFromCamera(
        new THREE.Vector2(
          ((sx - r.left) / r.width) * 2 - 1,
          (-(sy - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      if (
        ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y),
          hit,
        )
      ) {
        const dx = g.x - hit.x,
          dz = g.z - hit.z;
        st.goal = clampPose({
          ...st.goal,
          x: st.goal.x + dx,
          z: st.goal.z + dz,
        });
        st.pose = { ...st.pose, x: st.pose.x + dx, z: st.pose.z + dz };
        apply();
      }
      if (Math.abs(st.goal.distance - st.pose.distance) < 0.05)
        st.anchor = null;
    }
    const report = live.current.onViewport;
    if (report) {
      const ray = new THREE.Raycaster(),
        plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y),
        hit = new THREE.Vector3();
      const corners: Point[] = [];
      for (const [nx, ny] of [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
        if (!ray.ray.intersectPlane(plane, hit)) ray.ray.at(800, hit);
        corners.push({ x: hit.x, z: hit.z });
      }
      const changed =
        st.reported.length !== 4 ||
        corners.some(
          (c, i) =>
            Math.abs(c.x - st.reported[i].x) > 0.2 ||
            Math.abs(c.z - st.reported[i].z) > 0.2,
        );
      if (changed) {
        st.reported = corners;
        report(corners);
      }
    }
  });
  return null;
}
