import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Every GLB under `public/models` is compressed with EXT_meshopt_compression
 * (`scripts/compress-models.mjs`), so every GLTFLoader must know the decoder.
 * Pass this as the third argument of `useLoader(GLTFLoader, url, withMeshopt)`.
 */
export function withMeshopt(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/** A GLTFLoader that can read the compressed models. */
export function gltfLoader() {
  const loader = new GLTFLoader();
  withMeshopt(loader);
  return loader;
}

/** Parses GLB bytes (a Node Buffer or an ArrayBuffer) with the meshopt decoder registered. */
export function parseGlb(bytes: ArrayBuffer | Uint8Array): Promise<GLTF> {
  const buffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  return gltfLoader().parseAsync(buffer, '');
}
