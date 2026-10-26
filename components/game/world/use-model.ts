'use client';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { withMeshopt } from '../../../lib/gltf';

/**
 * Starts a GLB download into the same cache `useModel` reads (keyed by URL
 * alone). Call it for every model a component needs before the first
 * `useModel`, so they download in parallel instead of one after another.
 */
export function preloadModel(url: string) {
  useLoader.preload(GLTFLoader, url, withMeshopt);
}

/**
 * One GLB, cached by its URL. Prefer this over `useLoader(GLTFLoader, [urls])`:
 * an array is cached under the whole array, so the same file requested alone
 * elsewhere (or preloaded) would download and parse twice.
 */
export function useModel(url: string): GLTF {
  return useLoader(GLTFLoader, url, withMeshopt);
}
