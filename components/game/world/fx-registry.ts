import * as THREE from 'three';

/**
 * Plain module-level registries that connect rendered models to the effect
 * systems without React re-renders: equipment registers its muzzle and its
 * building emitters on mount; the combat and ambient effect loops read them.
 */

/** Barrel tips by entity id: flashes and tracers leave from here. */
export const muzzles = new Map<string, THREE.Object3D>();

export type Emitter = {
  /** The node; its world position is read each frame (turrets turn, doors lift). */
  node: THREE.Object3D;
  kind: 'smoke' | 'light';
  /** Smoke: puffs per second. Light: glow radius in metres. */
  strength: number;
};
/** Chimney smoke (`smoke_*`) and lamps (`light_*`) of standing structures. */
export const emitters = new Map<string, Emitter[]>();

/** Each troop's root group (its interpolated pose), so a carried flag can ride on it. */
export const unitBodies = new Map<string, THREE.Object3D>();

/** Construction sites currently rising, for scaffold dust. */
export const constructionSites = new Map<string, { x: number; z: number; y: number; radius: number }>();

const scratch = new THREE.Vector3();
/** World position of a registered muzzle, or null. */
export function muzzlePosition(id: string, target = scratch) {
  const node = muzzles.get(id);
  if (!node || !node.parent) return null;
  return node.getWorldPosition(target);
}
