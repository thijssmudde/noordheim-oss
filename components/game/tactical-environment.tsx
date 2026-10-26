'use client';

import { SURFACE_ATLAS, detailMaterial } from './surface-detail';
import { useTerrain } from './terrain-context';

import {
  Component,
  memo,
  Suspense,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withMeshopt } from '../../lib/gltf';
import { modelUrl } from './world/models';

// Decorative life never participates in picking, navigation, fog of war or simulation.
const ignoreRaycast = () => {};
const AmbientTime = createContext(new THREE.Uniform(0));
export function EnvironmentMotion({ children }: { children: ReactNode }) {
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
  return <AmbientTime.Provider value={time}>{children}</AmbientTime.Provider>;
}

/** Gentle crown movement, with the same deformation in the shadow pass. */
export function WindCanopyMaterial({
  source,
}: {
  source?: THREE.MeshStandardMaterial;
}) {
  const time = useContext(AmbientTime);
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const materials = useMemo(() => {
    const surface =
      source?.clone() ??
      new THREE.MeshStandardMaterial({
        color: '#50685a',
        roughness: 0.95,
        vertexColors: true,
      });
    const depth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    for (const material of [surface, depth]) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uAmbientTime = time;
        shader.vertexShader =
          `uniform float uAmbientTime;\n${shader.vertexShader}`.replace(
            '#include <begin_vertex>',
            `
          #include <begin_vertex>
          float phase = instanceMatrix[3].x * .12 + instanceMatrix[3].z * .08;
          float crown = smoothstep(.4, 3.4, position.y);
          float gust = .65 + .35 * sin(uAmbientTime * .23);
          transformed.x += sin(uAmbientTime * 1.8 + phase + position.y) * crown * .11 * gust;
          transformed.z += cos(uAmbientTime * 1.3 + phase) * crown * .045;
        `,
          );
      };
    }
    detailMaterial(surface, atlas, 0.25);
    return { surface, depth };
  }, [time, source, atlas]);
  useEffect(
    () => () => {
      materials.surface.dispose();
      materials.depth.dispose();
    },
    [materials],
  );
  return (
    <>
      <primitive object={materials.surface} attach="material" />
      <primitive object={materials.depth} attach="customDepthMaterial" />
    </>
  );
}

/** Gulls work the open water: flocks circle the largest lake, sea and river reaches. */
function gullCircuits(map: ReturnType<typeof useTerrain>) {
  const d = map.design;
  const centre = (points: { x: number; z: number }[]) => {
    const inside = points.filter(
      (p) =>
        p.x > d.bounds.minX && p.x < d.bounds.maxX && p.z > d.bounds.minZ && p.z < d.bounds.maxZ,
    );
    const list = inside.length ? inside : points;
    return {
      x: list.reduce((s, p) => s + p.x, 0) / list.length,
      z: list.reduce((s, p) => s + p.z, 0) / list.length,
    };
  };
  const circuits = [
    ...d.seas.map((w) => ({ ...centre(w.outline), r: 26 })),
    ...d.lakes.map((w) => ({ ...centre(w.outline), r: 16 })),
    ...d.rivers.map((r) => ({ ...r.path[Math.floor(r.path.length / 2)], r: 22 })),
  ].map((c) => ({
    x: Math.min(d.bounds.maxX - 20, Math.max(d.bounds.minX + 20, c.x)),
    z: Math.min(d.bounds.maxZ - 20, Math.max(d.bounds.minZ + 20, c.z)),
    r: c.r,
  }));
  return circuits.length ? circuits : [{ x: 0, z: 0, r: 30 }];
}

function GullFlock() {
  const map = useTerrain();
  const circuits = useMemo(() => gullCircuits(map), [map]);
  const gltf = useLoader(GLTFLoader, modelUrl('environment/gull'), withMeshopt);
  const time = useContext(AmbientTime);
  const birds = useMemo(
    () =>
      Array.from({ length: Math.min(12, circuits.length * 3) }, (_, i) => {
        const model = gltf.scene.clone(true),
          wings: THREE.Object3D[] = [];
        model.traverse((o) => {
          o.raycast = ignoreRaycast;
          if (o.name === 'wing_left' || o.name === 'wing_right') wings.push(o);
        });
        model.scale.setScalar(0.5);
        return { model, wings, phase: i * 0.63, circuit: circuits[i % circuits.length] };
      }),
    [gltf, circuits],
  );
  useFrame(() => {
    for (const [i, bird] of birds.entries()) {
      const t = time.value * 0.07 + bird.phase;
      const { x, z, r } = bird.circuit;
      bird.model.position.set(
        x + Math.cos(t) * r,
        13 + (i % 4) * 0.8 + Math.sin(t * 3) * 1.1,
        z + Math.sin(t) * r * 0.6,
      );
      bird.model.rotation.set(
        0,
        Math.atan2(-Math.sin(t) * r, Math.cos(t) * r * 0.6),
        Math.sin(t * 2) * 0.09,
      );
      const flap =
        Math.sin(time.value * 5.3 + bird.phase) *
        0.26 *
        Math.max(0, Math.sin(time.value * 0.65 + bird.phase));
      for (const wing of bird.wings)
        wing.rotation.z = (wing.name === 'wing_left' ? -1 : 1) * (0.08 + flap);
    }
  });
  return (
    <group>
      {birds.map((b, i) => (
        <primitive key={i} object={b.model} />
      ))}
    </group>
  );
}

/** Gulls over the open water. Chimney smoke, flags and lamps come from the building models. */
function LivingCoast() {
  return <GullFlock />;
}
class AmbientAssetBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
/** Ambient life that never changes with the battle: built once per map. */
export const CoastalLife = memo(function CoastalLife() {
  return (
    <AmbientAssetBoundary>
      <Suspense fallback={null}>
        <LivingCoast />
      </Suspense>
    </AmbientAssetBoundary>
  );
});
