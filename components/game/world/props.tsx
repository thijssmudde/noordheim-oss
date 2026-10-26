'use client';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CompiledMap, PropDesign } from '@/lib/maps/types';
import { SURFACE_ATLAS, detailMaterial } from '../surface-detail';
import { modelUrl } from './models';
import { withMeshopt } from '../../../lib/gltf';
import { useWorldTime } from './world-time';

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
const ignoreRaycast = () => {};

/** Emitters a prop exposes to the ambient effects (chimney smoke, lamp glow). */
export type PropEmitters = { smoke: THREE.Vector3[]; lights: THREE.Vector3[] };

function spin(list: { node: THREE.Object3D; axis: 'y' | 'z'; speed: number }[], t: number) {
  for (const s of list) s.node.rotation[s.axis] = t * s.speed;
}

function Prop({ prop, map, emitters }: { prop: PropDesign; map: CompiledMap; emitters: PropEmitters }) {
  const gltf = useLoader(GLTFLoader, modelUrl(`props/${prop.kind}`), withMeshopt);
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const time = useWorldTime();
  const asset = useMemo(() => {
    const model = gltf.scene.clone(true);
    const materials: THREE.Material[] = [];
    const spinners: { node: THREE.Object3D; axis: 'y' | 'z'; speed: number }[] = [];
    model.traverse((o) => {
      o.raycast = ignoreRaycast;
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        if (m.name !== 'glass' && m.name !== 'lamp') detailMaterial(m, atlas, 0.35);
        if (m.name === 'lamp') {
          m.emissive = new THREE.Color('#ffcf7a');
          m.emissiveIntensity = 3.5;
          m.toneMapped = false;
        }
        o.material = m;
        materials.push(m);
      }
      if (o.name.startsWith('rotor_pivot')) spinners.push({ node: o, axis: 'z', speed: 0.9 });
      if (o.name.startsWith('radar_dish')) spinners.push({ node: o, axis: 'y', speed: 0.8 });
    });
    return { model, materials, spinners };
  }, [gltf, atlas]);
  useEffect(() => () => asset.materials.forEach((m) => m.dispose()), [asset]);
  const root = useRef<THREE.Group>(null);
  useEffect(() => {
    const group = root.current;
    if (!group) return;
    group.updateMatrixWorld(true);
    const found = { smoke: [] as THREE.Vector3[], lights: [] as THREE.Vector3[] };
    group.traverse((o) => {
      if (o.name.startsWith('smoke_')) found.smoke.push(o.getWorldPosition(new THREE.Vector3()));
      if (o.name.startsWith('light_')) found.lights.push(o.getWorldPosition(new THREE.Vector3()));
    });
    emitters.smoke.push(...found.smoke);
    emitters.lights.push(...found.lights);
    return () => {
      for (const p of found.smoke) emitters.smoke.splice(emitters.smoke.indexOf(p), 1);
      for (const p of found.lights) emitters.lights.splice(emitters.lights.indexOf(p), 1);
    };
  }, [asset, emitters]);
  const spinners = useRef(asset.spinners);
  useEffect(() => {
    spinners.current = asset.spinners;
  }, [asset]);
  useFrame(() => spin(spinners.current, time.value));
  const y = prop.kind === 'boat' ? 0 : map.heightAt(prop.x, prop.z);
  return (
    <group ref={root} position={[prop.x, y, prop.z]} rotation={[0, prop.angle, 0]} scale={prop.scale ?? 1}>
      <primitive object={asset.model} />
    </group>
  );
}

/** The design's set pieces: lighthouses, wrecks, masts, huts. Small in number, individually animated. */
export function WorldProps({ map, emitters }: { map: CompiledMap; emitters: PropEmitters }) {
  return (
    <group>
      {map.design.props.map((prop, i) =>
        // The ruin read as a pile of grey blocks at every distance: left out until it is remodelled.
        prop.kind === 'ruin' ? null : (
        <Quiet key={`${prop.kind}:${i}`}>
          <Suspense fallback={null}>
            <Prop prop={prop} map={map} emitters={emitters} />
          </Suspense>
        </Quiet>
        ),
      )}
    </group>
  );
}
