import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { parseGlb } from '../lib/gltf';

const names = [
  'spruce_coastal',
  'spruce_windswept',
  'spruce_young',
  'granite_1',
  'granite_2',
  'juniper',
  'field_stores',
  'field_fence',
  'bridge_span',
  'glacial_spires',
  'glacial_scree',
  'birch_amber',
  'birch_russet',
  'fen_reeds',
  'basalt_columns',
  'basalt_scree',
  'granite_dry_1',
  'granite_dry_2',
  'spruce_dry',
  'juniper_dry',
  'spruce_coastal_lod',
  'spruce_windswept_lod',
  'spruce_young_lod',
  'spruce_dry_lod',
  'birch_amber_lod',
  'birch_russet_lod',
  'pine_tall',
  'pine_tall_lod',
];

describe('Blender landing-zone kit', () => {
  test('the complete kit stays within its download budget', () => {
    const size = names.reduce(
      (total, name) =>
        total +
        readFileSync(
          new URL(`../public/models/landscape/${name}.glb`, import.meta.url),
        ).byteLength,
      0,
    );
    // Authored near foliage now has a separate bounded distance mesh. Includes
    // all four biomes; each operation loads only its own variants.
    expect(size).toBeLessThan(9_500_000);
  });
  for (const name of names)
    test(`${name} exports one coloured instancing mesh`, async () => {
      const bytes = readFileSync(
        new URL(`../public/models/landscape/${name}.glb`, import.meta.url),
      );
      const gltf = await parseGlb(bytes);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      expect(meshes).toHaveLength(1);
      const mesh = meshes[0],
        geometry = mesh.geometry;
      expect(
        (geometry.index?.count ?? geometry.attributes.position.count) / 3,
      ).toBeLessThan(
        name.endsWith('_lod')
          ? 1500
          : /^(spruce|birch)/.test(name)
            ? 6000
            : 6500,
      );
      expect(geometry.attributes.color.count).toBe(
        geometry.attributes.position.count,
      );
      expect(geometry.attributes.normal.count).toBe(
        geometry.attributes.position.count,
      );
      expect((mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(
        true,
      );
      expect(
        (mesh.material as THREE.MeshStandardMaterial).roughness,
      ).toBeGreaterThanOrEqual(0.85);
      expect(gltf.scene.getObjectByName(name)?.userData.ambient_only).toBe(
        true,
      );
      const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
      expect(bounds.min.y).toBeGreaterThan(name === 'bridge_span' ? -1 : -0.2);
      expect(bounds.max.y).toBeLessThan(4.2);
    });
});

test('snow-free variants preserve the original Skerry mesh transforms', () => {
  const nodes = (name: string) => {
    const bytes = readFileSync(
      new URL(`../public/models/landscape/${name}.glb`, import.meta.url),
    );
    const json = JSON.parse(
      bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
    );
    return json.nodes
      .filter((n: { mesh?: number }) => n.mesh !== undefined)
      .map(
        (n: {
          translation?: number[];
          rotation?: number[];
          scale?: number[];
        }) => ({
          translation: n.translation,
          rotation: n.rotation,
          scale: n.scale,
        }),
      );
  };
  for (const [original, variant] of [
    ['granite_1', 'granite_dry_1'],
    ['granite_2', 'granite_dry_2'],
    ['spruce_coastal', 'spruce_dry'],
    ['juniper', 'juniper_dry'],
  ])
    expect(nodes(variant)).toEqual(nodes(original));
});

test('distance foliage preserves near-mesh bounds and reduces triangle work by at least 70%', async () => {
  const load = async (name: string) => {
    const bytes = readFileSync(
      new URL(`../public/models/landscape/${name}.glb`, import.meta.url),
    );
    const { scene } = await parseGlb(bytes);
    const mesh = scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    return {
      bounds: new THREE.Box3().setFromObject(scene, true),
      triangles:
        (mesh.geometry.index?.count ??
          mesh.geometry.attributes.position.count) / 3,
    };
  };
  for (const name of names.filter((n) => n.endsWith('_lod'))) {
    const near = await load(name.slice(0, -4)),
      far = await load(name);
    expect(far.bounds.min.distanceTo(near.bounds.min)).toBeLessThan(0.001);
    expect(far.bounds.max.distanceTo(near.bounds.max)).toBeLessThan(0.001);
    expect(far.triangles).toBeLessThan(near.triangles * 0.3);
  }
});

const props = [
  'lighthouse',
  'ruin',
  'windmill',
  'radio_mast',
  'wreck_tank',
  'wreck_plane',
  'fishing_hut',
  'boat',
  'crane',
  'fuel_tanks',
  'rail_wagon',
  'statue',
  'watch_hut',
];
describe('diorama set pieces', () => {
  for (const name of props)
    test(`${name} is a bounded, grounded prop with named materials`, async () => {
      const bytes = readFileSync(
        new URL(`../public/models/props/${name}.glb`, import.meta.url),
      );
      expect(bytes.byteLength).toBeLessThan(450_000);
      const gltf = await parseGlb(bytes);
      let triangles = 0;
      const materials = new Set<string>();
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
        materials.add((o.material as THREE.Material).name);
      });
      expect(triangles).toBeLessThan(9000);
      expect([...materials].every((m) => m.length > 0)).toBe(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
      // Standing on the ground (the boat floats with its hull below the waterline).
      expect(bounds.min.y).toBeGreaterThan(-1);
      expect(bounds.max.y).toBeGreaterThan(1);
    });
  test('animated and emitting nodes keep their contract names', async () => {
    const nodes = async (name: string) => {
      const bytes = readFileSync(new URL(`../public/models/props/${name}.glb`, import.meta.url));
      const { scene } = await parseGlb(bytes);
      const names: string[] = [];
      scene.traverse((o) => names.push(o.name));
      return names;
    };
    expect(await nodes('windmill')).toContain('rotor_pivot');
    expect(await nodes('radio_mast')).toContain('radar_dish');
    expect((await nodes('fishing_hut')).some((n) => n.startsWith('smoke_'))).toBe(true);
    expect((await nodes('lighthouse')).some((n) => n.startsWith('light_'))).toBe(true);
  });
});

test('the railway viaduct matches the other crossing models', async () => {
  const bytes = readFileSync(new URL('../public/models/landscape/bridge_viaduct.glb', import.meta.url));
  const { scene } = await parseGlb(bytes);
  const bounds = new THREE.Box3().setFromObject(scene, true);
  // Authored for a 10.5 m by 16 m deck section, piers reaching into the gorge.
  expect(bounds.max.z - bounds.min.z).toBeCloseTo(16, 0);
  expect(bounds.max.x - bounds.min.x).toBeLessThan(13);
  expect(bounds.min.y).toBeLessThan(-4);
});
