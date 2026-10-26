import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { parseGlb } from '../lib/gltf';
import {
  unitKinds,
  buildingKinds,
  isUnit,
  type BuildingKind,
} from '../lib/tactics';
import {
  footprint,
  insideFootprint,
  PRODUCTION_EXITS,
  productionExit,
} from '../lib/tactical-placement';

const read = (kind: string) =>
  readFileSync(new URL(`../public/models/tactical/${kind}.glb`, import.meta.url));

/** Rig nodes the renderer animates (docs-rebuild.md, "Rig names"). */
const RIGS: Partial<Record<BuildingKind, string[]>> = {
  hq: ['flag', 'smoke_0', 'light_0'],
  factory: ['door', 'smoke_0'],
  barracks: ['door', 'flag', 'smoke_0'],
  airfield: ['door', 'light_0'],
  armory: ['door', 'smoke_0'],
  radar: ['radar_dish'],
  turret: ['turret', 'barrel', 'muzzle'],
  battery: ['turret', 'barrel', 'muzzle'],
  bunker: ['turret', 'barrel', 'muzzle'],
  flak: ['turret', 'barrel', 'muzzle'],
  reactor: ['smoke_0'],
  plant: ['smoke_0'],
  watchtower: ['smoke_0', 'light_0'],
  boathouse: ['flag', 'smoke_0', 'light_0'],
  launcher: ['smoke_0', 'light_0'],
  weathermast: ['radar_dish', 'light_0'],
};

describe('Original Nordic tactical assets', () => {
  for (const kind of [...unitKinds, ...buildingKinds])
    test(`${kind} loads with culture paint and a bounded rendering cost`, async () => {
      const bytes = read(kind);
      const building = !isUnit(kind);
      expect(bytes.byteLength).toBeLessThan(building ? 720000 : 1100000);
      const gltf = await parseGlb(bytes);
      let triangles = 0,
        meshes = 0,
        paint = 0;
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          meshes++;
          triangles +=
            (node.geometry.index?.count ??
              node.geometry.attributes.position.count) /
            3;
          if (node.material.name === 'culture_trim') paint++;
        }
      });
      expect(paint).toBeGreaterThan(0);
      expect(meshes).toBeLessThan(25);
      expect(triangles).toBeLessThan(25000);
      const bounds = new THREE.Box3().setFromObject(gltf.scene, true),
        size = bounds.getSize(new THREE.Vector3());
      if (building) {
        const pad = footprint(kind as BuildingKind, { x: 0, z: 0 }, 0);
        expect(bounds.min.x).toBeGreaterThanOrEqual(pad.minX);
        expect(bounds.max.x).toBeLessThanOrEqual(pad.maxX);
        expect(bounds.min.z).toBeGreaterThanOrEqual(pad.minZ);
        expect(bounds.max.z).toBeLessThanOrEqual(pad.maxZ);
        for (const name of RIGS[kind as BuildingKind] ?? [])
          expect(gltf.scene.getObjectByName(name), name).toBeDefined();
      }
      expect(bounds.min.y).toBeGreaterThan(-0.05);
      expect(size.y).toBeGreaterThan(kind === 'drone' ? 0.75 : 1);
      // Landmark buildings (the command station's watch tower) stand taller than troops.
      expect(size.y).toBeLessThan(building ? 16 : 9);
      const png = readFileSync(
        new URL(`../public/art/tactical/${kind}.png`, import.meta.url),
      );
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(256);
      expect(png.readUInt32BE(20)).toBe(192);
    });

  test('the building library stays a reasonable download', () => {
    const total = buildingKinds.reduce((sum, kind) => sum + read(kind).byteLength, 0);
    expect(total).toBeLessThan(9_000_000);
  });

  test('units appear and harvesters dock outside the modelled footprint', () => {
    for (const [kind, distance] of Object.entries(PRODUCTION_EXITS)) {
      const b = kind as BuildingKind;
      const exit = productionExit({ x: 0, z: 0, angle: 0, kind: b });
      expect(exit.z).toBe(distance);
      expect(insideFootprint(exit, footprint(b, { x: 0, z: 0 }, 0))).toBe(false);
    }
  });
});
