'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Seconds of world animation (water, wind, aurora, smoke); frozen under reduced motion. */
const WorldTime = createContext(new THREE.Uniform(0));
export const useWorldTime = () => useContext(WorldTime);

export function WorldClock({ children }: { children: ReactNode }) {
  const [time] = useState(() => new THREE.Uniform(0));
  const clock = useRef(time);
  const reduced = useRef(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reduced.current = preference.matches;
    };
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useFrame((_, delta) => {
    if (!reduced.current) clock.current.value += Math.min(delta, 0.1);
  });
  return <WorldTime.Provider value={time}>{children}</WorldTime.Provider>;
}
