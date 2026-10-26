'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Redraws the shadow map every `every`-th frame (1: every frame). Lower render
 * tiers use this instead of switching shadows off, which would recompile every
 * material. Between redraws the last shadow map (and its matrix) stays in use.
 */
export function ShadowCadence({ every }: { every: number }) {
  const get = useThree((state) => state.get);
  const frame = useRef(0);
  useEffect(() => {
    const { shadowMap } = get().gl;
    shadowMap.autoUpdate = every <= 1;
    shadowMap.needsUpdate = true;
    return () => {
      shadowMap.autoUpdate = true;
    };
  }, [get, every]);
  useFrame((state) => {
    if (every > 1 && ++frame.current % every === 0) state.gl.shadowMap.needsUpdate = true;
  });
  return null;
}
