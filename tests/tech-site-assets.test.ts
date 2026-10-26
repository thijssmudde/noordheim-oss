import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { parseGlb } from '../lib/gltf';
import {
  siteFootprint,
  techSiteKinds,
  type TechSiteKind,
} from '../lib/tactics';

const read = (name: string) =>
  readFileSync(
    new URL(`../public/models/tactical/sites/${name}.glb`, import.meta.url),
  );
/** Rig nodes the scene animates (art/blender/tech_sites.py). */
const RIGS: Record<TechSiteKind, string[]> = {
  derrick: ['pump', 'flag', 'light_0'],
  fieldHospital: ['flag', 'light_0'],
  airstrip: ['light_0'],
};
async function inspect(name: string) {
  const gltf = await parseGlb(read(name));
  let triangles = 0,
    meshes = 0,
    paint = 0;
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes++;
    triangles +=
      (node.geometry.index?.count ?? node.geometry.attributes.position.count) /
      3;
    if (node.material.name === 'culture_trim') paint++;
  });
  return {
    gltf,
    triangles,
    meshes,
    paint,
    bounds: new THREE.Box3().setFromObject(gltf.scene, true),
  };
}

describe('Tech site assets', () => {
  for (const kind of techSiteKinds)
    test(`${kind} carries the holder's paint inside its footprint`, async () => {
      expect(read(kind).byteLength).toBeLessThan(720000);
      const { gltf, triangles, meshes, paint, bounds } = await inspect(kind);
      // culture_trim is tinted in the holder's colour, grey while neutral.
      expect(paint).toBeGreaterThan(0);
      expect(meshes).toBeLessThan(25);
      expect(triangles).toBeLessThan(25000);
      const pad = siteFootprint({ kind, x: 0, z: 0, angle: 0 });
      expect(bounds.min.x).toBeGreaterThanOrEqual(pad.minX);
      expect(bounds.max.x).toBeLessThanOrEqual(pad.maxX);
      expect(bounds.min.z).toBeGreaterThanOrEqual(pad.minZ);
      expect(bounds.max.z).toBeLessThanOrEqual(pad.maxZ);
      expect(bounds.min.y).toBeGreaterThan(-0.05);
      const height = bounds.getSize(new THREE.Vector3()).y;
      expect(height).toBeGreaterThan(1);
      expect(height).toBeLessThan(16);
      for (const name of RIGS[kind])
        expect(gltf.scene.getObjectByName(name), name).toBeDefined();
      const png = readFileSync(
        new URL(`../public/art/tactical/sites/${kind}.png`, import.meta.url),
      );
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(256);
      expect(png.readUInt32BE(20)).toBe(192);
    });

  test('the recon plane is light, painted and has a spinning propeller', async () => {
    expect(read('recon').byteLength).toBeLessThan(200000);
    const { gltf, triangles, paint, bounds } = await inspect('recon');
    expect(paint).toBeGreaterThan(0);
    expect(triangles).toBeLessThan(4000);
    expect(gltf.scene.getObjectByName('prop')).toBeDefined();
    // Nose forward (+Z), wings across: wider than it is long, and small.
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.z);
    expect(size.x).toBeLessThan(10);
  });
});
