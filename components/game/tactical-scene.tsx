'use client';
import { SURFACE_ATLAS, detailMaterial } from './surface-detail';
import { terrainFor } from '@/lib/tactical-terrain';
import { TerrainContext, useTerrain } from './terrain-context';

import {
  Component,
  createContext,
  memo,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type RefObject,
  useState,
  type ReactNode,
} from 'react';
import {
  Canvas,
  useFrame,
  useLoader,
  useThree,
  type ThreeEvent,
} from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withMeshopt } from '../../lib/gltf';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AURA_RADIUS,
  isAir,
  isHarvester,
  isUnit,
  siteFootprint,
  spec,
  TACTICAL_UNITS,
  type Battle,
  type BuildingKind,
  harvesterCapacity,
  producerKindsFor,
  speedScaleFor,
  visionScaleFor,
  type Deposit,
  type Entity,
  type Point,
  type TechSite,
  type TrainingOrder,
  type UnitCategory,
} from '@/lib/tactics';
import { SkyReflections } from './sky-reflections';
import { lampLevel, TacticalCombat } from './tactical-combat';
import { weaponFamily, WEAPON_PROFILES } from '@/lib/combat-presentation';
import { OreSeam } from './tactical-ore';
import { LandingStores } from './tactical-landscape';
import { CoastalLife, EnvironmentMotion } from './tactical-environment';
import { World, WorldClock } from './world/world';
import { BuildingAprons } from './world/aprons';
import { cultureArt } from '@/lib/culture-art';
import type { Culture } from '@/lib/cultures';
import {
  LocalOrders,
  UnitMotion,
  type MotionPose,
} from '@/lib/tactical-motion';
import { TacticalRouteGeometry } from '@/lib/tactical-route-geometry';
import { FogGrid, type Sight } from '@/lib/tactical-fog';
import type { Footprint } from '@/lib/tactical-placement';
import {
  AdaptiveFrameBudget,
  FrameMeasurements,
  MemoryMeasurements,
} from './tactical-performance';
import {
  CameraRig,
  cameraPosition,
  HOME_DISTANCE,
  HOME_YAW,
} from './tactical-camera';
import { batchEquipment } from '@/lib/tactical-model';
import {
  installShadowProxies,
  registerShadowProxies,
  withShadowProxies,
} from '@/lib/shadow-proxies';
import { resolveBattlefieldClick } from '@/lib/tactical-input';
import { isInsideView, sameKindTroops } from '@/lib/tactical-selection';
import { isOrbitGesture } from '@/lib/tactical-camera';
import { useRenderResolution } from './render-resolution';
import { PostProcessing } from './world/post-processing';
import { CaptureFlags } from './world/capture-flags';
import { AimCursor, StrikeEffects } from './superweapon-fx';
import { revealAreas, type SuperweaponKind } from '@/lib/tactical-superweapons';
import { ReconFlights, TechSites, siteEyes } from './world/tech-sites';
import { modelPath } from './world/models';
import { SceneReady } from './world/scene-ready';
import { ShadowCadence } from './world/shadow-cadence';
import { QUALITY_TIERS, renderTier } from '@/lib/frame-budget';
import type { HoveredStructure } from '@/lib/hovered-structure';
import { debugFlag } from './world/lighting';
import {
  LightAssetsContext,
  OverlaysContext,
  useOverlays,
} from './world/scene-mode';
import {
  constructionSites,
  emitters as worldEmitters,
  muzzles,
  unitBodies,
  type Emitter,
} from './world/fx-registry';
import {
  aimYawFor,
  animateRig,
  collectRig,
  type RigState,
} from '@/lib/unit-rig';
import { Director, useDirected } from './world/director';
import { lookParam } from './world/lighting';
import type { CameraShot } from '@/lib/maps/types';
import {
  buildAreas,
  buildRadius,
  footprint,
  hasExit,
  productionExit,
  snapPlacement,
  type PlaceableKind,
} from '@/lib/tactical-placement';
export type TacticalSceneProps = {
  battle: Battle;
  owner: string;
  /** Owned by the command screen so the minimap shares the same memory. */
  fog: FogGrid;
  /** Orders issued here, so troops and the ground marker respond before the server does. */
  orders: LocalOrders;
  selected: string[];
  armed: boolean;
  placement: {
    kind: PlaceableKind;
    position: Point | null;
    rotation: number;
    reason: string | null;
  } | null;
  onPlacementHover: (p: Point | null) => void;
  onPlace: (p: Point, touch: boolean) => void;
  onCancelPlacement: () => void;
  focus: Point & { serial: number; north?: boolean; distance?: number };
  /** Ground corners of the current view, for the minimap. */
  onViewport?: (corners: Point[]) => void;
  /** Space tapped without a drag: jump to the latest under-attack alert. */
  onSpaceTap?: () => void;
  onSelect: (ids: string[], additive: boolean) => void;
  onGround: (p: Point) => void;
  /** A charged superweapon is aiming: clicks fire it, a right click cancels. */
  aim?: { kind: SuperweaponKind; radius: number } | null;
  onAim?: (p: Point) => void;
  onCancelAim?: () => void;
  onEnemy: (id: string) => void;
  onRally: (id: string, p: Point) => void;
  /** Open troop tab: land clicks with nothing selected set that category's rally point. */
  rallyCategory?: UnitCategory | null;
  onRallyCategory?: (category: UnitCategory, p: Point) => void;
  onBox: (
    box: { x: number; y: number; width: number; height: number } | null,
  ) => void;
  /** The structure under a mouse or pen, for the hover card; touch keeps tap-to-select. */
  hovered?: HoveredStructure;
  /** Cinematic camera dolly (art review, attract mode); overrides the player camera while set. */
  cinematic?: CameraShot[] | null;
  /** Home-screen attract mode: no input or overlays, a lighter render budget. */
  attract?: boolean;
  /** Still capture (map art): no overlays and a generous render budget. */
  capture?: boolean;
  /** Called with the map id once the map's first frames have rendered with its models loaded. */
  onReady?: (mapId: string) => void;
};
/** Seconds between fog-of-war repaints. */
const FOG_INTERVAL = 0.1;
const flyHeight = (kind: Entity['kind']) =>
  kind === 'drone' ? 5 : kind === 'gunship' ? 7 : 0;
function buildingLayout(battle: Battle) {
  return JSON.stringify(
    battle.entities
      .filter((e) => !isUnit(e.kind))
      .map((e) => [e.kind, e.x, e.z, e.angle]),
  );
}
const FogContext = createContext<FogGrid | null>(null);
/** Re-renders only when a point moves between hidden, explored and visible. */
function useSight(p: Point) {
  const fog = useContext(FogContext);
  const [sight, setSight] = useState<Sight>(() => fog?.sight(p) ?? 'visible');
  const seen = useRef(-1);
  useFrame(() => {
    if (!fog || fog.version === seen.current) return;
    seen.current = fog.version;
    const next = fog.sight(p);
    setSight((s) => (s === next ? s : next));
  });
  return sight;
}
/**
 * Repaints the commander's sight grid ten times a second. The post chain reads
 * the grid and darkens every pixel by what the commander can see at that point
 * on the ground (depth-buffer based, so troops, trees and water are all covered).
 */
function FogOfWar({
  fog,
  battle,
  owner,
}: {
  fog: FogGrid;
  battle: Battle;
  owner: string;
}) {
  const live = useRef({ battle, owner, at: 0 });
  const pending = useRef(0);
  useEffect(() => {
    live.current = { battle, owner, at: performance.now() };
  }, [battle, owner]);
  useFrame((_, delta) => {
    // Eyes glide between repaints; the texture upload is the expensive part.
    pending.current += delta;
    if (pending.current >= FOG_INTERVAL || fog.version === 0) {
      const { battle: b, at } = live.current;
      fog.update(
        b.entities,
        live.current.owner,
        pending.current,
        visionScaleFor(b, live.current.owner),
        // Firestorm glare, held sites and recon planes; planes fly
        // between ticks, so their sight follows the local clock.
        [
          ...revealAreas(b),
          ...siteEyes(b, b.tickAt + (performance.now() - at)),
        ],
      );
      pending.current = 0;
    }
  });
  return null;
}
/** The static world (terrain, water, forests, crossings, props); decoration gives way to buildings. */
const Battlefield = memo(
  function Battlefield({ battle, rich }: { battle: Battle; rich: boolean }) {
    const map = useTerrain();
    const layout = buildingLayout(battle);
    // Decoration gives way to tech sites too; they never move.
    const sites = JSON.stringify(
      (battle.sites ?? []).map(({ kind, x, z, angle }) => ({
        kind,
        x,
        z,
        angle,
      })),
    );
    const occupied = useMemo(() => {
      const buildings = JSON.parse(layout) as [
        BuildingKind,
        number,
        number,
        number,
      ][];
      return [
        ...(JSON.parse(sites) as TechSite[]).map(siteFootprint),
        ...buildings.map(([kind, x, z, angle]) =>
          footprint(kind, { x, z }, angle),
        ),
      ];
    }, [layout, sites]);
    return (
      <>
        <World map={map} occupied={occupied} rich={rich} />
        <BuildingAprons map={map} aprons={occupied} />
        <LandingStores battle={battle} />
      </>
    );
  },
  (a, b) =>
    a.rich === b.rich &&
    a.battle.mapId === b.battle.mapId &&
    buildingLayout(a.battle) === buildingLayout(b.battle),
);
/** The latest server state, read by frame loops without re-rendering every piece of equipment each tick. */
type LiveBattle = {
  tickAt: number;
  entities: Map<string, Entity>;
  /** Local clock (seconds) when this tick arrived, to estimate the server's now. */
  receivedAt: number;
  training: TrainingOrder[];
};
/** Which structure's doors open while a unit category is in production. */
const PRODUCED_AT: Record<string, string> = {
  infantry: 'barracks',
  vehicle: 'factory',
  air: 'airfield',
};
/**
 * A piece of equipment re-renders only when something in its React tree
 * changes (kind, paint, selection, construction). Positions, health, cargo,
 * recoil and gait follow the server through the live ref inside useFrame, so
 * a 250 ms tick with 500 entities does not reconcile 500 subtrees.
 */
type EquipmentProps = {
  entity: Entity;
  selected: boolean;
  showRally: boolean;
  serverAt: number;
  color: string;
  active: boolean;
  obstacles: Footprint[];
  cargoCapacity: number;
  speedScale: number;
  orders: LocalOrders;
  hovered?: HoveredStructure;
};
function sameEquipment(a: EquipmentProps, b: EquipmentProps) {
  if (b.entity.readyAt > 0 || a.entity.readyAt > 0) return false;
  return (
    a.selected === b.selected &&
    a.showRally === b.showRally &&
    a.serverAt === b.serverAt &&
    a.color === b.color &&
    a.active === b.active &&
    a.obstacles === b.obstacles &&
    a.cargoCapacity === b.cargoCapacity &&
    a.speedScale === b.speedScale &&
    a.orders === b.orders &&
    a.hovered === b.hovered &&
    a.entity.id === b.entity.id &&
    a.entity.kind === b.entity.kind &&
    a.entity.owner === b.entity.owner &&
    a.entity.team === b.entity.team &&
    a.entity.rally?.x === b.entity.rally?.x &&
    a.entity.rally?.z === b.entity.rally?.z
  );
}
type StructureParts = {
  seed: number;
  flags: { node: THREE.Object3D; ry: number; rz: number }[];
  dishes: THREE.Object3D[];
  doors: { node: THREE.Object3D; y: number }[];
};
function animateStructure(
  parts: StructureParts,
  now: number,
  delta: number,
  working: boolean,
) {
  for (let i = 0; i < parts.flags.length; i++) {
    const f = parts.flags[i];
    f.node.rotation.y = f.ry + Math.sin(now * 2.3 + parts.seed + i) * 0.22;
    f.node.rotation.z = f.rz + Math.sin(now * 3.7 + parts.seed) * 0.05;
  }
  for (const dish of parts.dishes) dish.rotation.y = now * 0.9 + parts.seed;
  for (const d of parts.doors)
    d.node.position.y +=
      ((working ? d.y + 2.4 : d.y) - d.node.position.y) *
      (1 - Math.exp(-2 * delta));
}

/** Point every material's clipping at the construction plane (or clear it). */
function clipMaterials(materials: THREE.Material[], plane: THREE.Plane | null) {
  const next = plane ? [plane] : null;
  for (const m of materials) {
    if ((m.clippingPlanes?.[0] ?? null) === plane) continue;
    m.clippingPlanes = next;
    m.clipShadows = true;
    m.needsUpdate = true;
  }
}
const SCAFFOLD_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#b08a5a',
  roughness: 0.85,
});
/** Timber scaffolding around a rising structure: poles, ledgers and braces. */
function Scaffold({ box }: { box: THREE.Box3 }) {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const minX = box.min.x - 0.5,
      maxX = box.max.x + 0.5,
      minZ = box.min.z - 0.5,
      maxZ = box.max.z + 0.5;
    const height = Math.max(2, box.max.y + 0.4);
    const pole = (x: number, z: number) => {
      const g = new THREE.BoxGeometry(0.16, height, 0.16);
      g.translate(x, height / 2, z);
      parts.push(g);
    };
    const xs = [minX, (minX + maxX) / 2, maxX],
      zs = [minZ, (minZ + maxZ) / 2, maxZ];
    for (const x of xs) for (const z of [minZ, maxZ]) pole(x, z);
    for (const z of zs) for (const x of [minX, maxX]) pole(x, z);
    for (let y = 1.6; y < height; y += 1.8) {
      for (const z of [minZ, maxZ]) {
        const g = new THREE.BoxGeometry(maxX - minX, 0.12, 0.12);
        g.translate((minX + maxX) / 2, y, z);
        parts.push(g);
      }
      for (const x of [minX, maxX]) {
        const g = new THREE.BoxGeometry(0.12, 0.12, maxZ - minZ);
        g.translate(x, y, (minZ + maxZ) / 2);
        parts.push(g);
      }
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }, [box]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      material={SCAFFOLD_MATERIAL}
      castShadow
      raycast={() => {}}
    />
  );
}
/** The reach of an aid station or field workshop, draped over the ground. */
function AuraRing({
  x,
  z,
  heightAt,
}: {
  x: number;
  z: number;
  heightAt: (x: number, z: number) => number;
}) {
  const points = useMemo(
    () =>
      Array.from({ length: 97 }, (_, i) => {
        const a = (i / 96) * Math.PI * 2,
          px = x + Math.sin(a) * AURA_RADIUS,
          pz = z + Math.cos(a) * AURA_RADIUS;
        return [px, heightAt(px, pz) + 0.35, pz] as [number, number, number];
      }),
    [x, z, heightAt],
  );
  return (
    <Line
      points={points}
      color="#71e8da"
      lineWidth={1.5}
      dashed
      dashSize={1.6}
      gapSize={1}
      transparent
      opacity={0.75}
    />
  );
}
const Equipment = memo(function Equipment({
  entity,
  color,
  selected,
  showRally,
  live,
  serverAt,
  active,
  obstacles,
  cargoCapacity,
  speedScale,
  orders,
  hovered,
}: {
  entity: Entity;
  color: string;
  selected: boolean;
  /** Draw the rally line even when unselected (its troop tab is open). */
  showRally: boolean;
  live: RefObject<LiveBattle>;
  orders: LocalOrders;
  /** Only construction sites receive the live tick here, for their countdown. */
  serverAt: number;
  active: boolean;
  obstacles: Footprint[];
  cargoCapacity: number;
  speedScale: number;
  hovered?: HoveredStructure;
}) {
  const e = entity;
  const map = useTerrain();
  const { heightAt } = map;
  const overlays = useOverlays();

  const gltf = useLoader(GLTFLoader, modelPath(e.kind), withMeshopt);
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const asset = useMemo(() => {
    const batched = batchEquipment(gltf.scene);
    const model = (
        debugFlag('noproxy') ? batched : withShadowProxies(batched)
      ).clone(true),
      materials: THREE.MeshStandardMaterial[] = [];
    model.traverse((n) => {
      if (n instanceof THREE.Mesh && n.userData.shadowProxy) {
        // Own copy: construction clips the shadow with the building.
        n.material = n.material.clone();
        materials.push(n.material);
      } else if (n instanceof THREE.Mesh) {
        n.castShadow = !n.userData.shadowByProxy;
        n.receiveShadow = true;
        n.material = n.material.clone();
        materials.push(n.material);
        detailMaterial(
          n.material,
          atlas,
          n.material.name === 'culture_trim' ? 0.15 : 0.35,
        );
        if (n.material.name === 'culture_trim') {
          n.material.color.set(color);
          n.material.emissive.set(color);
          n.material.emissiveIntensity = 0.12;
        }
        if (/lamp|light|window_glow/.test(n.material.name)) {
          n.material.emissive.set('#ffc46b');
          n.material.emissiveIntensity = 2.2;
        }
      }
    });
    const seed = e.id
      .split('')
      .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 17);
    const unit = isUnit(e.kind);
    // Units and armed structures (turrets, bunkers, flak) carry a rig.
    const rig =
      unit || model.getObjectByName('turret') ? collectRig(model, seed) : null;
    const family = weaponFamily(e.kind);
    if (rig && family)
      rig.shotInterval = WEAPON_PROFILES[family].interval / 1000;
    const flags: THREE.Object3D[] = [],
      dishes: THREE.Object3D[] = [],
      doors: THREE.Object3D[] = [],
      found: Emitter[] = [];
    model.traverse((node) => {
      if (node.name.startsWith('flag')) flags.push(node);
      else if (node.name.startsWith('radar_dish')) dishes.push(node);
      else if (node.name.startsWith('door')) doors.push(node);
      else if (node.name.startsWith('smoke_'))
        found.push({ node, kind: 'smoke', strength: 2.2 });
      else if (node.name.startsWith('light_'))
        found.push({ node, kind: 'light', strength: 1.6 });
    });
    const box = new THREE.Box3().setFromObject(model, true);
    return {
      model,
      materials,
      rig,
      seed,
      flags: flags.map((node) => ({
        node,
        ry: node.rotation.y,
        rz: node.rotation.z,
      })),
      dishes,
      doors: doors.map((node) => ({ node, y: node.position.y })),
      emitters: found,
      height: Math.max(1, box.max.y),
      box,
    };
  }, [gltf, color, atlas, e.id, e.kind]);
  useEffect(() => () => asset.materials.forEach((m) => m.dispose()), [asset]);
  const gl = useThree((state) => state.gl);
  // A structure that falls or leaves sight under the pointer gets no pointerout.
  useEffect(() => () => hovered?.release(entity.id), [hovered, entity.id]);
  useEffect(() => {
    installShadowProxies(gl);
    return registerShadowProxies(asset.model);
  }, [gl, asset]);
  // Register the barrel tip and building emitters with the effect systems.
  useEffect(() => {
    const muzzle = asset.rig?.muzzle;
    if (muzzle) muzzles.set(entity.id, muzzle);
    if (asset.emitters.length) worldEmitters.set(entity.id, asset.emitters);
    return () => {
      if (muzzles.get(entity.id) === muzzle) muzzles.delete(entity.id);
      worldEmitters.delete(entity.id);
      constructionSites.delete(entity.id);
    };
  }, [asset, entity.id]);
  // Construction rises through a clipping plane from the ground up.
  const [clip] = useState(
    () => new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6),
  );
  useEffect(
    () => clipMaterials(asset.materials, e.readyAt > 0 ? clip : null),
    [asset, clip, e.readyAt],
  );
  // Frame loops read these through refs; the render never mutates them.
  const parts = useRef({ asset, clip });
  useEffect(() => {
    parts.current = { asset, clip };
  }, [asset, clip]);
  const [spawn] = useState(() => ({
    position: [e.x, heightAt(e.x, e.z) + flyHeight(e.kind), e.z] as [
      number,
      number,
      number,
    ],
    angle: e.angle,
  }));
  const motion = useRef<UnitMotion | null>(null);
  const answered = useRef({ serial: 0, cancelled: false });
  const selectionRing = useRef<THREE.Group>(null);
  const scaffold = useRef<THREE.Group>(null);
  const rigState = useRef<RigState>({
    time: 0,
    dt: 0,
    speed: 0,
    turnRate: 0,
    aimYaw: null,
    firedAt: Infinity,
    cargo: 0,
    moving: false,
  });
  const root = useRef<THREE.Group>(null),
    health = useRef<THREE.Group>(null);
  const healthFill = useRef<THREE.Mesh>(null);
  // Carried flags ride on the troop's interpolated pose.
  useEffect(() => {
    const body = root.current;
    if (!body || !isUnit(entity.kind)) return;
    unitBodies.set(entity.id, body);
    return () => {
      if (unitBodies.get(entity.id) === body) unitBodies.delete(entity.id);
    };
  }, [entity.id, entity.kind]);

  useFrame((state, delta) => {
    if (!root.current) return;
    const { asset, clip } = parts.current;
    const rs = rigState.current;
    // Follow the newest server snapshot even when this subtree was not re-rendered.
    const e = live.current.entities.get(entity.id) ?? entity;
    const serverAt = live.current.tickAt;
    const now = state.clock.elapsedTime;
    let angle = e.angle;
    let pose: MotionPose | null = null;
    if (isUnit(e.kind)) {
      if (!motion.current || motion.current.speedScale !== speedScale)
        motion.current = new UnitMotion(e, serverAt, now, speedScale, map);
      const local = orders.units.get(e.id);
      if (local && local.serial !== answered.current.serial) {
        answered.current = { serial: local.serial, cancelled: false };
        motion.current.anticipate(local.point, now, local.order);
      }
      if (local?.cancelled && !answered.current.cancelled) {
        answered.current.cancelled = true;
        motion.current.cancelAnticipation(now);
      }
      pose = motion.current.sample(e, serverAt, now, active, obstacles);
      const hover = isAir(e.kind) ? flyHeight(e.kind) : 0;
      root.current.position.set(
        pose.x,
        heightAt(pose.x, pose.z) + hover,
        pose.z,
      );
      angle = pose.angle;
    } else {
      root.current.position.set(e.x, heightAt(e.x, e.z), e.z);
    }
    // Construction: the model rises through a clipping plane, scaffold and dust around it.
    const building = e.readyAt > 0;
    const progress = building
      ? Math.max(
          0,
          Math.min(
            1,
            1 - (e.readyAt - serverAt) / (spec(e.kind).seconds * 1000),
          ),
        )
      : 1;
    if (building) {
      clip.constant =
        root.current.position.y + 0.05 + progress * asset.height * 1.02;
      const site = constructionSites.get(e.id) ?? {
        x: 0,
        z: 0,
        y: 0,
        radius: 2,
      };
      site.x = root.current.position.x;
      site.z = root.current.position.z;
      site.y = root.current.position.y;
      site.radius = Math.max(2, (asset.box.max.x - asset.box.min.x) / 2);
      constructionSites.set(e.id, site);
    } else if (constructionSites.has(e.id)) constructionSites.delete(e.id);
    if (scaffold.current) {
      scaffold.current.visible = building;
      scaffold.current.scale.y = Math.max(
        0.05,
        Math.min(1, progress * 1.15 + 0.1),
      );
    }
    let turn = angle - root.current.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const turnResponse = isUnit(e.kind)
      ? TACTICAL_UNITS[e.kind].category === 'infantry'
        ? 12
        : isAir(e.kind)
          ? 5
          : 7
      : 7;
    root.current.rotation.y += turn * (1 - Math.exp(-turnResponse * delta));
    const rig = asset.rig;
    if (rig) {
      const serverNow =
        live.current.tickAt +
        (performance.now() / 1000 - live.current.receivedAt) * 1000;
      const since =
        e.firedAt > 0 ? Math.max(0, (serverNow - e.firedAt) / 1000) : Infinity;
      const hullAngle = pose ? pose.angle : e.angle;
      const x = pose ? pose.x : e.x,
        z = pose ? pose.z : e.z;
      rs.time = now;
      rs.dt = delta;
      rs.speed = pose?.speed ?? 0;
      rs.turnRate = pose?.turnRate ?? 0;
      rs.moving = pose?.moving ?? false;
      rs.firedAt = since;
      rs.aimYaw =
        since < 2.5 && (e.shotX || e.shotZ)
          ? aimYawFor(x, z, hullAngle, e.shotX, e.shotZ)
          : null;
      rs.cargo = (e.cargo ?? 0) / Math.max(1, cargoCapacity);
      rs.construction = progress;
      animateRig(rig, rs);
    }
    // Structures: flags wave, radar dishes turn, factory doors lift while working.
    animateStructure(
      asset,
      now,
      delta,
      asset.doors.length > 0 &&
        live.current.training.some(
          (t) =>
            t.owner === e.owner &&
            t.readyAt > 0 &&
            PRODUCED_AT[TACTICAL_UNITS[t.kind].category] === e.kind,
        ),
    );
    if (health.current) {
      health.current.position.copy(root.current.position);
      health.current.position.y += isAir(e.kind) ? 2 : isUnit(e.kind) ? 3.6 : 6;
      health.current.quaternion.copy(state.camera.quaternion);
    }
    if (healthFill.current) {
      const ratio = Math.max(0, Math.min(1, e.hp / spec(e.kind).hp)),
        width = isUnit(e.kind) ? 2.5 : 4;
      healthFill.current.scale.x = ratio;
      // Bars appear on the selected and the wounded; a healthy army stays uncluttered.
      if (health.current)
        health.current.visible = overlays && (selected || ratio < 0.999);
      healthFill.current.position.x = (-width * (1 - ratio)) / 2;
    }
    if (selectionRing.current)
      selectionRing.current.position.set(
        root.current.position.x,
        heightAt(root.current.position.x, root.current.position.z) + 0.1,
        root.current.position.z,
      );
  });
  const unit = isUnit(e.kind),
    radius = isUnit(e.kind)
      ? TACTICAL_UNITS[e.kind].category === 'infantry'
        ? 1
        : e.kind === 'jotun'
          ? 3.4
          : 2.8
      : 4.4;
  const hoverable = !unit && overlays ? hovered : undefined;
  const point = (event: ThreeEvent<PointerEvent>) => {
    // The nearest structure wins; the ones behind it read as pointer-out.
    event.stopPropagation();
    if (event.pointerType === 'touch') return;
    hoverable?.point(
      event.clientX,
      event.clientY,
      gl.domElement.getBoundingClientRect(),
    );
    hoverable?.set(e.id);
  };
  return (
    <group>
      <group
        ref={root}
        position={spawn.position}
        rotation={[0, spawn.angle, 0]}
        userData={{ tacticalId: e.id }}
        onPointerOver={hoverable && point}
        onPointerMove={hoverable && point}
        onPointerOut={hoverable && (() => hoverable.release(e.id))}
      >
        <primitive object={asset.model} dispose={null} />
        {e.readyAt > 0 && (
          <group ref={scaffold}>
            <Scaffold box={asset.box} />
          </group>
        )}
      </group>
      {selected && unit && (
        <SelectedRoute id={e.id} live={live} rendered={root} />
      )}
      {overlays && (selected || e.team === 'red') && (
        <group
          ref={selectionRing}
          position={[e.x, heightAt(e.x, e.z) + 0.1, e.z]}
        >
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[radius - 0.09, radius, 40]} />
            <meshBasicMaterial
              color={e.team === 'red' ? '#f27c6e' : '#71e8da'}
              transparent
              opacity={selected ? 0.95 : 0.5}
            />
          </mesh>
        </group>
      )}
      {selected &&
        !e.readyAt &&
        (e.kind === 'hospital' || e.kind === 'workshop') && (
          <AuraRing x={e.x} z={e.z} heightAt={heightAt} />
        )}
      {(selected || showRally) && e.rally && (
        <group>
          <Line
            points={[
              [e.x, heightAt(e.x, e.z) + 0.3, e.z],
              [e.rally.x, heightAt(e.rally.x, e.rally.z) + 0.3, e.rally.z],
            ]}
            color="#e5c77a"
            lineWidth={1}
            dashed
            dashSize={1.2}
            gapSize={0.8}
            transparent
            opacity={0.7}
          />
          <mesh
            position={[
              e.rally.x,
              heightAt(e.rally.x, e.rally.z) + 1.4,
              e.rally.z,
            ]}
          >
            <coneGeometry args={[0.5, 1.4, 4]} />
            <meshBasicMaterial color="#e5c77a" />
          </mesh>
        </group>
      )}
      <group
        ref={health}
        visible={overlays && selected}
        position={[
          e.x,
          heightAt(e.x, e.z) +
            (isAir(e.kind) ? flyHeight(e.kind) + 2 : unit ? 3.6 : 6),
          e.z,
        ]}
      >
        <mesh>
          <planeGeometry args={[unit ? 2.5 : 4, 0.16]} />
          <meshBasicMaterial color="#0d2426" depthTest={false} />
        </mesh>
        <mesh
          ref={healthFill}
          position={[
            (-(unit ? 2.5 : 4) * (1 - e.hp / spec(e.kind).hp)) / 2,
            0,
            0.01,
          ]}
          scale={[Math.max(0, e.hp / spec(e.kind).hp), 1, 1]}
        >
          <planeGeometry args={[unit ? 2.5 : 4, 0.12]} />
          <meshBasicMaterial
            color={e.team === 'red' ? '#ea796a' : '#86d3ad'}
            depthTest={false}
          />
        </mesh>
      </group>
      {overlays && e.readyAt > 0 && (
        <Html center position={[e.x, 5, e.z]} zIndexRange={[8, 1]}>
          <span className="tac-world-tag">
            {spec(e.kind).name} ·{' '}
            {Math.max(1, Math.ceil((e.readyAt - serverAt) / 1000))}s
          </span>
        </Html>
      )}
    </group>
  );
}, sameEquipment);
/** Route overlays follow rendered positions without reconciling troop subtrees each tick. */
function SelectedRoute({
  id,
  live,
  rendered,
}: {
  id: string;
  live: RefObject<LiveBattle>;
  rendered: RefObject<THREE.Group | null>;
}) {
  const { heightAt } = useTerrain();
  const [route] = useState(() => {
    const geometry = new TacticalRouteGeometry();
    const material = new THREE.LineBasicMaterial({
      color: '#9cdfc2',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.raycast = () => {};
    return { geometry, material, line };
  });
  const destination = useRef<THREE.Mesh>(null);
  const routeRef =
    useRef<THREE.Line<TacticalRouteGeometry, THREE.LineBasicMaterial>>(null);
  useEffect(
    () => () => {
      route.geometry.dispose();
      route.material.dispose();
    },
    [route],
  );
  useFrame(() => {
    const line = routeRef.current;
    if (!line) return;
    const entity = live.current.entities.get(id);
    const position = rendered.current?.position;
    const path = entity?.path ?? [];
    line.visible = !!position && path.length > 0;
    if (position)
      line.geometry.update(
        { x: position.x, y: heightAt(position.x, position.z), z: position.z },
        path,
        heightAt,
      );
    const end = path.at(-1);
    if (destination.current) {
      if (
        end &&
        (!destination.current.visible ||
          destination.current.position.x !== end.x ||
          destination.current.position.z !== end.z)
      )
        destination.current.position.set(
          end.x,
          heightAt(end.x, end.z) + 0.15,
          end.z,
        );
      destination.current.visible = !!end;
    }
  });
  return (
    <>
      <primitive ref={routeRef} object={route.line} dispose={null} />
      <mesh ref={destination} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.65, 0.9, 32]} />
        <meshBasicMaterial color="#9cdfc2" depthWrite={false} />
      </mesh>
    </>
  );
}
const PING_SECONDS = 0.7;
/** A ground marker at the ordered point, shown on the frame the order is given. */
function OrderPing({ orders }: { orders: LocalOrders }) {
  const { heightAt } = useTerrain();
  const ring =
    useRef<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>(null);
  const shown = useRef({ serial: 0, at: -Infinity });
  useFrame(({ clock }) => {
    const mesh = ring.current,
      ping = orders.ping;
    if (!mesh) return;
    const now = clock.elapsedTime;
    if (ping && ping.serial !== shown.current.serial) {
      shown.current = { serial: ping.serial, at: now };
      mesh.position.set(
        ping.point.x,
        heightAt(ping.point.x, ping.point.z) + 0.2,
        ping.point.z,
      );
      mesh.material.color.set(
        ping.order === 'attackMove' ? '#ff8a3d' : '#9cdfc2',
      );
    }
    const t = (now - shown.current.at) / PING_SECONDS;
    mesh.visible = t >= 0 && t < 1;
    if (!mesh.visible) return;
    mesh.scale.setScalar(1.6 - 0.9 * t);
    mesh.material.opacity = 0.9 * (1 - t);
  });
  return (
    <mesh
      ref={ring}
      visible={false}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => {}}
    >
      <ringGeometry args={[0.9, 1.25, 32]} />
      <meshBasicMaterial transparent depthWrite={false} />
    </mesh>
  );
}
/** Selectable stand-in while this entity's model loads or if its download fails. */
function EquipmentPlaceholder({
  entity: e,
  color,
  selected,
  failed = false,
}: {
  entity: Entity;
  color: string;
  selected: boolean;
  failed?: boolean;
}) {
  const { heightAt } = useTerrain();
  const unit = isUnit(e.kind);
  const box = unit
    ? { minX: -0.75, maxX: 0.75, minZ: -0.75, maxZ: 0.75 }
    : footprint(e.kind as BuildingKind, { x: 0, z: 0 }, 0);
  const height = unit ? 1.5 : 2;
  return (
    <group
      position={[e.x, heightAt(e.x, e.z) + flyHeight(e.kind), e.z]}
      rotation={[0, e.angle, 0]}
      userData={{ tacticalId: e.id }}
    >
      <mesh
        position={[
          (box.minX + box.maxX) / 2,
          height / 2,
          (box.minZ + box.maxZ) / 2,
        ]}
      >
        <boxGeometry
          args={[box.maxX - box.minX, height, box.maxZ - box.minZ]}
        />
        <meshBasicMaterial
          color={selected ? '#71e8da' : color}
          transparent
          opacity={0.5}
        />
      </mesh>
      {selected && (
        <Html
          center
          position={[0, height + 1, 0]}
          zIndexRange={[8, 1]}
          style={{ pointerEvents: 'none' }}
        >
          <span className="tac-world-tag">
            {spec(e.kind).name} ·{' '}
            {failed ? 'Model unavailable' : 'Loading model…'}
          </span>
        </Html>
      )}
    </group>
  );
}
function BuildBoundary({
  position,
  radius,
  emphasized = false,
  planned = false,
  color = '#7aedd0',
}: {
  position: Point;
  radius: number;
  emphasized?: boolean;
  planned?: boolean;
  color?: string;
}) {
  const map = useTerrain();
  const { heightAt } = map;

  const points = useMemo(
    () =>
      Array.from({ length: 129 }, (_, i) => {
        const a = (i / 128) * Math.PI * 2,
          x = position.x + Math.cos(a) * radius,
          z = position.z + Math.sin(a) * radius;
        return [x, Math.max(0.4, heightAt(x, z) + 0.2), z] as [
          number,
          number,
          number,
        ];
      }),
    [position.x, position.z, radius, heightAt],
  );
  return (
    <Line
      points={points}
      color={color}
      transparent
      opacity={emphasized ? 0.9 : 0.35}
      dashed={planned || !emphasized}
      dashSize={planned ? 2 : 1}
      gapSize={0.7}
      lineWidth={emphasized ? 2 : 1}
    />
  );
}
/** Only the optional 3D ghost suspends; placement outlines and controls stay visible. */
function PlacementModel({
  kind,
  color,
}: {
  kind: PlaceableKind;
  color: string;
}) {
  const gltf = useLoader(GLTFLoader, modelPath(kind), withMeshopt);
  const asset = useMemo(() => {
    const model = batchEquipment(gltf.scene).clone(true),
      material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      });
    model.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.material = material;
        n.castShadow = false;
        n.receiveShadow = false;
        n.raycast = () => {};
      }
    });
    return { model, material };
  }, [gltf, color]);
  useEffect(() => () => asset.material.dispose(), [asset]);
  return <primitive object={asset.model} dispose={null} />;
}
function PlacementPreview({
  placement,
}: {
  placement: NonNullable<TacticalSceneProps['placement']>;
}) {
  const map = useTerrain();
  const { heightAt } = map;

  const color = placement.reason ? '#f48676' : '#7aedd0';
  const p = placement.position,
    angle = (placement.rotation * Math.PI) / 2;
  const box = p ? footprint(placement.kind, p, angle) : null;
  const exit =
    p && hasExit(placement.kind)
      ? productionExit({ ...p, kind: placement.kind, angle })
      : null;
  return (
    <group>
      {p && placement.kind === 'outpost' && (
        <BuildBoundary
          position={p}
          radius={buildRadius('outpost')}
          emphasized
          planned
          color={color}
        />
      )}
      {p && box && (
        <>
          <group
            position={[p.x, Math.max(0.65, heightAt(p.x, p.z)), p.z]}
            rotation={[0, angle, 0]}
          >
            <AssetBoundary key={placement.kind} fallback={null}>
              <Suspense fallback={null}>
                <PlacementModel kind={placement.kind} color={color} />
              </Suspense>
            </AssetBoundary>
          </group>
          <mesh
            position={[
              (box.minX + box.maxX) / 2,
              Math.max(0.65, heightAt(p.x, p.z)) + 0.09,
              (box.minZ + box.maxZ) / 2,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[box.maxX - box.minX, box.maxZ - box.minZ]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.23}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={[
              [box.minX, box.minZ],
              [box.maxX, box.minZ],
              [box.maxX, box.maxZ],
              [box.minX, box.maxZ],
              [box.minX, box.minZ],
            ].map(([x, z]) => [
              x,
              Math.max(0.65, heightAt(p.x, p.z)) + 0.12,
              z,
            ])}
            color={color}
            lineWidth={2}
          />
          <Html
            position={[p.x, Math.max(0.65, heightAt(p.x, p.z)) + 9, p.z]}
            center
            zIndexRange={[45, 30]}
            style={{ pointerEvents: 'none' }}
          >
            <output
              className={`tac-placement-label ${placement.reason ? 'blocked' : ''}`}
            >
              {placement.reason ?? 'Click to build · R to rotate'}
            </output>
          </Html>
          {exit && (
            <Line
              points={[
                [p.x, 1.1, p.z],
                [exit.x, 1.1, exit.z],
              ]}
              color={color}
              lineWidth={2}
              dashed
              dashSize={0.8}
              gapSize={0.4}
            />
          )}
        </>
      )}
    </group>
  );
}

/** Mineral outcrops remain walkable harvest targets and thin out as reserves are mined. */
const OreFields = memo(
  function OreFields({ deposits }: { deposits: Deposit[] }) {
    return (
      <group>
        {deposits.map((d) => (
          <OreField key={d.id} deposit={d} />
        ))}
      </group>
    );
  },
  (a, b) =>
    a.deposits.length === b.deposits.length &&
    a.deposits.every(
      (d, i) =>
        d.id === b.deposits[i].id &&
        d.amount > 0 === b.deposits[i].amount > 0 &&
        Math.round(d.amount / 50) === Math.round(b.deposits[i].amount / 50),
    ),
);
function OreField({ deposit }: { deposit: Deposit }) {
  const sight = useSight(deposit);
  return <OreSeam deposit={deposit} sight={sight} />;
}
function Commands({
  props,
  aimAt,
}: {
  props: TacticalSceneProps;
  /** Where the superweapon cursor rests, written here and read by the aim ring. */
  aimAt: RefObject<Point | null>;
}) {
  const map = useTerrain();
  const { heightAt } = map;

  const { gl, camera, scene } = useThree();
  const live = useRef(props);
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const project = useRef<((x: number, y: number) => Point | null) | null>(null);
  useEffect(() => {
    live.current = props;
  }, [props]);
  useEffect(() => {
    const canvas = gl.domElement;
    let down: {
      x: number;
      y: number;
      button: number;
      shift: boolean;
      pointerId: number;
      touch: boolean;
    } | null = null;
    // A Ctrl/⌘-click that may turn out to be an orbit drag rather than a click.
    let tap: {
      x: number;
      y: number;
      pointerId: number;
      shift: boolean;
    } | null = null;
    const pointers = new Set<number>();
    const point = (x: number, y: number, hitTest = true) => {
      const r = canvas.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((x - r.left) / r.width) * 2 - 1,
          (-(y - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const p = new THREE.Vector3();
      const ground = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.65),
        p,
      )
        ? { x: p.x, z: p.z }
        : null;
      let id: string | undefined;
      const selectable: THREE.Object3D[] = [];
      if (hitTest)
        scene.traverseVisible((o) => {
          if (o.userData.tacticalId) selectable.push(o);
        });
      for (const hit of hitTest ? ray.intersectObjects(selectable, true) : []) {
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o.userData.tacticalId) {
            id = o.userData.tacticalId;
            break;
          }
          o = o.parent;
        }
        if (id) break;
      }
      return { ground, id };
    };
    project.current = (x, y) => point(x, y, false).ground;
    // Where each entity's rendered model sits in normalized device coordinates.
    const projector = () => {
      const rendered = new Map<string, THREE.Object3D>();
      scene.traverseVisible((o) => {
        if (o.userData.tacticalId) rendered.set(o.userData.tacticalId, o);
      });
      return (u: Entity) => {
        const o = rendered.get(u.id);
        return (
          o
            ? o.getWorldPosition(new THREE.Vector3())
            : new THREE.Vector3(u.x, heightAt(u.x, u.z), u.z)
        ).project(camera);
      };
    };
    // Double-click or Ctrl/⌘-click: every ready troop of the clicked kind in view.
    const selectKind = (x: number, y: number, additive: boolean) => {
      const { battle, owner } = live.current,
        id = point(x, y).id,
        anchor = id ? battle.entities.find((u) => u.id === id) : undefined;
      if (!anchor) return;
      const ndc = projector(),
        ids = sameKindTroops({
          entities: battle.entities,
          owner,
          anchor,
          visible: (u) => isInsideView(ndc(u)),
        });
      if (ids.length) live.current.onSelect(ids, additive);
    };
    const start = (e: PointerEvent) => {
      if (e.pointerType === 'touch') cursor.current = null;
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        down = null;
        cursor.current = null;
        live.current.onBox(null);
        return;
      }
      tap =
        e.button === 0 &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.pointerType !== 'touch' &&
        !live.current.placement &&
        !live.current.aim &&
        !live.current.armed
          ? {
              x: e.clientX,
              y: e.clientY,
              pointerId: e.pointerId,
              shift: e.shiftKey,
            }
          : null;
      // Camera gestures must not enter selection, placement or order handling.
      if (
        e.button === 1 ||
        isOrbitGesture(e) ||
        e.altKey ||
        (e.button === 0 && canvas.dataset.grab !== undefined)
      ) {
        down = null;
        live.current.onBox(null);
        return;
      }
      down = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        shift: e.shiftKey,
        pointerId: e.pointerId,
        touch: e.pointerType === 'touch',
      };
      if (e.button === 0) canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (pointers.size > 1) return;
      cursor.current = { x: e.clientX, y: e.clientY };
      if (live.current.aim) {
        aimAt.current = point(e.clientX, e.clientY, false).ground;
        return;
      }
      if (live.current.placement) {
        live.current.onPlacementHover(
          point(e.clientX, e.clientY, false).ground,
        );
        return;
      }
      if (!down || down.button !== 0 || down.touch) return;
      const rect = canvas.getBoundingClientRect();
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7)
        live.current.onBox({
          x: Math.min(down.x, e.clientX) - rect.left,
          y: Math.min(down.y, e.clientY) - rect.top,
          width: Math.abs(e.clientX - down.x),
          height: Math.abs(e.clientY - down.y),
        });
    };
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (tap?.pointerId === e.pointerId) {
        const t = tap;
        tap = null;
        // A Ctrl/⌘ drag rotated the camera; only a still click selects.
        if (Math.hypot(e.clientX - t.x, e.clientY - t.y) <= 7)
          selectKind(e.clientX, e.clientY, t.shift);
        return;
      }
      if (!down || down.pointerId !== e.pointerId) return;
      const d = down;
      down = null;
      live.current.onBox(null);
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      if (live.current.aim) {
        if (d.button === 2) {
          live.current.onCancelAim?.();
          return;
        }
        const ground = point(e.clientX, e.clientY, false).ground;
        if (
          d.button === 0 &&
          ground &&
          Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 7
        )
          live.current.onAim?.(ground);
        return;
      }
      if (live.current.placement) {
        if (d.button === 2) {
          live.current.onCancelPlacement();
          return;
        }
        const r = canvas.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          return;
        const ground = point(e.clientX, e.clientY, false).ground;
        if (ground && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 7)
          live.current.onPlace(snapPlacement(ground), d.touch);
        return;
      }
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7;
      // A right button that travelled was a camera pan, not an order.
      if (d.button === 2 && moved) return;
      if (d.button === 0 && moved) {
        if (d.touch) return;
        const r = canvas.getBoundingClientRect(),
          ndc = projector(),
          ids = live.current.battle.entities
            .filter(
              (u) =>
                u.owner === live.current.owner &&
                isUnit(u.kind) &&
                !isHarvester(u.kind) &&
                !u.readyAt,
            )
            .filter((u) => {
              const p = ndc(u);
              const x = ((p.x + 1) * r.width) / 2 + r.left,
                y = ((-p.y + 1) * r.height) / 2 + r.top;
              return (
                x >= Math.min(d.x, e.clientX) &&
                x <= Math.max(d.x, e.clientX) &&
                y >= Math.min(d.y, e.clientY) &&
                y <= Math.max(d.y, e.clientY)
              );
            })
            .map((u) => u.id);
        live.current.onSelect(ids, d.shift);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      )
        return;
      const hit = point(e.clientX, e.clientY),
        entity = live.current.battle.entities.find((u) => u.id === hit.id);
      // An enemy-held tech site is a target; any other is ground to move onto.
      const site = live.current.battle.sites?.find((s) => s.id === hit.id);
      if (
        site?.team === 'red' &&
        !live.current.armed &&
        live.current.battle.entities.some(
          (u) =>
            live.current.selected.includes(u.id) &&
            u.owner === live.current.owner &&
            isUnit(u.kind),
        )
      ) {
        live.current.onEnemy(site.id);
        return;
      }
      const action = resolveBattlefieldClick({
        entities: live.current.battle.entities,
        selected: live.current.selected,
        owner: live.current.owner,
        entity,
        ground: hit.ground,
        button: d.button,
        shift: d.shift,
        armed: live.current.armed,
        rallyCategory: live.current.rallyCategory,
      });
      if (action.type === 'attack') live.current.onEnemy(action.id);
      else if (action.type === 'rally')
        live.current.onRally(action.id, action.point);
      else if (action.type === 'rallyCategory')
        live.current.onRallyCategory?.(action.category, action.point);
      else if (action.type === 'ground') live.current.onGround(action.point);
      else if (action.type === 'select')
        live.current.onSelect(action.ids, action.additive);
    };
    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      down = null;
      tap = null;
      live.current.onBox(null);
    };
    const leave = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      cursor.current = null;
    };
    const double = (e: MouseEvent) => {
      if (
        e.button !== 0 ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        live.current.placement ||
        live.current.aim ||
        live.current.armed ||
        canvas.dataset.grab !== undefined
      )
        return;
      selectKind(e.clientX, e.clientY, e.shiftKey);
    };
    const context = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('dblclick', double);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('contextmenu', context);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('dblclick', double);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('contextmenu', context);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('pointerleave', leave);
      project.current = null;
    };
  }, [gl, camera, scene, heightAt, aimAt]);
  useFrame(() => {
    if (props.placement && cursor.current && project.current)
      props.onPlacementHover(
        project.current(cursor.current.x, cursor.current.y),
      );
  });
  return null;
}
/** A pointer cursor over a hoverable structure; aiming and placement cursors still win in CSS. */
function HoverCursor({ hovered }: { hovered: HoveredStructure }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const sync = () => canvas.toggleAttribute('data-hover', !!hovered.id);
    sync();
    const stop = hovered.subscribe(sync);
    return () => {
      stop();
      canvas.removeAttribute('data-hover');
    };
  }, [gl, hovered]);
  return null;
}
function Contents(
  props: TacticalSceneProps & {
    quality: number;
    hold: (held: boolean) => void;
  },
) {
  const map = useTerrain();
  const own = props.battle.commanders.find((c) => c.id === props.owner),
    home = map.baseAt(own?.slot ?? 0);
  const layout = buildingLayout(props.battle);
  const tier = renderTier(props.quality);
  const directed = useDirected(props.cinematic);
  const postSettings = useMemo(
    () => ({
      passes: {
        ambientOcclusion: tier.ambientOcclusion,
        antialias: tier.antialias,
        tiltShift: tier.tiltShift,
      },
      exposure: map.design.atmosphere.exposure * lookParam('exposure', 1),
      grade: map.design.atmosphere.grade,
      air: {
        color: map.design.atmosphere.fog,
        density:
          map.design.atmosphere.fogDensity *
          (map.design.atmosphere.weather === 'blizzard' ? 0.35 : 0.15) *
          lookParam('haze', 1),
      },
      tiltShift: lookParam('tilt', props.capture ? 0.4 : 1),
      tune: {
        saturation: lookParam('sat', 1),
        contrast: lookParam('contrast', 1),
      },
    }),
    [tier, map, props.capture],
  );
  // Frame loops read the newest tick through this ref; equipment subtrees stay mounted untouched.
  const live = useRef<LiveBattle>({
    tickAt: 0,
    entities: new Map(),
    receivedAt: 0,
    training: [],
  });
  useEffect(() => {
    live.current = {
      tickAt: props.battle.tickAt,
      entities: new Map(props.battle.entities.map((e) => [e.id, e])),
      receivedAt: performance.now() / 1000,
      training: props.battle.training ?? [],
    };
  });
  const obstacles = useMemo(() => {
    const buildings = JSON.parse(layout) as [
      BuildingKind,
      number,
      number,
      number,
    ][];
    return buildings.map(([kind, x, z, angle]) =>
      footprint(kind, { x, z }, angle),
    );
  }, [layout]);
  const aimAt = useRef<Point | null>(null);
  const rallyKinds: string[] | null = props.rallyCategory
    ? producerKindsFor(props.rallyCategory)
    : null;
  return (
    <FogContext.Provider value={props.fog}>
      <Suspense fallback={null}>
        <SkyReflections />
      </Suspense>
      <Battlefield battle={props.battle} rich={tier.shadowEvery === 1} />
      <ShadowCadence every={tier.shadowEvery} />
      <OreFields deposits={props.battle.deposits ?? []} />
      <CaptureFlags battle={props.battle} />
      <TechSites
        battle={props.battle}
        labels={!props.attract && !props.capture}
      />
      <ReconFlights battle={props.battle} />
      <CoastalLife />
      <TacticalCombat
        battle={props.battle}
        fog={props.fog}
        lamps={lampLevel(
          map.design.atmosphere.grade,
          map.design.atmosphere.weather,
        )}
      />
      {buildAreas(props.battle.entities, props.owner)
        .filter((area) => props.placement || props.selected.includes(area.id))
        .map((area) => (
          <BuildBoundary
            key={area.id}
            position={area}
            radius={area.radius}
            emphasized={
              area.kind === 'outpost' || props.selected.includes(area.id)
            }
          />
        ))}
      {props.placement && <PlacementPreview placement={props.placement} />}
      {!props.attract && <StrikeEffects battle={props.battle} />}
      {props.aim && (
        <AimCursor
          battle={props.battle}
          owner={props.owner}
          aim={props.aim}
          cursor={aimAt}
        />
      )}
      {props.battle.entities.map((e) => {
        const commander = props.battle.commanders.find((c) => c.id === e.owner);
        const color =
          e.team === 'red'
            ? '#c75240'
            : commander
              ? cultureArt(commander.culture as Culture).primary
              : '#59c5d9';
        const selected = props.selected.includes(e.id);
        const showRally =
          !!rallyKinds &&
          e.owner === props.owner &&
          !props.selected.length &&
          rallyKinds.includes(e.kind);
        // A newly encountered model must never suspend or hide the rest of the army.
        return (
          <AssetBoundary
            key={`${e.id}:${e.kind}`}
            fallback={
              <EquipmentPlaceholder
                entity={e}
                color={color}
                selected={selected}
                failed
              />
            }
          >
            <Suspense
              fallback={
                <EquipmentPlaceholder
                  entity={e}
                  color={color}
                  selected={selected}
                />
              }
            >
              <Equipment
                entity={e}
                selected={selected}
                showRally={showRally}
                color={color}
                live={live}
                serverAt={e.readyAt > 0 ? props.battle.tickAt : 0}
                active={props.battle.status === 'active'}
                obstacles={obstacles}
                cargoCapacity={harvesterCapacity(props.battle, e.owner)}
                speedScale={speedScaleFor(props.battle, e)}
                orders={props.orders}
                hovered={props.hovered}
              />
            </Suspense>
          </AssetBoundary>
        );
      })}
      {!directed && (
        <CameraRig
          focus={props.focus}
          home={home}
          placement={!!props.placement}
          onViewport={props.onViewport}
          onSpaceTap={props.onSpaceTap}
        />
      )}
      {process.env.NODE_ENV !== 'production' && (
        <>
          <FrameMeasurements />
          <MemoryMeasurements />
        </>
      )}
      <Director shots={props.cinematic} />
      {props.onReady && (
        <SceneReady id={map.mapId} onReady={props.onReady} hold={props.hold} />
      )}
      {!props.attract && (
        <>
          <OrderPing orders={props.orders} />
          <Commands props={props} aimAt={aimAt} />
        </>
      )}
      <FogOfWar fog={props.fog} battle={props.battle} owner={props.owner} />
      <PostProcessing
        fog={props.fog}
        bounds={map.bounds}
        settings={postSettings}
      />
      {props.hovered && <HoverCursor hovered={props.hovered} />}
    </FogContext.Provider>
  );
}
class AssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
/** The attract mode runs behind the home UI: about 1.3 MP of 3D at most. */
const ATTRACT_PIXEL_BUDGET = 1_300_000;
/** Shadows stay on at every render tier (see ShadowCadence): switching them recompiles every material. */
const SHADOWS = { type: THREE.PCFShadowMap };
const CAPTURE_PIXEL_BUDGET = 6_000_000;
export default function TacticalScene(props: TacticalSceneProps) {
  const map = terrainFor(props.battle);
  const resolution = useRenderResolution(
    props.capture
      ? CAPTURE_PIXEL_BUDGET
      : props.attract
        ? ATTRACT_PIXEL_BUDGET
        : undefined,
    props.capture ? 2 : props.attract ? 1 : undefined,
  );
  // `?look=tier:2&debug=noadapt` pins a render tier in development.
  const [quality, setQuality] = useState<number>(
    () => QUALITY_TIERS[lookParam('tier', 0)] ?? 1,
  );
  // A scene with an onReady gate starts paused (SceneReady releases it).
  const [held, setHeld] = useState(!!props.onReady);
  const own = props.battle.commanders.find((c) => c.id === props.owner),
    home = map.baseAt(own?.slot ?? 0);
  return (
    <Canvas
      frameloop={held ? 'never' : 'always'}
      shadows={SHADOWS}
      {...resolution}
      dpr={resolution.dpr * renderTier(quality).dpr}
      camera={{
        position: cameraPosition(
          { x: home.x, z: home.z - 8 },
          HOME_DISTANCE,
          HOME_YAW,
        ),
        fov: 44,
        near: 0.1,
        far: 620,
      }}
      // The HDR fog pass already provides 4× MSAA and depth. Its final fullscreen
      // triangle needs neither another multisampled framebuffer nor another depth buffer.
      gl={{
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      }}
    >
      <AdaptiveFrameBudget onQuality={setQuality} />
      <TerrainContext.Provider
        key={`${props.battle.mapId}:${props.battle.mapVersion}:${props.battle.seed}:${props.battle.mapScale}`}
        value={map}
      >
        <OverlaysContext.Provider value={!props.attract && !props.capture}>
          <LightAssetsContext.Provider
            value={!!props.attract && !props.capture}
          >
            <WorldClock>
              <EnvironmentMotion>
                <Contents {...props} quality={quality} hold={setHeld} />
              </EnvironmentMotion>
            </WorldClock>
          </LightAssetsContext.Provider>
        </OverlaysContext.Provider>
      </TerrainContext.Provider>
    </Canvas>
  );
}
