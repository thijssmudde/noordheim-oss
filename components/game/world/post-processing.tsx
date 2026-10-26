'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { FogGrid } from '@/lib/tactical-fog';
import { debugFlag } from './lighting';
import { createPostChain, postKey, type PostChain, type PostSettings } from './post-chain';

/**
 * Materials render linear HDR into the composer and tone mapping happens once,
 * at the end; construction sites rise through per-material clipping planes.
 */
function prepareRenderer(gl: THREE.WebGLRenderer) {
  const previous = gl.toneMapping;
  gl.toneMapping = THREE.NoToneMapping;
  gl.localClippingEnabled = true;
  return () => {
    gl.toneMapping = previous;
  };
}

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * Takes over rendering from R3F (useFrame priority 1) and draws the frame
 * through the diorama post chain. Rebuilt only when the quality tier changes.
 */
export function PostProcessing({
  fog,
  bounds,
  settings,
}: {
  fog: FogGrid | null;
  bounds: Bounds;
  settings: PostSettings;
}) {
  const { gl, scene, camera } = useThree();
  const chain = useRef<PostChain | null>(null);
  const live = useRef({ fog, bounds, settings });
  useEffect(() => {
    live.current = { fog, bounds, settings };
    chain.current?.configure(settings);
  }, [fog, bounds, settings]);
  useEffect(() => {
    const restore = prepareRenderer(gl);
    return () => {
      restore();
      chain.current?.dispose();
      chain.current = null;
    };
  }, [gl]);
  useFrame(({ clock }, delta) => {
    const { fog, bounds, settings } = live.current;
    if (chain.current && chain.current.key !== postKey(settings)) {
      chain.current.dispose();
      chain.current = null;
    }
    if (debugFlag('nopost')) {
      gl.render(scene, camera);
      return;
    }
    chain.current ??= createPostChain(gl, scene, camera, settings);
    chain.current.setFog(fog, bounds);
    chain.current.render(delta, clock.elapsedTime);
  }, 1);
  return null;
}
