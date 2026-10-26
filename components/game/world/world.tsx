'use client';
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useWorldTime } from './world-time';
import type { CompiledMap } from '@/lib/maps/types';
import { worldGrid } from './world-map';
import { buildMasks, heightTexture } from './masks';
import { TerrainMesh } from './terrain';
import { WaterSurface } from './water';
import { DioramaEdge } from './diorama-edge';
import { WorldLighting, debugFlag } from './lighting';
import { SkyDome } from './sky';
import { WorldVegetation, type Footprint } from './vegetation';
import { WorldCrossings } from './crossings';
import { WorldRailways } from './rail';
import { WorldProps, type PropEmitters } from './props';
import { WorldBillboards } from './billboards';
import { Weather } from './weather';
import { Backdrop } from './backdrop';
export { WorldClock, useWorldTime } from './world-time';

class WorldBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Part({ children }: { children: ReactNode }) {
  return (
    <WorldBoundary>
      <Suspense fallback={null}>{children}</Suspense>
    </WorldBoundary>
  );
}

/**
 * Everything static about a battlefield: light, sky, terrain, water, the
 * diorama edge. Built once per map; nothing here re-renders on a server tick.
 */
export function World({
  map,
  rich = true,
  occupied,
}: {
  map: CompiledMap;
  /** Full weather density; lower render tiers halve it. Shadows stay on at every tier. */
  rich?: boolean;
  /** Building footprints: decoration inside them gives way. */
  occupied?: Footprint[];
}) {
  const time = useWorldTime();
  const grid = useMemo(() => worldGrid(map), [map]);
  const masks = useMemo(() => buildMasks(map.design), [map]);
  const heights = useMemo(() => heightTexture(grid), [grid]);
  useEffect(
    () => () => {
      masks.dispose();
      heights.dispose();
    },
    [masks, heights],
  );
  const atmosphere = map.design.atmosphere;
  const emitters = useMemo<PropEmitters>(() => ({ smoke: [], lights: [] }), []);
  return (
    <group>
      <WorldLighting atmosphere={atmosphere} />
      <SkyDome atmosphere={atmosphere} time={time} />
      {/* Separate boundaries: nothing waits for another part's downloads to start its own. */}
      <Part>
        <TerrainMesh grid={grid} map={map} masks={masks} time={time} />
      </Part>
      <Part>
        <DioramaEdge map={map} grid={grid} />
      </Part>
      <Part>
        <Backdrop map={map} />
      </Part>
      {!debugFlag('novegetation') && (
        <Part>
          <WorldVegetation map={map} grid={grid} occupied={occupied} />
        </Part>
      )}
      <Part>
        <WorldCrossings map={map} />
      </Part>
      <Part>
        <WorldRailways map={map} />
      </Part>
      <Part>
        <WorldProps map={map} emitters={emitters} />
      </Part>
      <Part>
        <WorldBillboards map={map} occupied={occupied} />
      </Part>
      <Weather atmosphere={atmosphere} time={time} density={rich ? 1 : 0.5} />
      <WaterSurface map={map} grid={grid} masks={masks} heights={heights} time={time} />
    </group>
  );
}
