// The structure of a GLB as the game sees it (three.js GLTFLoader with the meshopt
// decoder): used by scripts/compress-models.mjs to check its output against the
// source, and by tests/model-compression.test.ts against the recorded manifest.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BOUNDS_TOLERANCE = 1e-3;

/** What must survive compression, read the way the game reads it. */
export async function describe(bytes) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { scene } = await loader.parseAsync(buffer, '');
  scene.updateMatrixWorld(true);
  const round = (v) => Math.round(v * 1e5) / 1e5;
  const objects = [];
  scene.traverse((o) => {
    if (o === scene) return;
    const entry = {
      name: o.name,
      type: o.type,
      position: o.position.toArray().map(round),
      quaternion: o.quaternion.toArray().map(round),
      scale: o.scale.toArray().map(round),
    };
    if (Object.keys(o.userData).length) entry.userData = o.userData;
    if (o.isMesh) {
      const box = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position).applyMatrix4(o.matrixWorld);
      entry.bounds = [...box.min.toArray(), ...box.max.toArray()].map((v) => Math.round(v * 1e4) / 1e4);
      entry.material = o.material.name;
      entry.vertexColors = !!o.geometry.attributes.color;
      entry.triangles = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    }
    objects.push(entry);
  });
  return objects;
}

/** Throws unless the compressed model is the source model, as far as the renderer can tell. */
export function assertSameModel(file, before, after) {
  const fail = (why) => {
    throw new Error(`${file}: ${why}`);
  };
  if (before.length !== after.length) fail(`object count ${before.length} -> ${after.length}`);
  before.forEach((a, i) => {
    const b = after[i];
    const at = `object ${i} "${a.name}"`;
    if (a.name !== b.name || a.type !== b.type) fail(`${at} became "${b.name}" (${b.type})`);
    for (const key of ['position', 'quaternion', 'scale'])
      if (a[key].some((v, k) => Math.abs(v - b[key][k]) > 1e-4)) fail(`${at} ${key} ${a[key]} -> ${b[key]}`);
    if (JSON.stringify(a.userData ?? null) !== JSON.stringify(b.userData ?? null)) fail(`${at} userData changed`);
    if (a.material !== b.material) fail(`${at} material ${a.material} -> ${b.material}`);
    if (a.vertexColors !== b.vertexColors) fail(`${at} lost its vertex colours`);
    if (a.triangles !== b.triangles) fail(`${at} triangles ${a.triangles} -> ${b.triangles}`);
    if (a.bounds && a.bounds.some((v, k) => Math.abs(v - b.bounds[k]) > BOUNDS_TOLERANCE))
      fail(`${at} bounds ${a.bounds} -> ${b.bounds}`);
  });
}
