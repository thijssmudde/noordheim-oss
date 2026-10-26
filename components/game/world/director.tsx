'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CameraShot } from '@/lib/maps/types';

export type DirectorPose = {
  from: [number, number, number];
  lookAt: [number, number, number];
  fov?: number;
};

declare global {
  interface Window {
    /** Development and capture hook: pin the camera to a pose, or release it with null. */
    __noordheimDirector?: (pose: DirectorPose | null) => void;
  }
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Pinned pose from the capture hook; subscribers (the scene) hide the player camera rig. */
let pinned: DirectorPose | null = null;
const listeners = new Set<() => void>();
export const directorStore = {
  get: () => pinned,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set: (next: DirectorPose | null) => {
    pinned = next;
    listeners.forEach((l) => l());
  },
};
/** True while the director owns the camera (pinned pose or cinematic shots). */
export function useDirected(shots?: CameraShot[] | null) {
  const pose = useSyncExternalStore(directorStore.subscribe, directorStore.get, () => null);
  return !!pose || !!shots?.length;
}

/**
 * Cinematic camera. Plays `shots` as slow dollies (looping, cross-cut) or holds
 * a fixed `pose`; when neither is set it leaves the camera to the player rig.
 * Runs first each frame; the scene unmounts the player rig while it is directing.
 */
export function Director({
  shots,
  pose,
  onShot,
}: {
  shots?: CameraShot[] | null;
  pose?: DirectorPose | null;
  onShot?: (index: number) => void;
}) {
  const state = useRef({
    start: -1,
    index: 0,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    look: new THREE.Vector3(),
  });
  useEffect(() => {
    state.current.start = -1;
    state.current.index = 0;
  }, [shots]);
  useEffect(() => {
    window.__noordheimDirector = (next) => directorStore.set(next);
    return () => {
      delete window.__noordheimDirector;
    };
  }, []);
  useFrame(({ camera, clock }) => {
    const s = state.current;
    const fixed = directorStore.get() ?? pose;
    const perspective = camera as THREE.PerspectiveCamera;
    // Cinematic and overview shots see the whole diorama; play keeps the tight range.
    const far = fixed || shots?.length ? 2400 : 620;
    if (perspective.far !== far) {
      perspective.far = far;
      perspective.near = far > 1000 ? 0.8 : 0.1;
      perspective.updateProjectionMatrix();
    }
    if (fixed) {
      camera.position.set(...fixed.from);
      camera.lookAt(...fixed.lookAt);
      if (fixed.fov && perspective.fov !== fixed.fov) {
        perspective.fov = fixed.fov;
        perspective.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      return;
    }
    if (!shots?.length) return;
    const now = clock.elapsedTime;
    // R3F restarts the clock at 0 when the frameloop resumes (SceneReady's hold on a map switch).
    if (s.start < 0 || now < s.start) s.start = now;
    let shot = shots[s.index % shots.length];
    let t = (now - s.start) / shot.seconds;
    if (t >= 1) {
      s.index = (s.index + 1) % shots.length;
      s.start = now;
      shot = shots[s.index];
      t = 0;
      onShot?.(s.index);
    }
    const k = ease(Math.min(1, t));
    s.from.set(...shot.from);
    s.to.set(...shot.to);
    camera.position.lerpVectors(s.from, s.to, k);
    s.look.set(...shot.lookAt);
    camera.lookAt(s.look);
    camera.updateMatrixWorld();
  }, -1);
  return null;
}
