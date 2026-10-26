'use client';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CompiledMap, ForestDesign, MapDesign, MapId, Point } from '@/lib/maps/types';
import { polygonDistance, polylineDistance } from '../../../lib/maps/compile';
import { gridHeight, gridTerrain, noise2, seeded, type WorldGrid } from './world-map';
import { InstancedModel, placementMatrix, type Placement } from './instanced';

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const SPECIES: Record<NonNullable<ForestDesign['species']>, string[]> = {
  spruce: ['spruce_coastal', 'spruce_windswept', 'spruce_young'],
  pine: ['spruce_windswept', 'pine_tall', 'spruce_coastal'],
  birch: ['birch_amber', 'birch_russet', 'spruce_young'],
  mixed: ['spruce_coastal', 'birch_amber', 'spruce_young', 'spruce_windswept'],
};
const ALL_TREES = [
  'spruce_coastal',
  'spruce_windswept',
  'spruce_young',
  'pine_tall',
  'birch_amber',
  'birch_russet',
];
/** Each map's bedrock: two boulder models and the share of the first. */
const STONES: Record<MapId, [string, string, number]> = {
  fjordmouth: ['granite_1', 'granite_2', 0.5],
  ironpass: ['granite_dry_1', 'granite_dry_2', 0.5],
  glaciercrown: ['glacial_scree', 'glacial_spires', 0.75],
  skerryharbour: ['basalt_scree', 'basalt_columns', 0.65],
  nordlys: ['granite_1', 'granite_2', 0.5],
};

/**
 * The landscape models a map's vegetation can use (`light`: the attract mode's
 * LOD-only trees), so a caller can start their downloads before planting.
 */
export function vegetationModels(design: MapDesign, light: boolean) {
  const trees = new Set(ALL_TREES.slice(0, 3));
  for (const forest of design.forests) for (const name of SPECIES[forest.species ?? 'spruce']) trees.add(name);
  const names = [...trees].map((name) => (light && name !== 'pine_tall' ? `${name}_lod` : name));
  const [first, second] = STONES[design.id];
  return [...names, first, second, 'juniper', 'fen_reeds'];
}

/** Visual stand density relative to the authored trees-per-100 m². */
const LUSH = 2.8;

export type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Keep-out rings: bases, crossings, ore, roads. Trees never grow over play space. */
function keepOut(map: CompiledMap) {
  const d = map.design;
  const discs: { x: number; z: number; r: number }[] = [
    ...d.landings.map((p) => ({ ...p, r: 34 })),
    ...d.strongholds.map((s) => ({ x: s.x, z: s.z, r: s.radius * 0.8 })),
    ...d.ore.map((o) => ({ x: o.x, z: o.z, r: o.rich ? 13 : 11 })),
    ...d.crossings.map((c) => ({ x: c.x, z: c.z, r: c.length / 2 + 6 })),
    ...d.props.map((p) => ({ x: p.x, z: p.z, r: 7 * (p.scale ?? 1) })),
    ...d.billboards.map((b) => ({ x: b.x, z: b.z, r: 5 })),
  ];
  return (x: number, z: number, pad = 0) => {
    for (const c of discs) {
      const dx = x - c.x,
        dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + pad) * (c.r + pad)) return true;
    }
    for (const road of d.roads)
      if (polylineDistance(road.path, road.width, x, z).distance < road.width / 2 + 2.2 + pad)
        return true;
    return false;
  };
}

export type Vegetation = {
  trees: Record<string, Placement[]>;
  rocks: Record<string, Placement[]>;
  reeds: Placement[];
  scrub: Placement[];
  tufts: Placement[];
};

export function plantVegetation(map: CompiledMap, grid: WorldGrid): Vegetation {
  const d = map.design;
  const random = seeded(d.ground.seed * 31 + 7);
  const blocked = keepOut(map);
  const trees: Record<string, Placement[]> = {};
  const [stone, otherStone, stoneShare] = STONES[map.mapId];
  const rocks: Record<string, Placement[]> = { [stone]: [], [otherStone]: [] };
  const reeds: Placement[] = [];
  const scrub: Placement[] = [];
  const inside = (x: number, z: number, pad = 1.5) =>
    x > d.bounds.minX + pad && x < d.bounds.maxX - pad && z > d.bounds.minZ + pad && z < d.bounds.maxZ - pad;
  const growable = (x: number, z: number) => {
    if (!inside(x, z)) return false;
    const t = gridTerrain(grid, x, z);
    return t === 'land' || t === 'plateau' || t === 'marsh';
  };
  const plant = (name: string, x: number, z: number, scale: number) => {
    // Chunky, slightly oversized crowns read at the play zoom.
    const girth = 1.15 + random() * 0.25;
    (trees[name] ??= []).push({
      x,
      y: gridHeight(grid, x, z) - 0.08,
      z,
      angle: random() * Math.PI * 2,
      scale: scale * 1.55,
      stretch: [girth, 1, girth],
      tilt: (random() - 0.5) * 0.06,
    });
  };

  for (const forest of d.forests) {
    const names = SPECIES[forest.species ?? 'spruce'];
    const spacing = Math.sqrt(100 / (forest.density * LUSH));
    const xs = forest.outline.map((p) => p.x),
      zs = forest.outline.map((p) => p.z);
    const minX = Math.min(...xs) - 8,
      maxX = Math.max(...xs) + 8;
    const minZ = Math.min(...zs) - 8,
      maxZ = Math.max(...zs) + 8;
    for (let z = minZ; z <= maxZ; z += spacing)
      for (let x = minX; x <= maxX; x += spacing) {
        const px = x + (random() - 0.5) * spacing * 0.9,
          pz = z + (random() - 0.5) * spacing * 0.9;
        const inside = polygonDistance(forest.outline, px, pz);
        // Feathered edge: a few outliers stand beyond the outline.
        const keep = inside > 0 ? Math.min(1, 0.55 + inside / 10) : 0.22 * Math.max(0, 1 + inside / 8);
        if (random() > keep || !growable(px, pz) || blocked(px, pz)) continue;
        const heart = Math.min(1, Math.max(0, inside / 18));
        const name = names[Math.floor(random() * names.length)];
        plant(name, px, pz, (0.85 + random() * 0.55) * (1 + heart * 0.45) * (name === 'spruce_young' ? 0.9 : 1.15));
        // Juniper and young growth fringe the stands.
        if (inside < 5 && inside > -4 && random() < 0.35 && !blocked(px + 2, pz + 1))
          scrub.push({ x: px + 2, y: gridHeight(grid, px + 2, pz + 1), z: pz + 1, angle: random() * 6.28, scale: 1.2 + random() * 0.8 });
      }
  }

  // Lone trees and small clumps on the open heath, along noise belts.
  const width = d.bounds.maxX - d.bounds.minX,
    depth = d.bounds.maxZ - d.bounds.minZ;
  const lone = Math.round((width * depth) / 900);
  for (let i = 0; i < lone; i++) {
    const x = d.bounds.minX + 4 + random() * (width - 8),
      z = d.bounds.minZ + 4 + random() * (depth - 8);
    const belt = noise2(x * 0.02 + 5, z * 0.02 - 3);
    if (random() > (belt - 0.45) * 2.2 || !growable(x, z) || blocked(x, z, 4)) continue;
    const name = ALL_TREES[Math.floor(random() * 3)];
    const clump = 1 + Math.floor(random() * 3);
    for (let k = 0; k < clump; k++) {
      const cx = x + (random() - 0.5) * 7,
        cz = z + (random() - 0.5) * 7;
      if (!growable(cx, cz) || blocked(cx, cz, 2)) continue;
      plant(name, cx, cz, 0.8 + random() * 0.6);
    }
  }

  // Bedrock: rubble along cliff rims and feet, shore stones, heath erratics.
  const rock = (x: number, z: number, s: number, sink = 0.3) => {
    if (!inside(x, z, s + 0.5) || blocked(x, z, -1)) return;
    const t = gridTerrain(grid, x, z);
    if (t === 'ramp' || t === 'road' || t === 'bridge' || t === 'ford') return;
    rocks[random() < stoneShare ? stone : otherStone].push({
      x,
      y: gridHeight(grid, x, z) - s * sink,
      z,
      angle: random() * Math.PI * 2,
      scale: s,
      stretch: [0.8 + random() * 0.5, 0.55 + random() * 0.55, 0.8 + random() * 0.5],
      tilt: (random() - 0.5) * 0.4,
    });
  };
  const walk = (outline: Point[], step: number, visit: (x: number, z: number, nx: number, nz: number) => void) => {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = (b.z - a.z) / len,
        nz = -(b.x - a.x) / len;
      for (let t = 0; t < len; t += step)
        visit(a.x + ((b.x - a.x) * t) / len, a.z + ((b.z - a.z) * t) / len, nx, nz);
    }
  };
  for (const plateau of d.plateaus)
    walk(plateau.outline, 2.2, (x, z, nx, nz) => {
      // Orient the normal outward: test which side is outside the plateau.
      const out = polygonDistance(plateau.outline, x + nx, z + nz) < 0 ? 1 : -1;
      for (const along of [-0.6, plateau.cliff * 0.5, plateau.cliff + 0.6])
        if (random() < (along > plateau.cliff ? 0.42 : 0.3)) {
          const o = -along * out;
          rock(x + nx * o + (random() - 0.5) * 1.5, z + nz * o + (random() - 0.5) * 1.5, 0.5 + random() * (along > 0 ? 1.4 : 0.9));
        }
    });
  for (const body of [...d.seas, ...d.lakes])
    walk(body.outline, 3, (x, z) => {
      if (random() < 0.5)
        rock(x + (random() - 0.5) * 8, z + (random() - 0.5) * 8, 0.3 + random() * 0.7, 0.45);
    });
  for (let i = 0; i < lone * 0.35; i++) {
    const x = d.bounds.minX + 4 + random() * (width - 8),
      z = d.bounds.minZ + 4 + random() * (depth - 8);
    if (!growable(x, z) || blocked(x, z, 3)) continue;
    rock(x, z, 0.8 + random() * 1.8);
  }

  // Sedge in the marshes and along gentle banks.
  for (const marsh of d.marshes) {
    const xs = marsh.map((p) => p.x),
      zs = marsh.map((p) => p.z);
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1.4)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.4) {
        const px = x + (random() - 0.5) * 1.4,
          pz = z + (random() - 0.5) * 1.4;
        if (polygonDistance(marsh, px, pz) < 0.5 || random() < 0.35 || blocked(px, pz, -1)) continue;
        reeds.push({ x: px, y: gridHeight(grid, px, pz) - 0.05, z: pz, angle: random() * 6.28, scale: 0.7 + random() * 0.6 });
      }
  }
  for (let i = 0; i < lone * 2.5; i++) {
    const x = d.bounds.minX + random() * width,
      z = d.bounds.minZ + random() * depth;
    const t = gridTerrain(grid, x, z);
    if ((t !== 'bank' && t !== 'shore') || !inside(x, z) || blocked(x, z, -1) || random() < 0.4) continue;
    reeds.push({ x, y: gridHeight(grid, x, z) - 0.05, z, angle: random() * 6.28, scale: 0.6 + random() * 0.5 });
  }
  // Grass tufts poke through the snow on open ground: capped for large maps.
  const tufts: Placement[] = [];
  const area = width * depth;
  // Deep snow buries the grass: fewer tufts, none on a glacier.
  const buried = THREE.MathUtils.clamp((d.atmosphere.snowCover - 0.75) / 0.2, 0, 1);
  const target = Math.min(30000, area / 7) * (1 - buried);
  for (let i = 0; i < target * 1.6 && tufts.length < target; i++) {
    const x = d.bounds.minX + random() * width,
      z = d.bounds.minZ + random() * depth;
    const t = gridTerrain(grid, x, z);
    if ((t !== 'land' && t !== 'plateau' && t !== 'marsh' && t !== 'bank') || !inside(x, z)) continue;
    // Clumped: tufts gather in meadows and thin out between them.
    if (noise2(x * 0.06, z * 0.06) + random() * 0.45 < 0.62 || blocked(x, z, -1.5)) continue;
    tufts.push({
      x,
      y: gridHeight(grid, x, z) - 0.04,
      z,
      angle: random() * Math.PI * 2,
      scale: 0.55 + random() * 0.5,
    });
  }
  return { trees, rocks, reeds, scrub, tufts };
}

/** A tuft of dry grass: a few leaning blades, dark at the root and straw at the tips. */
function tuftGeometry() {
  const points: number[] = [],
    colors: number[] = [];
  const random = seeded(77);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + random() * 0.8,
      lean = 0.15 + random() * 0.35,
      height = 0.32 + random() * 0.3,
      half = 0.05 + random() * 0.03;
    const bx = Math.cos(a) * 0.06,
      bz = Math.sin(a) * 0.06;
    const tx = bx + Math.cos(a) * lean * height,
      tz = bz + Math.sin(a) * lean * height;
    const nx = -Math.sin(a) * half,
      nz = Math.cos(a) * half;
    points.push(bx - nx, 0, bz - nz, bx + nx, 0, bz + nz, tx, height, tz);
    const base = [0.56, 0.5, 0.3],
      tip = [0.98, 0.88, 0.58];
    colors.push(...base, ...base, ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  // Blades are lit like the ground they grow from.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Near-camera grass: cells beyond 150 m are skipped entirely. */
function GrassTufts({ placements }: { placements: Placement[] }) {
  const geometry = useMemo(() => tuftGeometry(), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const cells = useMemo(() => {
    const groups = new Map<string, THREE.Matrix4[]>();
    for (const p of placements) {
      const key = `${Math.floor(p.x / 72)},${Math.floor(p.z / 72)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(placementMatrix(p));
    }
    return [...groups.values()];
  }, [placements]);
  return (
    <group>
      {cells.map((matrices, i) => (
        <TuftCell key={i} matrices={matrices} geometry={geometry} material={material} />
      ))}
    </group>
  );
}

function TuftCell({
  matrices,
  geometry,
  material,
}: {
  matrices: THREE.Matrix4[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    matrices.forEach((matrix, i) => m.setMatrixAt(i, matrix));
    m.count = matrices.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m?.boundingSphere) return;
    m.visible = camera.position.distanceTo(m.boundingSphere.center) < 150;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, Math.max(1, matrices.length)]}
      receiveShadow
      raycast={() => {}}
    />
  );
}

/** Removes decoration standing inside building footprints. */
export function clearOf(list: Placement[], occupied: Footprint[], pad = 1.5) {
  if (!occupied.length) return list;
  return list.filter(
    (p) =>
      !occupied.some(
        (b) => p.x > b.minX - pad && p.x < b.maxX + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad,
      ),
  );
}

export function WorldVegetation({
  map,
  grid,
  occupied = [],
}: {
  map: CompiledMap;
  grid: WorldGrid;
  occupied?: Footprint[];
}) {
  const plan = useMemo(() => plantVegetation(map, grid), [map, grid]);
  const snow = Math.min(1, map.design.atmosphere.snowCover * 1.1);
  const snowColor = map.design.palette.snow;
  const trees = useMemo(
    () => Object.entries(plan.trees).map(([name, list]) => [name, clearOf(list, occupied, 2)] as const),
    [plan, occupied],
  );
  const rocks = useMemo(
    () => Object.entries(plan.rocks).map(([name, list]) => [name, clearOf(list, occupied)] as const),
    [plan, occupied],
  );
  const tufts = useMemo(() => clearOf(plan.tufts, occupied, 0.5), [plan, occupied]);
  const scrub = useMemo(() => clearOf(plan.scrub, occupied), [plan, occupied]);
  return (
    <group>
      {trees.map(([name, list]) => (
        <Quiet key={name}>
          <Suspense fallback={null}>
            <InstancedModel
              name={name}
              lod={name !== 'pine_tall'}
              placements={list}
              options={{ wind: true, snow: snow * (name.startsWith('birch') ? 0.2 : name.startsWith('pine') ? 0.05 : 0.4), snowColor, detail: 0.2 }}
            />
          </Suspense>
        </Quiet>
      ))}
      {rocks.map(([name, list]) => (
        <Quiet key={name}>
          <Suspense fallback={null}>
            <InstancedModel name={name} placements={list} options={{ snow: snow * 0.45, snowColor, detail: 0.7 }} />
          </Suspense>
        </Quiet>
      ))}
      <GrassTufts placements={tufts} />
      <Quiet>
        <Suspense fallback={null}>
          <InstancedModel name="juniper" placements={scrub} options={{ snow: snow * 0.6, snowColor, detail: 0.3 }} />
          <InstancedModel name="fen_reeds" placements={plan.reeds} options={{ wind: true, shadows: false }} />
        </Suspense>
      </Quiet>
    </group>
  );
}
