'use client';

import { useEffect } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useTerrain } from './terrain-context';

const SKY = '/art/materials/northern-sky.webp?v=1';
if (typeof window !== 'undefined') useLoader.preload(THREE.TextureLoader, SKY);

/** A filtered sky reflection shared by steel, glazing and wet ground. */
export function SkyReflections() {
  const source = useLoader(THREE.TextureLoader, SKY);
  const { gl, scene } = useThree();
  const { design } = useTerrain();
  // Deep-snow maps glare less off steel and glass.
  const intensity = design.atmosphere.snowCover > 0.9 ? 0.25 : 0.4;
  useEffect(
    () => installSky(gl, scene, source, intensity),
    [gl, scene, source, intensity],
  );
  return null;
}

/** Own the lifetime of the imperative Three.js environment assignment. */
function installSky(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  source: THREE.Texture,
  intensity: number,
) {
  const panorama = source.clone();
  panorama.colorSpace = THREE.SRGBColorSpace;
  panorama.mapping = THREE.EquirectangularReflectionMapping;
  panorama.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(gl);
  const filtered = generator.fromEquirectangular(panorama);
  const previous = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  scene.environment = filtered.texture;
  scene.environmentIntensity = intensity;
  generator.dispose();
  panorama.dispose();
  return () => {
    if (scene.environment === filtered.texture) {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
    }
    filtered.dispose();
  };
}
