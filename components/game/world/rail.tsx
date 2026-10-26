'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CompiledMap } from '@/lib/maps/types';

const ignoreRaycast = () => {};
const STEP = 0.9;
const GAUGE = 1.45;

/** Railway track (sleepers and two steel rails) along every `rail` road, following the ground. */
export function WorldRailways({ map }: { map: CompiledMap }) {
  const sleepers = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);
  const plan = useMemo(() => {
    const ties: THREE.Matrix4[] = [],
      bars: THREE.Matrix4[] = [];
    const o = new THREE.Object3D();
    for (const road of map.design.roads) {
      if (road.surface !== 'rail') continue;
      const points: THREE.Vector3[] = [];
      for (let i = 1; i < road.path.length; i++) {
        const a = road.path[i - 1],
          b = road.path[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n,
            z = a.z + ((b.z - a.z) * k) / n;
          points.push(new THREE.Vector3(x, map.heightAt(x, z) + 0.12, z));
        }
      }
      // Gentle smoothing so the rails do not follow every lattice bump.
      for (let pass = 0; pass < 3; pass++)
        for (let i = 1; i < points.length - 1; i++)
          points[i].y = (points[i - 1].y + points[i].y * 2 + points[i + 1].y) / 4;
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i],
          q = points[i + 1];
        const yaw = Math.atan2(q.x - p.x, q.z - p.z);
        const pitch = -Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z));
        o.position.copy(p);
        o.rotation.set(0, yaw, 0, 'YXZ');
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        ties.push(o.matrix.clone());
        const len = p.distanceTo(q);
        for (const side of [-1, 1]) {
          o.position.set(
            (p.x + q.x) / 2 + Math.cos(yaw) * side * (GAUGE / 2),
            (p.y + q.y) / 2 + 0.12,
            (p.z + q.z) / 2 - Math.sin(yaw) * side * (GAUGE / 2),
          );
          o.rotation.set(pitch, yaw, 0, 'YXZ');
          o.scale.set(1, 1, len + 0.02);
          o.updateMatrix();
          bars.push(o.matrix.clone());
        }
      }
    }
    return { ties, bars };
  }, [map]);
  const geometry = useMemo(
    () => ({
      tie: new THREE.BoxGeometry(2.5, 0.16, 0.3),
      rail: new THREE.BoxGeometry(0.09, 0.14, 1),
    }),
    [],
  );
  useEffect(() => () => {
    geometry.tie.dispose();
    geometry.rail.dispose();
  }, [geometry]);
  useEffect(() => {
    for (const [mesh, list] of [
      [sleepers.current, plan.ties],
      [rails.current, plan.bars],
    ] as const) {
      if (!mesh) continue;
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [plan]);
  if (!plan.ties.length) return null;
  return (
    <group>
      <instancedMesh ref={sleepers} args={[geometry.tie, undefined, plan.ties.length]} receiveShadow castShadow raycast={ignoreRaycast}>
        <meshStandardMaterial color="#4b3b2e" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={rails} args={[geometry.rail, undefined, plan.bars.length]} castShadow raycast={ignoreRaycast}>
        <meshStandardMaterial color="#8d97a0" roughness={0.35} metalness={0.8} />
      </instancedMesh>
    </group>
  );
}
