'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AtmosphereDesign } from '@/lib/maps/types';

/** Development-only `?debug=a,b` flags for isolating render layers in art reviews. */
export function debugFlag(name: string) {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  return (new URLSearchParams(window.location.search).get('debug') ?? '').split(',').includes(name);
}

/** Development-only `?look=name:value,...` numeric overrides for tuning the look live. */
export function lookParam(name: string, fallback: number) {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return fallback;
  const raw = new URLSearchParams(window.location.search).get('look') ?? '';
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split(':');
    if (k === name && Number.isFinite(Number(v))) return Number(v);
  }
  return fallback;
}

/** The authored sun, or a `?sun=x,y,z` override in development art reviews. */
export function sunDirection(atmosphere: AtmosphereDesign): [number, number, number] {
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    const raw = new URLSearchParams(window.location.search).get('sun');
    const v = raw?.split(',').map(Number);
    if (v?.length === 3 && v.every(Number.isFinite)) return v as [number, number, number];
  }
  return atmosphere.sunDirection;
}

/**
 * Golden low sun with long soft shadows, a cool sky fill and a rim light.
 * The shadow frustum follows the camera's ground focus and snaps to texels,
 * so shadows stay sharp at play zoom and never shimmer while panning.
 */
export function WorldLighting({
  atmosphere,
  shadows = true,
}: {
  atmosphere: AtmosphereDesign;
  shadows?: boolean;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const data = useMemo(() => {
    const direction = new THREE.Vector3(...sunDirection(atmosphere)).normalize();
    return {
      target: new THREE.Object3D(),
      view: new THREE.Vector3(),
      sun: direction,
      rim: new THREE.Vector3(-direction.x, 0.45, -direction.z).normalize(),
    };
  }, [atmosphere]);
  useFrame(({ camera }) => {
    const sun = light.current;
    if (!sun) return;
    camera.getWorldDirection(data.view);
    const distance = Math.max(10, -camera.position.y / Math.min(-0.1, data.view.y));
    const radius = Math.max(55, Math.min(170, distance * 0.95));
    const size = sun.shadow.mapSize.x || 2048;
    const texel = (radius * 2) / size;
    const x =
      Math.round((camera.position.x + data.view.x * distance) / texel) * texel;
    const z =
      Math.round((camera.position.z + data.view.z * distance) / texel) * texel;
    sun.position.set(x + data.sun.x * 160, data.sun.y * 160, z + data.sun.z * 160);
    data.target.position.set(x, 0, z);
    data.target.updateMatrixWorld();
    const shadow = sun.shadow.camera;
    if (Math.abs(shadow.right - radius) > 0.1) {
      shadow.left = shadow.bottom = -radius;
      shadow.right = shadow.top = radius;
      shadow.updateProjectionMatrix();
    }
  }, 0.5);
  const sunColor = useMemo(() => new THREE.Color(atmosphere.sun), [atmosphere]);
  // Dim skies (dusk, aurora) get a stronger fill so the ground never turns to mud.
  const skyLight = useMemo(() => {
    const c = new THREE.Color(atmosphere.sky);
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return THREE.MathUtils.clamp(0.28 / Math.max(0.05, luminance), 0.75, 2.2);
  }, [atmosphere]);
  const aurora = atmosphere.weather === 'aurora';
  return (
    <>
      <primitive object={data.target} />
      <hemisphereLight
        args={[atmosphere.sky, atmosphere.bounce, skyLight * 0.55 * lookParam('hemi', 1)]}
        position={[0, 1, 0]}
      />
      <ambientLight intensity={0.06} />
      <directionalLight
        ref={light}
        target={data.target}
        intensity={atmosphere.sunIntensity * 1.2 * lookParam('sun', 1)}
        color={sunColor}
        castShadow={shadows && !debugFlag('noshadow')}
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={1}
        shadow-camera-far={420}
        shadow-normalBias={0.05}
        shadow-bias={-0.0001}
        shadow-radius={2}
      />
      {aurora && (
        // Aurora glow from the northern sky: a soft green fill on snow and roofs.
        <directionalLight position={[0, 60, -100]} intensity={0.35} color="#5dffb0" />
      )}
      {/* Rim light from behind the sun: silhouettes and cliff edges pick up the sky. */}
      <directionalLight
        position={[data.rim.x * 100, data.rim.y * 100, data.rim.z * 100]}
        intensity={0.35 * lookParam('rim', 1)}
        color={atmosphere.sky}
      />
    </>
  );
}
