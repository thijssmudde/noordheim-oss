import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { parseGlb } from '../lib/gltf';

for (const name of ['factory', 'barracks', 'refinery']) {
  test(`${name} has a bounded material-separated model with closed roof and recolourable faction markings`, async () => {
    const bytes = readFileSync(
      new URL(`../public/models/tactical/${name}.glb`, import.meta.url),
    );
    const { scene } = await parseGlb(bytes);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    // Metal, concrete, glazing and trim retain independent physical response.
    expect(meshes.length).toBeLessThanOrEqual(12);
    const roughness = new Set(
      meshes.map((m) => (m.material as THREE.MeshStandardMaterial).roughness),
    );
    expect(roughness.size).toBeGreaterThanOrEqual(3);
    expect(
      meshes.some(
        (m) => (m.material as THREE.Material).name === 'culture_trim',
      ),
    ).toBe(true);
    expect(meshes.some((m) => m.geometry.attributes.color)).toBe(true);
    expect(bytes.length).toBeLessThan(800_000);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene, true);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.01);
    // Diorama buildings are landmarks: chimneys and silos rise well above troops.
    expect(bounds.max.y).toBeLessThan(12);
    // The building must have a roof from both sides of its central ridge.
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(x, 10, z),
          new THREE.Vector3(0, -1, 0),
        );
        expect(ray.intersectObject(scene, true)[0]?.point.y).toBeGreaterThan(3);
      }
  });
}
