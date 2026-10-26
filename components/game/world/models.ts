/**
 * Every GLB URL carries this version so browsers and the CDN fetch the new file
 * when the art is re-exported or recompressed (`scripts/compress-models.mjs`).
 * `/models/*` is served with an immutable cache header (public/_headers), so
 * bump this whenever any file under public/models changes.
 */
export const MODEL_VERSION = 'meshopt-1';
/** A model under public/models, e.g. `modelUrl('landscape/granite_1')`. */
export const modelUrl = (path: string) => `/models/${path}.glb?v=${MODEL_VERSION}`;
/** Equipment GLBs (buildings and troops). */
export const modelPath = (kind: string) => modelUrl(`tactical/${kind}`);
