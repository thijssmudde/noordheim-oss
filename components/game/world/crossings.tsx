'use client';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import type { CompiledMap, CrossingDesign, CrossingStyle } from '@/lib/maps/types';
import { InstancedModel, type Placement } from './instanced';
import { bridgeBents, bridgePlacement, worldGrid } from './world-map';

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Bridge models are authored for a 10.5 m wide, 16 m long deck section. */
export const BRIDGE_MODELS: Record<Exclude<CrossingStyle, 'ford'>, string> = {
  steel: 'bridge_span',
  suspension: 'bridge_suspension',
  timber: 'bridge_timber',
  pontoon: 'bridge_pontoon',
  causeway: 'bridge_causeway',
  viaduct: 'bridge_viaduct',
};

const ignoreRaycast = () => {};

/** Ford: a line of stepping stones and striped depth posts either side. */
function Ford({ crossing: c }: { crossing: CrossingDesign }) {
  const stones = useMemo(() => {
    const list: [number, number, number, number][] = [];
    let seed = Math.abs(Math.round(c.x * 13 + c.z * 7));
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let along = -c.length / 2 + 2; along < c.length / 2 - 2; along += 1.6)
      for (const side of [-1, 1])
        list.push([side * (c.width / 2 + 0.2 + r() * 0.8), along + (r() - 0.5), 0.25 + r() * 0.3, r() * 6]);
    return list;
  }, [c]);
  return (
    <group position={[c.x, 0, c.z]} rotation={[0, c.angle, 0]}>
      {stones.map(([x, z, s, a], i) => (
        <mesh key={i} position={[x, -0.1, z]} rotation={[0.3, a, 0.2]} scale={[s * 1.3, s * 0.7, s]} castShadow receiveShadow raycast={ignoreRaycast}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#8a8781" roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].flatMap((side) =>
        [-1, 0, 1].map((end) => (
          <group key={`${side}:${end}`} position={[side * (c.width / 2 + 0.6), 0, end * (c.length / 2 - 1.5)]}>
            <mesh position={[0, 0.5, 0]} castShadow raycast={ignoreRaycast}>
              <cylinderGeometry args={[0.1, 0.14, 1.8, 6]} />
              <meshStandardMaterial color="#645744" roughness={1} />
            </mesh>
            <mesh position={[0, 1.25, 0]} raycast={ignoreRaycast}>
              <cylinderGeometry args={[0.11, 0.11, 0.3, 6]} />
              <meshStandardMaterial color="#ff8f3a" roughness={0.7} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/** Timber trestles carrying a raised deck (a gorge bridge) down to the ground below. */
function Trestles({ map, crossing: c }: { map: CompiledMap; crossing: CrossingDesign }) {
  const bents = useMemo(() => bridgeBents(map, worldGrid(map), c), [map, c]);
  if (!bents.length) return null;
  const inset = c.width / 2 - 0.7;
  return (
    <group position={[c.x, 0, c.z]} rotation={[0, c.angle, 0]}>
      {bents.map(({ along, ground, top }) => {
        const height = top - ground;
        return (
          <group key={along} position={[0, 0, along]}>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * inset, ground + height / 2, 0]} castShadow receiveShadow raycast={ignoreRaycast}>
                <boxGeometry args={[0.45, height, 0.45]} />
                <meshStandardMaterial color="#5a4635" roughness={1} />
              </mesh>
            ))}
            {[top - 0.2, ground + height * 0.45].map((y) => (
              <mesh key={y} position={[0, y, 0]} castShadow receiveShadow raycast={ignoreRaycast}>
                <boxGeometry args={[2 * inset + 0.6, 0.35, 0.35]} />
                <meshStandardMaterial color="#4d3b2c" roughness={1} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

export function WorldCrossings({ map }: { map: CompiledMap }) {
  const groups = useMemo(() => {
    const out: Record<string, Placement[]> = {};
    for (const c of map.design.crossings) {
      if (c.style === 'ford') continue;
      const { y, pitch } = bridgePlacement(map, c);
      (out[BRIDGE_MODELS[c.style]] ??= []).push({
        x: c.x,
        y,
        z: c.z,
        angle: c.angle,
        pitch,
        scale: 1,
        stretch: [c.width / 10.5, 1, c.length / 16],
      });
    }
    return Object.entries(out);
  }, [map]);
  const snow = map.design.atmosphere.snowCover;
  return (
    <group>
      {groups.map(([name, list]) => (
        <Quiet key={name}>
          <Suspense fallback={null}>
            <InstancedModel name={name} placements={list} options={{ detail: 0.6, snow: snow * 0.5, snowColor: map.design.palette.snow }} />
          </Suspense>
        </Quiet>
      ))}
      {map.design.crossings.map((c) => (
        <Trestles key={c.id} map={map} crossing={c} />
      ))}
      {map.design.crossings
        .filter((c) => c.style === 'ford')
        .map((c) => (
          <Ford key={c.id} crossing={c} />
        ))}
    </group>
  );
}
