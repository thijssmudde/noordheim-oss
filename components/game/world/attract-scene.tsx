'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withMeshopt } from '../../../lib/gltf';
import { modelPath, modelUrl } from './models';
import { BRIDGE_MODELS } from './crossings';
import { vegetationModels } from './vegetation';
import TacticalScene from '../tactical-scene';
import { LocalOrders } from '@/lib/tactical-motion';
import { FogGrid } from '@/lib/tactical-fog';
import { terrainFor } from '@/lib/tactical-terrain';
import { isMapId, DEFAULT_MAP_ID, MAPS, type MapId } from '@/lib/maps';
import type { CameraShot, CompiledMap, CrossingDesign } from '@/lib/maps/types';
import {
  joinBattle,
  makeEntity,
  newBattle,
  tickBattle,
  type Battle,
  type EntityKind,
} from '@/lib/tactics';

const noop = () => {};
const TICK = 250;
/** Seconds before the skirmish is reset, even if both sides still stand. */
const ROUND_SECONDS = 38;

/** Everything is visible in the attract mode: no fog of war, no memory. */
class OpenSky extends FogGrid {
  override update(...args: Parameters<FogGrid['update']>) {
    super.update(...args);
    this.data.fill(255);
  }
}

/** The crossing the first cinematic shot looks at (ford last: decks read better). */
function stageCrossing(mapId: MapId): CrossingDesign | null {
  const map = terrainFor({ mapId });
  const look = map.design.shots[0]?.lookAt ?? [0, 0, 0];
  const list = [...map.design.crossings].sort(
    (a, b) =>
      (a.style === 'ford' ? 1e6 : 0) +
      Math.hypot(a.x - look[0], a.z - look[2]) -
      ((b.style === 'ford' ? 1e6 : 0) + Math.hypot(b.x - look[0], b.z - look[2])),
  );
  if (list[0]) return list[0];
  // No river: stage the fight on the first plateau ramp (king of the hill).
  const ramp = map.design.plateaus[0]?.ramps[0];
  if (!ramp) return null;
  const length = Math.hypot(ramp.to.x - ramp.from.x, ramp.to.z - ramp.from.z);
  return {
    id: 'ramp',
    name: 'Ramp',
    style: 'ford',
    x: (ramp.from.x + ramp.to.x) / 2,
    z: (ramp.from.z + ramp.to.z) / 2,
    angle: Math.atan2(ramp.to.x - ramp.from.x, ramp.to.z - ramp.from.z),
    width: ramp.width,
    length: length + 8,
  };
}

/** Authored shots this high (or higher) are board overviews: the attract loop skips them. */
const OVERVIEW_HEIGHT = 40;

/**
 * The attract dolly opens on the map's signature shot (its first authored
 * shot, which the hero still is rendered from), then frames the firefight on
 * the crossing (from the riverbank), the map's other close authored shots, the
 * landing base and a landmark set piece. No whole-board overview.
 */
export function attractShots(map: CompiledMap, c: CrossingDesign | null): CameraShot[] {
  const { bounds, design } = map;
  const home = design.landings[0];
  const shots: CameraShot[] = [];
  const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const gy = (x: number, z: number) => Math.max(0, map.heightAt(x, z));
  const [signature, ...authored] = design.shots.filter((s) => s.from[1] < OVERVIEW_HEIGHT);
  if (signature) shots.push(signature);
  if (c) {
    const px = Math.cos(c.angle),
      pz = -Math.sin(c.angle);
    const ax = Math.sin(c.angle),
      az = Math.cos(c.angle);
    const side = Math.sign((home.x - c.x) * px + (home.z - c.z) * pz) || 1;
    shots.push({
      from: v(c.x + px * side * 30 + ax * 14, 7, c.z + pz * side * 30 + az * 14),
      to: v(c.x + px * side * 26 - ax * 12, 6, c.z + pz * side * 26 - az * 12),
      lookAt: v(c.x, 1.5, c.z),
      seconds: 13,
    });
  }
  shots.push(...authored);
  shots.push({
    from: v(home.x - 34, gy(home.x, home.z) + 15, home.z + 38),
    to: v(home.x + 18, gy(home.x, home.z) + 11, home.z + 40),
    lookAt: v(home.x, gy(home.x, home.z) + 2, home.z - 10),
    seconds: 11,
  });
  const landmark =
    design.props.filter((p) => p.kind !== 'ruin').find((p) => ['lighthouse', 'windmill', 'radio_mast', 'crane', 'fishing_hut'].includes(p.kind)) ??
    design.props[0];
  if (landmark) {
    const y = gy(landmark.x, landmark.z);
    // Keep the camera over the board, looking inward, so the cut edge stays behind it.
    const cx0 = (bounds.minX + bounds.maxX) / 2;
    const side = landmark.x < cx0 ? 1 : -1;
    const inset = (x: number, z: number): [number, number] => [
      Math.min(bounds.maxX - 8, Math.max(bounds.minX + 8, x)),
      Math.min(bounds.maxZ - 8, Math.max(bounds.minZ + 8, z)),
    ];
    const [fx, fz] = inset(landmark.x + side * 18, landmark.z + 30);
    const [tx, tz] = inset(landmark.x + side * 34, landmark.z + 18);
    shots.push({
      from: v(fx, y + 9, fz),
      to: v(tx, y + 11, tz),
      lookAt: v(landmark.x, y + 6, landmark.z),
      seconds: 9,
    });
  }
  return shots;
}

/** The small base at the first landing. */
const BASE: [EntityKind, number, number][] = [
  ['refinery', 22, -6],
  ['reactor', -20, -4],
  ['barracks', -16, -26],
  ['factory', 20, -28],
];
/** Each bank's line at the crossing: kind, across, back. */
const LINES: [EntityKind, number, number][] = [
  ['tank', -2.5, 0],
  ['tank', 3, 2],
  ['ranger', -6, 3],
  ['ranger', -8.5, 5],
  ['rocket', 7, 4],
  ['ranger', 9.5, 6],
  ['lynx', 0, 8],
  ['howitzer', 0, 26],
];

/**
 * Starts every model download the attract scene needs at once, before the
 * (CPU-heavy) world build that would otherwise delay each request until its
 * component renders. Same URLs and loader as the components, so they hit the
 * loader cache.
 */
const preloaded = new Set<MapId>();
function preloadAttract(id: MapId) {
  if (preloaded.has(id)) return;
  preloaded.add(id);
  const design = MAPS[id];
  const urls = new Set<string>();
  for (const kind of ['hq', 'harvester', ...BASE.map((b) => b[0]), ...LINES.map((l) => l[0])])
    urls.add(modelPath(kind));
  for (const name of vegetationModels(design, true)) urls.add(modelUrl(`landscape/${name}`));
  for (const c of design.crossings)
    if (c.style !== 'ford') urls.add(modelUrl(`landscape/${BRIDGE_MODELS[c.style]}`));
  for (const p of design.props) if (p.kind !== 'ruin') urls.add(modelUrl(`props/${p.kind}`));
  for (const name of ['landscape/field_stores', 'landscape/field_fence', 'environment/gull'])
    urls.add(modelUrl(name));
  for (const n of [1, 2, 3]) urls.add(modelUrl(`ore/ironstone_${n}`));
  for (const url of urls) useLoader.preload(GLTFLoader, url, withMeshopt);
}

/** A small base at the first landing, and a firefight across the staged crossing. */
function stage(mapId: MapId, startedAt: number): Battle {
  const b = newBattle(startedAt, { seed: 947, mapId, enemyCount: 1 });
  joinBattle(b, { id: 'attract', name: 'Northern Command', culture: 'fjordborn' }, startedAt);
  b.hostileTraining = [];
  b.nextWaveAt = 1e12;
  const map = terrainFor(b);
  const home = map.baseAt(0);
  b.entities = b.entities.filter((e) => e.kind === 'hq');
  for (const [kind, x, z] of BASE)
    b.entities.push(makeEntity(b, kind, 'attract', 'blue', { x: home.x + x, z: home.z + z }));
  const harvester = makeEntity(b, 'harvester', 'attract', 'blue', { x: home.x + 28, z: home.z + 4 });
  harvester.order = 'harvest';
  b.entities.push(harvester);
  skirmish(b, stageCrossing(mapId));
  return b;
}

/** Tanks, infantry and a gun on either bank, holding and trading fire over the deck. */
function skirmish(b: Battle, c: CrossingDesign | null) {
  if (!c) return;
  const map = terrainFor(b);
  const sin = Math.sin(c.angle),
    cos = Math.cos(c.angle);
  const at = (across: number, along: number) => ({
    x: c.x + across * cos + along * sin,
    z: c.z - across * sin + along * cos,
  });
  // Close enough that every rifle and gun is in range across the deck.
  const reach = 9;
  for (const side of [1, -1] as const)
    for (const [kind, across, back] of LINES) {
      const p = at(across * side, side * (reach + back));
      if (!map.groundAt(p.x, p.z)) continue;
      const blue = side === 1;
      const e = makeEntity(b, kind, blue ? 'attract' : 'hostile', blue ? 'blue' : 'red', p);
      e.order = 'hold';
      e.angle = Math.atan2(c.x - p.x, c.z - p.z);
      b.entities.push(e);
    }
}

/**
 * The home-screen hero: a live render of a map with a scripted skirmish and the
 * design's cinematic dolly. No HUD, no Convex, no input; capped resolution and
 * paused while the tab is hidden.
 */
export function AttractScene({
  mapId,
  className,
  style,
  capture = false,
  onReady,
}: {
  mapId: string;
  className?: string;
  style?: CSSProperties;
  /** Render for a still (map art): full resolution. */
  capture?: boolean;
  /** Called with the map id once that map's first frame is complete (see SceneReady). */
  onReady?: (mapId: string) => void;
}) {
  const id: MapId = isMapId(mapId) ? mapId : DEFAULT_MAP_ID;
  // Downloads first, on the first render for this map (once per map).
  if (!capture) preloadAttract(id);
  const [scene, setScene] = useState(() => stage(id, 1000));
  const map = terrainFor(scene);
  const fog = useMemo(() => new OpenSky(null, map.bounds), [map.bounds]);
  const [orders] = useState(() => new LocalOrders());
  const home = map.baseAt(0);
  const focus = useMemo(() => ({ ...home, serial: 0 }), [home]);
  const shots = useMemo(() => attractShots(map, stageCrossing(id)), [map, id]);
  useEffect(() => {
    let battle = stage(id, 1000),
      round = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      round += TICK / 1000;
      const standing = (team: 'blue' | 'red') =>
        battle.entities.filter((e) => e.team === team && e.hp > 0 && e.kind !== 'hq').length;
      if (round > ROUND_SECONDS || standing('red') < 2 || battle.status !== 'active') {
        const next = stage(id, battle.tickAt + 20_000);
        battle = next;
        round = 0;
      }
      tickBattle(battle, battle.tickAt + TICK);
      setScene(structuredClone(battle));
    }, TICK);
    return () => window.clearInterval(timer);
  }, [id]);
  return (
    <div className={className} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}>
      <TacticalScene
        battle={scene}
        owner="attract"
        fog={fog}
        orders={orders}
        selected={[]}
        armed={false}
        placement={null}
        focus={focus}
        cinematic={shots}
        attract
        capture={capture}
        onReady={onReady}
        onPlacementHover={noop}
        onPlace={noop}
        onCancelPlacement={noop}
        onSelect={noop}
        onGround={noop}
        onEnemy={noop}
        onRally={noop}
        onBox={noop}
      />
    </div>
  );
}

export default AttractScene;
