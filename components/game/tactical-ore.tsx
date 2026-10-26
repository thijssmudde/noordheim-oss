'use client';
import { type TerrainMap } from '@/lib/tactical-terrain';
import { useTerrain } from './terrain-context';
import { useOverlays } from './world/scene-mode';

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { modelUrl } from './world/models';
import { preloadModel, useModel } from './world/use-model';
import { type Deposit } from '@/lib/tactics';
import type { Sight } from '@/lib/tactical-fog';
import { seededRandom } from './terrain';

const paths = [1, 2, 3].map((n) => modelUrl(`ore/ironstone_${n}`));
const seedFor = (id: string) =>
  Array.from(id).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 977);

/** A feathered, irregular bed of exposed soil follows the actual terrain surface. */
function oreBed(d: Pick<Deposit, 'id' | 'x' | 'z'>, map: TerrainMap) {
  const { heightAt } = map;

  const random = seededRandom(seedFor(d.id)),
    segments = 40;
  const positions = [d.x, heightAt(d.x, d.z) + 0.035, d.z];
  const shade = new THREE.Color('#514a3c');
  const colors = [shade.r, shade.g, shade.b, 0.68],
    indices: number[] = [];
  const radii = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return (
      4.9 *
      (0.83 +
        Math.sin(a * 3 + 0.8) * 0.1 +
        Math.sin(a * 5) * 0.06 +
        random() * 0.08)
    );
  });
  for (const ring of [0.6, 1])
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2,
        r = radii[i] * ring;
      const x = d.x + Math.cos(a) * r * 1.09,
        z = d.z + Math.sin(a) * r * 0.85;
      positions.push(x, heightAt(x, z) + 0.035, z);
      const tint = 0.86 + random() * 0.28;
      colors.push(
        shade.r * tint,
        shade.g * tint,
        shade.b * tint,
        ring === 1 ? 0 : 0.57,
      );
    }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(0, 1 + next, 1 + i);
    indices.push(
      1 + i,
      1 + next,
      1 + segments + i,
      1 + next,
      1 + segments + next,
      1 + segments + i,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

class OreAssetBoundary extends Component<
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

function OreRockBatch({
  asset,
  matrices,
}: {
  asset: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    matrix: THREE.Matrix4;
  };
  matrices: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, i) =>
      mesh.setMatrixAt(
        i,
        new THREE.Matrix4().multiplyMatrices(matrix, asset.matrix),
      ),
    );
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [asset, matrices]);
  return (
    <instancedMesh
      ref={ref}
      args={[asset.geometry, asset.material, 24]}
      castShadow
      receiveShadow
    />
  );
}

function OreRocks({ deposit: d, ratio }: { deposit: Deposit; ratio: number }) {
  const map = useTerrain();
  const { heightAt } = map;

  paths.forEach(preloadModel);
  const first = useModel(paths[0]),
    second = useModel(paths[1]),
    third = useModel(paths[2]);
  const assets = useMemo(
    () =>
      [first, second, third].map((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const mesh = gltf.scene.getObjectByProperty(
          'isMesh',
          true,
        ) as THREE.Mesh;
        if (!mesh) throw new Error('Ironstone mesh missing');
        return {
          geometry: mesh.geometry,
          material: mesh.material,
          matrix: mesh.matrixWorld.clone(),
        };
      }),
    [first, second, third],
  );
  const matrices = useMemo(() => {
    const random = seededRandom(seedFor(d.id));
    const groups = [[], [], []] as THREE.Matrix4[][];
    const visible = ratio > 0 ? Math.max(2, Math.ceil(24 * ratio)) : 0;
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963 + random() * 0.5;
      const radius = Math.sqrt((i + 0.4) / 24) * 3.95;
      const x = d.x + Math.cos(angle) * radius,
        z = d.z + Math.sin(angle) * radius * 0.76;
      const scale = 0.54 + random() * 0.44;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, heightAt(x, z) + 0.015, z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, random() * Math.PI * 2, 0),
        ),
        new THREE.Vector3(scale, scale * (0.8 + random() * 0.2), scale),
      );
      if (i < visible) groups[i % 3].push(matrix);
    }
    return groups;
  }, [d.id, d.x, d.z, ratio, heightAt]);
  return (
    <>
      {assets.map((asset, i) => (
        <OreRockBatch key={i} asset={asset} matrices={matrices[i]} />
      ))}
    </>
  );
}

export function OreSeam({
  deposit: d,
  sight,
}: {
  deposit: Deposit;
  sight: Sight;
}) {
  const map = useTerrain();
  const { heightAt } = map;
  const overlays = useOverlays();

  const ratio = Math.max(0, Math.min(1, d.amount / Math.max(1, d.capacity)));
  const ground = useMemo(
    () => oreBed({ id: d.id, x: d.x, z: d.z }, map),
    [d.id, d.x, d.z, map],
  );
  useEffect(() => () => ground.dispose(), [ground]);
  return (
    <group userData={{ depositId: d.id }}>
      <mesh geometry={ground} receiveShadow>
        <meshStandardMaterial
          vertexColors
          transparent
          depthWrite={false}
          roughness={1}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      <OreAssetBoundary>
        <Suspense fallback={null}>
          <OreRocks deposit={d} ratio={ratio} />
        </Suspense>
      </OreAssetBoundary>
      {overlays && (
      <Html
        position={[d.x, heightAt(d.x, d.z) + 1.8, d.z - 5.1]}
        center
        zIndexRange={[4, 0]}
        style={sight === 'hidden' ? { display: 'none' } : undefined}
      >
        <span className={`tac-ore-label ${ratio > 0 ? '' : 'depleted'}`}>
          {d.name}
          <b>
            {ratio > 0
              ? `₭ ${Math.round(d.amount).toLocaleString('en-US')}`
              : 'Exhausted'}
          </b>
        </span>
      </Html>
      )}
    </group>
  );
}
