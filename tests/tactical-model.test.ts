import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { parseGlb } from '../lib/gltf';
import { batchEquipment } from '../lib/tactical-model';
const meshes = (o: THREE.Object3D) => {
  const list: THREE.Mesh[] = [];
  o.traverse((n) => {
    if (n instanceof THREE.Mesh) list.push(n);
  });
  return list;
};
for (const name of ['ranger', 'rocket', 'lynx', 'harvester', 'hq', 'gunship']) {
  test(`${name} batches paint without moving surfaces or removing animation pivots`, async () => {
    const bytes = readFileSync(
      new URL(`../public/models/tactical/${name}.glb`, import.meta.url),
    );
    const { scene } = await parseGlb(bytes);
    const before = meshes(scene).length;
    const result = batchEquipment(scene);
    expect(batchEquipment(scene)).toBe(result);
    expect(meshes(scene)).toHaveLength(before);
    // Already consolidated material families need no additional merge.
    expect(meshes(result).length).toBeLessThanOrEqual(before);
    const vertices = (object: THREE.Object3D) =>
      meshes(object).reduce(
        (sum, mesh) => sum + mesh.geometry.attributes.position.count,
        0,
      );
    const triangles = (object: THREE.Object3D) =>
      meshes(object).reduce(
        (sum, mesh) =>
          sum +
          (mesh.geometry.index?.count ??
            mesh.geometry.attributes.position.count) /
            3,
        0,
      );
    expect(vertices(result)).toBe(vertices(scene));
    expect(triangles(result)).toBe(triangles(scene));
    const a = new THREE.Box3().setFromObject(scene, true),
      b = new THREE.Box3().setFromObject(result, true);
    expect(a.min.distanceTo(b.min)).toBeLessThan(0.0001);
    expect(a.max.distanceTo(b.max)).toBeLessThan(0.0001);
    scene.traverse((n) => {
      if (/^(leg_|rotor_pivot|cargo_fill)/.test(n.name)) {
        const retained = result.getObjectByName(n.name);
        expect(retained).toBeDefined();
        expect(retained!.position.equals(n.position)).toBe(true);
        expect(retained!.quaternion.equals(n.quaternion)).toBe(true);
      }
    });
    const faction = (o: THREE.Object3D) =>
      meshes(o).filter(
        (m) => (m.material as THREE.Material).name === 'culture_trim',
      ).length;
    expect(faction(result)).toBe(faction(scene));
  });
}

test('different paint factors remain visible after combining compatible materials', () => {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ color: '#bf3020' }),
    ),
  );
  const second = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: '#326cb1' }),
  );
  second.position.x = 3;
  group.add(second);
  const result = batchEquipment(group);
  expect(meshes(result)).toHaveLength(1);
  const mesh = meshes(result)[0],
    colors = mesh.geometry.attributes.color;
  expect(colors.getX(0)).toBeCloseTo(
    (
      group.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >
    ).material.color.r,
  );
  expect(colors.getZ(colors.count - 1)).toBeCloseTo(second.material.color.b);
});

test('mixed indexed and unindexed parts merge without expanding shared vertices', () => {
  const indexed = new THREE.BoxGeometry();
  const unindexed = new THREE.BoxGeometry().toNonIndexed();
  const source = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  source.add(
    new THREE.Mesh(indexed, material),
    new THREE.Mesh(unindexed, material),
  );
  const [mesh] = meshes(batchEquipment(source));
  expect(mesh.geometry.attributes.position.count).toBe(
    indexed.attributes.position.count + unindexed.attributes.position.count,
  );
  expect(mesh.geometry.index?.count).toBe(
    indexed.index!.count + unindexed.attributes.position.count,
  );
});
