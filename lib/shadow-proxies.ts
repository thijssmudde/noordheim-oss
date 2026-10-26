import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Pivots the renderer animates in a way a shadow shows (turret yaw, walking
 * legs, a lifting door, cargo height). Wheels, tracks and other rigid parts
 * move too little to change a shadow and ride with their parent.
 */
const PIVOT =
  /^(leg_|arm_|torso|turret|barrel|rotor_pivot|tail_rotor_mount|cargo_fill|flag|radar_dish|door)/;

/** Never drawn in colour: shadow proxies only take part in the shadow pass. */
export const SHADOW_PROXY_MATERIAL = new THREE.MeshBasicMaterial({ name: 'shadow_proxy' });

const compiled = new WeakMap<THREE.Object3D, THREE.Object3D>();

/**
 * Equipment is drawn as many meshes (one per material and animated part), and
 * the shadow pass drew every one of them again. This merges each animated
 * part's meshes, whatever their material, into one hidden "shadow proxy" mesh
 * parented to that part, and stops the visible meshes casting. The shadow is
 * the same geometry with far fewer draw calls. Proxies stay invisible except
 * during the shadow pass (see `installShadowProxies`).
 *
 * Returns a cached copy per source; clone it per instance.
 */
export function withShadowProxies(source: THREE.Object3D): THREE.Object3D {
  const cached = compiled.get(source);
  if (cached) return cached;
  const model = source.clone(true);
  model.updateMatrixWorld(true);
  const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) return;
    let owner: THREE.Object3D = model;
    for (let p: THREE.Object3D | null = o; p && p !== model; p = p.parent)
      if (PIVOT.test(p.name)) {
        owner = p;
        break;
      }
    const list = groups.get(owner) ?? [];
    list.push(o);
    groups.set(owner, list);
  });
  const toOwner = new THREE.Matrix4();
  for (const [owner, meshes] of groups) {
    const inverse = owner.matrixWorld.clone().invert();
    const parts = meshes.map((mesh) => {
      const source = mesh.geometry.getAttribute('position');
      const positions = new Float32Array(source.count * 3);
      for (let i = 0; i < source.count; i++) {
        positions[i * 3] = source.getX(i);
        positions[i * 3 + 1] = source.getY(i);
        positions[i * 3 + 2] = source.getZ(i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const index = mesh.geometry.index;
      g.setIndex(index ? Array.from(index.array) : Array.from({ length: source.count }, (_, i) => i));
      return g.applyMatrix4(toOwner.multiplyMatrices(inverse, mesh.matrixWorld));
    });
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const proxy = new THREE.Mesh(merged, SHADOW_PROXY_MATERIAL);
    proxy.name = 'shadow_proxy';
    proxy.userData.shadowProxy = true;
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.visible = false;
    proxy.raycast = () => {};
    owner.add(proxy);
    for (const mesh of meshes) {
      mesh.castShadow = false;
      mesh.userData.shadowByProxy = true;
    }
  }
  compiled.set(source, model);
  return model;
}

const live = new Set<THREE.Object3D>();
const patched = new WeakSet<THREE.WebGLShadowMap>();

/**
 * Shows the registered proxies for the duration of each shadow-map render, so
 * the main pass never draws them. Idempotent per renderer.
 */
export function installShadowProxies(gl: THREE.WebGLRenderer) {
  const map = gl.shadowMap;
  if (patched.has(map)) return;
  patched.add(map);
  const render = map.render.bind(map);
  map.render = (...args: Parameters<typeof render>) => {
    for (const proxy of live) proxy.visible = true;
    try {
      render(...args);
    } finally {
      for (const proxy of live) proxy.visible = false;
    }
  };
}

/** Proxies of a mounted model take part in the shadow pass until the returned cleanup runs. */
export function registerShadowProxies(model: THREE.Object3D) {
  const proxies: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o.userData.shadowProxy) proxies.push(o);
  });
  proxies.forEach((p) => live.add(p));
  return () => proxies.forEach((p) => live.delete(p));
}
