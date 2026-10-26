import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

for (const name of ['gull', 'technician', 'shore_patch']) {
  test(`${name} preserves original albedo alongside bounded vertex wear`, () => {
    const bytes = readFileSync(`public/models/environment/${name}.glb`);
    const asset = JSON.parse(
      bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
    );
    expect(bytes.length).toBeLessThan(180_000);
    for (const material of asset.materials) {
      // Blender's Multiply export once discarded this factor, turning props white.
      const color = material.pbrMetallicRoughness.baseColorFactor;
      expect(color).toHaveLength(4);
      expect(Math.max(...color.slice(0, 3))).toBeLessThan(0.8);
      expect(Math.min(...color.slice(0, 3))).toBeGreaterThan(0);
    }
    for (const mesh of asset.meshes)
      for (const primitive of mesh.primitives) {
        expect(primitive.attributes.COLOR_0).toBeDefined();
        expect(asset.accessors[primitive.attributes.COLOR_0].count).toBe(
          asset.accessors[primitive.attributes.POSITION].count,
        );
      }
    const pivots =
      name === 'gull'
        ? ['wing_left', 'wing_right']
        : name === 'technician'
          ? ['leg_left', 'leg_right', 'arm_left', 'arm_right']
          : [];
    for (const pivot of pivots)
      expect(
        asset.nodes.some((node: { name: string }) => node.name === pivot),
      ).toBe(true);
  });
}
