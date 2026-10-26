'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Loader activity on three's default manager (every useLoader GLTF and texture
 * load goes through it). Installed once, at module load, because the first
 * useLoader calls start during render; chains any handlers already set.
 */
const activity = { loading: false, changedAt: 0 };
function track() {
  if (typeof window === 'undefined') return;
  const manager = THREE.DefaultLoadingManager;
  const { onStart, onLoad, onProgress, onError } = manager;
  const touch = (loading: boolean) => {
    activity.loading = loading;
    activity.changedAt = performance.now();
  };
  manager.onStart = (...args) => {
    touch(true);
    onStart?.(...args);
  };
  manager.onProgress = (...args) => {
    touch(args[1] < args[2]);
    onProgress?.(...args);
  };
  manager.onLoad = () => {
    touch(false);
    onLoad?.();
  };
  manager.onError = (url) => {
    activity.changedAt = performance.now();
    onError?.(url);
  };
}
track();

/** Quiet time with no loads in flight before the scene counts as complete. */
const SETTLE_MS = 200;
/** Show whatever has loaded by then, even if a model is stuck. */
const GIVE_UP_MS = 25_000;
/** Frames rendered after the release before the scene is shown. */
const WARM_FRAMES = 3;

/**
 * The home screen's gate for the live scene (`id` is the map). While the
 * scene's models download, the canvas renders nothing (`hold(true)`: the
 * frame loop is paused) so the main thread stays free for downloads and
 * decoding. Once no load has been in flight for a moment, every material in
 * the scene is compiled in parallel (`compileAsync`, KHR_parallel_shader_compile)
 * instead of stalling the first frame for a second; then frames run again and,
 * after a few, `onReady(id)` lets the page cross-fade the canvas in.
 */
export function SceneReady({
  id,
  onReady,
  hold,
}: {
  id: string;
  onReady: (id: string) => void;
  hold: (held: boolean) => void;
}) {
  const { gl, scene, camera } = useThree();
  const frames = useRef(-1);
  const done = useRef(false);
  const callback = useRef(onReady);
  useEffect(() => {
    callback.current = onReady;
  }, [onReady]);
  useLayoutEffect(() => {
    hold(true);
    frames.current = -1;
    done.current = false;
    const since = performance.now();
    let live = true;
    const release = () => {
      if (!live) return;
      frames.current = 0;
      hold(false);
    };
    const poll = window.setInterval(() => {
      const now = performance.now();
      const settled =
        !activity.loading && now - activity.changedAt > SETTLE_MS && now - since > SETTLE_MS;
      if (!settled && now - since < GIVE_UP_MS) return;
      window.clearInterval(poll);
      // The scene renders linear HDR into the post chain's half-float target:
      // compile for that output, or every program would be built twice.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const previous = gl.getRenderTarget();
      gl.setRenderTarget(target);
      const compiled = gl.compileAsync(scene, camera);
      gl.setRenderTarget(previous);
      target.dispose();
      compiled.then(release, release);
    }, 50);
    return () => {
      live = false;
      window.clearInterval(poll);
      hold(false);
    };
  }, [id, gl, scene, camera, hold]);
  useFrame(() => {
    if (done.current || frames.current < 0) return;
    if (++frames.current < WARM_FRAMES) return;
    done.current = true;
    callback.current(id);
  });
  return null;
}
