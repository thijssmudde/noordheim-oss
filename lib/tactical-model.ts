import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const compiled = new WeakMap<THREE.Object3D, THREE.Object3D>();
/** Rig pivots, building animation nodes and effect anchors must stay separate objects. */
const animated =
  /^(leg_|arm_|torso|turret|barrel|muzzle|wheel_|track_|rotor_pivot|tail_rotor_mount|cargo_fill|flag|radar_dish|door|smoke_|light_)/;

/** Bake constant paint into vertex colours and batch compatible rigid parts once.
 * Local animation pivots, cargo, faction paint, material response and bounds survive.
 * Cached geometry has the same lifetime as its shared GLTFLoader source.
 */
export function batchEquipment(source: THREE.Object3D): THREE.Object3D {
  const cached = compiled.get(source);
  if (cached) return cached;
  const model = source.clone(true);
  const parents: THREE.Object3D[] = [];
  model.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const groups = new Map<
      string,
      THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]
    >();
    for (const child of parent.children) {
      if (
        !(child instanceof THREE.Mesh) ||
        child instanceof THREE.SkinnedMesh ||
        child.children.length ||
        animated.test(child.name)
      )
        continue;
      const m = child.material;
      if (
        !(m instanceof THREE.MeshStandardMaterial) ||
        m.name === 'culture_trim' ||
        m.map ||
        m.normalMap ||
        m.roughnessMap ||
        m.metalnessMap ||
        m.aoMap ||
        m.alphaMap ||
        m.emissiveMap ||
        m.transparent ||
        child.geometry.morphAttributes.position
      )
        continue;
      const key = [
        m.roughness,
        m.metalness,
        m.side,
        m.opacity,
        m.emissive.getHexString(),
        m.emissiveIntensity,
        m.depthWrite,
        m.depthTest,
        m.flatShading,
      ].join(':');
      const group = groups.get(key) ?? [];
      group.push(child);
      groups.set(key, group);
    }
    for (const parts of groups.values()) {
      if (parts.length < 2) continue;
      const geometries = parts.map((part) => {
        part.updateMatrix();
        const g = part.geometry.clone();
        // Retain shared vertices. Expanding indexed GLBs into triangle soup
        // duplicates position, normal and paint buffers on both CPU and GPU.
        if (!g.index)
          g.setIndex(
            Array.from({ length: g.attributes.position.count }, (_, i) => i),
          );
        const count = g.attributes.position.count;
        const original = g.attributes.color;
        const color = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          color[i * 3] =
            (original && part.material.vertexColors ? original.getX(i) : 1) *
            part.material.color.r;
          color[i * 3 + 1] =
            (original && part.material.vertexColors ? original.getY(i) : 1) *
            part.material.color.g;
          color[i * 3 + 2] =
            (original && part.material.vertexColors ? original.getZ(i) : 1) *
            part.material.color.b;
        }
        for (const name of Object.keys(g.attributes))
          if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        g.setAttribute('color', new THREE.BufferAttribute(color, 3));
        if (!g.attributes.normal) g.computeVertexNormals();
        return g.applyMatrix4(part.matrix);
      });
      const geometry = mergeGeometries(geometries);
      geometries.forEach((g) => g.dispose());
      if (!geometry) continue;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = parts[0].material.clone();
      material.color.set(0xffffff);
      material.vertexColors = true;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'batched_rigid_parts';
      parts.forEach((part) => parent.remove(part));
      parent.add(mesh);
    }
  }
  compiled.set(source, model);
  return model;
}
