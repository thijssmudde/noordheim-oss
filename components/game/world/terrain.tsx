'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { CompiledMap } from '@/lib/maps/types';
import { SURFACE_ATLAS, surfaceGLSL } from '../surface-detail';
import { TERRAIN_INDEX, type WorldGrid } from './world-map';
import type { WorldMasks } from './masks';
import { worldNoiseGLSL } from './shader-chunks';

// Start the shared atlas download as soon as the renderer's code arrives, not
// when the first material that needs it mounts.
if (typeof window !== 'undefined') useLoader.preload(THREE.TextureLoader, SURFACE_ATLAS);

const TILE = 64;
const ignoreRaycast = () => {};

/**
 * Per-lattice surface weights (sand, gravel bank, marsh, drift), softened with
 * two box blurs so terrain classes meet in painterly gradients.
 */
function surfaceWeights(grid: WorldGrid) {
  const { width, depth, heights, terrain } = grid;
  const n = width * depth;
  let a = new Float32Array(n * 4);
  for (let iz = 0; iz < depth; iz++)
    for (let ix = 0; ix < width; ix++) {
      const i = iz * width + ix;
      const t = terrain[i];
      const o = i * 4;
      if (t === TERRAIN_INDEX.shore) a[o] = 1;
      if (t === TERRAIN_INDEX.bank) a[o + 1] = 1;
      if (t === TERRAIN_INDEX.ford) a[o + 1] = 0.7;
      if (t === TERRAIN_INDEX.marsh) a[o + 2] = 1;
      // Snow drifts pile against the foot of cliffs and ridges.
      const h = heights[i];
      let rise = 0;
      for (let r = 2; r <= 4; r += 2)
        for (const [dx, dz] of [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
          [r, r],
          [-r, -r],
          [r, -r],
          [-r, r],
        ]) {
          const x = ix + dx,
            z = iz + dz;
          if (x < 0 || z < 0 || x >= width || z >= depth) continue;
          rise = Math.max(rise, heights[z * width + x] - h);
        }
      a[o + 3] = Math.min(1, Math.max(0, (rise - 1.2) / 2));
    }
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(n * 4);
    for (let iz = 0; iz < depth; iz++)
      for (let ix = 0; ix < width; ix++) {
        let count = 0;
        const sum = [0, 0, 0, 0];
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = ix + dx,
              z = iz + dz;
            if (x < 0 || z < 0 || x >= width || z >= depth) continue;
            const o = (z * width + x) * 4;
            for (let c = 0; c < 4; c++) sum[c] += a[o + c];
            count++;
          }
        const o = (iz * width + ix) * 4;
        for (let c = 0; c < 4; c++) b[o + c] = sum[c] / count;
      }
    a = b;
  }
  return a;
}

export type TerrainTile = {
  /** Index levels share one vertex buffer: full, half and quarter resolution, each with skirts. */
  levels: THREE.BufferGeometry[];
  centre: THREE.Vector3;
};

/**
 * Terrain tiles at the lattice's full one-metre resolution, with half and
 * quarter resolution index sets for distant tiles. Skirts hang from every tile
 * edge so neighbours at different resolutions never show a crack.
 */
export function buildTerrainTiles(grid: WorldGrid): TerrainTile[] {
  const { width, depth, minX, minZ, heights } = grid;
  const surf = surfaceWeights(grid);
  const h = (ix: number, iz: number) =>
    heights[
      Math.min(depth - 1, Math.max(0, iz)) * width +
        Math.min(width - 1, Math.max(0, ix))
    ];
  const tiles: TerrainTile[] = [];
  for (let tz = 0; tz < depth - 1; tz += TILE)
    for (let tx = 0; tx < width - 1; tx += TILE) {
      const cols = Math.min(TILE, width - 1 - tx) + 1,
        rows = Math.min(TILE, depth - 1 - tz) + 1;
      // Edge vertices get a skirt twin 1.5 m lower, appended after the grid.
      const edge: number[] = [];
      for (let c = 0; c < cols; c++) edge.push(c);
      for (let r = 1; r < rows; r++) edge.push(r * cols + cols - 1);
      for (let c = cols - 2; c >= 0; c--) edge.push((rows - 1) * cols + c);
      for (let r = rows - 2; r >= 1; r--) edge.push(r * cols);
      const count = cols * rows + edge.length;
      const position = new Float32Array(count * 3),
        normal = new Float32Array(count * 3),
        surface = new Float32Array(count * 4),
        shape = new Float32Array(count);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const ix = tx + c,
            iz = tz + r;
          const v = r * cols + c;
          position[v * 3] = minX + ix;
          position[v * 3 + 1] = h(ix, iz);
          position[v * 3 + 2] = minZ + iz;
          const nx = h(ix - 1, iz) - h(ix + 1, iz),
            nz = h(ix, iz - 1) - h(ix, iz + 1);
          const l = Math.hypot(nx, 2, nz);
          normal[v * 3] = nx / l;
          normal[v * 3 + 1] = 2 / l;
          normal[v * 3 + 2] = nz / l;
          const s = (iz * width + ix) * 4;
          surface.set(surf.subarray(s, s + 4), v * 4);
          // Curvature at two scales: hollows darken, crests catch the light.
          const here = h(ix, iz);
          const near =
            (h(ix - 2, iz) + h(ix + 2, iz) + h(ix, iz - 2) + h(ix, iz + 2)) / 4 - here;
          const far =
            (h(ix - 6, iz) + h(ix + 6, iz) + h(ix, iz - 6) + h(ix, iz + 6)) / 4 - here;
          shape[v] = Math.max(-1, Math.min(1, near * 0.7 + far * 0.35));
        }
      const skirtOf = new Map<number, number>();
      edge.forEach((v, k) => {
        const w = cols * rows + k;
        skirtOf.set(v, w);
        position[w * 3] = position[v * 3];
        position[w * 3 + 1] = position[v * 3 + 1] - 1.5;
        position[w * 3 + 2] = position[v * 3 + 2];
        normal.copyWithin(w * 3, v * 3, v * 3 + 3);
        surface.copyWithin(w * 4, v * 4, v * 4 + 4);
        shape[w] = shape[v];
      });
      const attributes = {
        position: new THREE.BufferAttribute(position, 3),
        normal: new THREE.BufferAttribute(normal, 3),
        surface: new THREE.BufferAttribute(surface, 4),
        shape: new THREE.BufferAttribute(shape, 1),
      };
      const levels: THREE.BufferGeometry[] = [];
      for (const stride of [1, 2, 4]) {
        const index: number[] = [];
        const at = (r: number, c: number) =>
          Math.min(r, rows - 1) * cols + Math.min(c, cols - 1);
        for (let r = 0; r < rows - 1; r += stride)
          for (let c = 0; c < cols - 1; c += stride) {
            const a = at(r, c),
              b = at(r, c + stride),
              d = at(r + stride, c),
              e = at(r + stride, c + stride);
            if (a === b || a === d) continue;
            // Alternate the diagonal to avoid a directional grain.
            if (((r + c) / stride) % 2) index.push(a, d, b, b, d, e);
            else index.push(a, d, e, a, e, b);
          }
        // Skirts along the edge at this level's spacing.
        const ring: number[] = [];
        for (let c = 0; c < cols - 1; c += stride) ring.push(at(0, c));
        for (let r = 0; r < rows - 1; r += stride) ring.push(at(r, cols - 1));
        for (let c = cols - 1; c > 0; c -= stride) ring.push(at(rows - 1, c));
        for (let r = rows - 1; r > 0; r -= stride) ring.push(at(r, 0));
        for (let k = 0; k < ring.length; k++) {
          const v0 = ring[k],
            v1 = ring[(k + 1) % ring.length];
          const s0 = skirtOf.get(v0),
            s1 = skirtOf.get(v1);
          if (s0 === undefined || s1 === undefined) continue;
          index.push(v0, s0, v1, v1, s0, s1, v0, v1, s0, v1, s1, s0);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', attributes.position);
        g.setAttribute('normal', attributes.normal);
        g.setAttribute('surface', attributes.surface);
        g.setAttribute('shape', attributes.shape);
        g.setIndex(index);
        g.computeBoundingBox();
        g.computeBoundingSphere();
        levels.push(g);
      }
      tiles.push({
        levels,
        centre: levels[0].boundingSphere!.center.clone(),
      });
    }
  return tiles;
}

export type TerrainUniforms = ReturnType<typeof terrainUniforms>;
export function terrainUniforms(
  map: CompiledMap,
  masks: WorldMasks,
  atlas: THREE.Texture,
  time: THREE.Uniform<number>,
) {
  const p = map.design.palette;
  const c = (hex: string) => new THREE.Uniform(new THREE.Color(hex));
  return {
    worldTime: time,
    northernAtlas: new THREE.Uniform(atlas),
    uSurface: new THREE.Uniform(masks.surface),
    uRect: new THREE.Uniform(masks.rect),
    uSnowCover: new THREE.Uniform(map.design.atmosphere.snowCover),
    uSnow: c(p.snow),
    uGrass: c(p.grass),
    uEarth: c(p.earth),
    uGravel: c(p.gravel),
    uRock: c(p.rock),
    uCliff: c(p.cliff),
    uSand: c(p.sand),
    uMarsh: c(p.marsh),
    uRoad: c(p.road),
    uShallow: c(p.shallow),
    uDeep: c(p.deep),
  };
}

const terrainFragment = /* glsl */ `
  #include <color_fragment>
  vec2 wp = vWorld.xz;
  vec4 masks = texture2D(uSurface, (wp - uRect.xy) / uRect.zw);
  // Domain-warped fields keep patches organic instead of grid-aligned.
  vec2 warp = vec2(worldNoise(wp * .021 + 3.1), worldNoise(wp * .021 - 8.7)) - .5;
  // Drifts stretch along the prevailing wind.
  vec2 q = (wp + warp * 26.) * vec2(.72, 1.25);
  mat2 turn = mat2(.8, -.6, .6, .8);
  float macro = worldNoise(q * .009);
  float broad = worldFbm(turn * q * .032 + 17.);
  float mid = worldFbm(turn * turn * q * .13 - 5.);
  float fine = worldNoise(turn * wp * 1.1 + 3.);
  float slope = 1. - clamp(vWorldNormal.y, 0., 1.);
  float earthTex = northernTile(wp * .21, vec2(1., 1.));
  float snowTex = northernTile(wp * .08 + vec2(broad * 3., mid), vec2(0., 0.));
  float rockTex = northernRock(vWorld * 1.15, vWorldNormal);

  // Lowland: olive heath and dry grass, earth showing through in worn patches.
  vec3 olive = mix(uGrass, vec3(dot(uGrass, vec3(.3, .59, .11))), .18) * vec3(1.04, 1., .9);
  vec3 grass = mix(olive * vec3(.84, .9, .8), olive * vec3(1.14, 1.05, .82), smoothstep(.3, .7, mid));
  float bare = smoothstep(.56, .78, broad * .55 + (1. - mid) * .45);
  vec3 heath = mix(grass, uEarth * (.82 + earthTex * .36), bare * .75);
  heath *= .88 + fine * .1 + (macro - .5) * .2;
  heath *= .9 + earthTex * .18;
  // Needle litter and moss under the trees.
  heath = mix(heath, uEarth * vec3(.58, .6, .48) * (.8 + earthTex * .4), masks.a * .8);
  vec3 ground = heath;
  ground = mix(ground, uGravel * (.74 + fine * .2 + rockTex * .25), vSurface.y);
  ground = mix(ground, uSand * (.9 + mid * .12 + earthTex * .1), vSurface.x);
  float puddle = smoothstep(.56, .64, worldNoise(q * .3 + 9.)) * vSurface.z;
  vec3 marsh = mix(uMarsh * (.78 + mid * .34), uMarsh * vec3(1.05, 1.0, .62) * 1.25, smoothstep(.45, .8, fine));
  marsh = mix(marsh, uDeep * .5, puddle);
  ground = mix(ground, marsh, vSurface.z);

  // Rock on steep ground: layered strata, lichen, triplanar grain.
  float strataCoord = vWorld.y * 1.7 + worldNoise(wp * .15) * 2.4;
  float strata = worldNoise(vec2(strataCoord, wp.x * .02 + wp.y * .02));
  vec3 rock = mix(uCliff, uRock, smoothstep(.3, .7, strata));
  rock *= .62 + rockTex * .7;
  rock = mix(rock, rock * vec3(.92, 1.04, .82), smoothstep(.6, .8, mid) * .6);
  float rockMask = smoothstep(.2, .34, slope + (mid - .5) * .12);
  ground = mix(ground, rock, rockMask);

  // Roads: ragged shoulders, compacted gravel or dark tarmac, tyre ruts.
  float road = smoothstep(.36, .62, masks.r + (mid - .5) * .3 + (fine - .5) * .1);
  vec3 gravelRoad = uRoad * (.82 + fine * .16 + earthTex * .22);
  vec3 tarmac = uRoad * vec3(.44, .45, .47) * (.85 + fine * .2);
  vec3 roadColor = mix(gravelRoad, tarmac, smoothstep(.3, .7, masks.b));
  roadColor *= 1. - masks.g * (.34 + fine * .12);
  float shoulder = smoothstep(.12, .4, masks.r) * (1. - road);
  ground = mix(ground, ground * vec3(.8, .74, .66), shoulder * .7);
  ground = mix(ground, roadColor, road);

  // Snow: flat tops, drifts against cliffs, thin on slopes, cleared on roads.
  float deep = smoothstep(.75, 1., uSnowCover);
  float soft = worldNoise(turn * q * .55 + 41.);
  float field = broad * .5 + mid * .26 + soft * .07 + (macro - .5) * .5 + .085;
  float snowAmount = field + (uSnowCover - .5) * .12 + max(0., uSnowCover - .8) * 1.5 - max(0., .25 - uSnowCover) * 2.;
  snowAmount += vSurface.w * .55 + clamp(vWorld.y - 2., 0., 6.) * .03;
  snowAmount -= slope * (1.6 + deep * 1.4) + masks.a * .2 + vSurface.z * .6 + vSurface.x * .3;
  snowAmount -= road * (.7 - masks.g * .1) - shoulder * .06;
  float breakup = worldNoise(wp * 2.3 + 7.) * .035 + worldNoise(wp * .9 - 3.) * .03;
  float snow = smoothstep(.46, .51, snowAmount + breakup - .03);
  vec3 snowColor = uSnow * (.94 + snowTex * .08);
  // Hollows and drift edges hold a colder tone.
  snowColor = mix(snowColor, snowColor * vec3(.86, .92, 1.03), (1. - smoothstep(.5, .6, snowAmount)) * .6);
  ground = mix(ground, snowColor, snow);
  // Deep-snow maps: wind-scoured glaze and blue ice where the cover runs thin.
  float scour = smoothstep(.6, .72, worldNoise(q * .06 + 3.) * .7 + soft * .3) * deep * snow;
  vec3 ice = mix(uShallow * 1.35, vec3(.82, .9, .96), .45) * (.9 + snowTex * .15);
  ground = mix(ground, ice, scour * .65);
  float drift = smoothstep(.35, .65, mid) * deep * snow;
  ground *= 1. - drift * .07;
  // Thin, broken snow at the edge of the drifts.
  float dust = smoothstep(.4, .475, snowAmount) * (1. - snow) * smoothstep(.45, .7, soft);
  ground = mix(ground, snowColor * .9, dust * .55);

  // Painterly relief: hollows and cliff feet darken and cool, crests warm up.
  float hollow = clamp(vShape, 0., 1.), crest = clamp(-vShape, 0., 1.);
  ground *= mix(vec3(1.), vec3(.72, .76, .86), hollow * .9);
  ground *= 1. + crest * vec3(.14, .1, .04);
  // Deep snow keeps a cool, varied tone at a distance.
  ground = mix(ground, ground * mix(vec3(.9, .94, 1.02), vec3(1.02, 1.0, .97), macro), deep * snow * .8);
  // Wet margins and the bed below the waterline.
  float wet = 1. - smoothstep(.02, .55, vWorld.y);
  ground *= 1. - wet * .32;
  ground = mix(ground, mix(uSand * .55, uDeep * .5, smoothstep(-.4, -3., vWorld.y)), smoothstep(0., -.25, vWorld.y));
  snow *= 1. - wet;
  diffuseColor.rgb = ground;
`;

const terrainRoughness = /* glsl */ `
  #include <roughnessmap_fragment>
  roughnessFactor = mix(.94, .72, snow);
  roughnessFactor = mix(roughnessFactor, .42, max(wet * .8, puddle));
  roughnessFactor = mix(roughnessFactor, .72, road * masks.b);
`;

const terrainEmissive = /* glsl */ `
  #include <emissivemap_fragment>
  // Snow sparkle: sparse ice crystals twinkle as the camera moves.
  {
    vec2 cell = floor(wp * 7.);
    float crystal = step(.9965, worldHash(cell + floor(cameraPosition.xz * .35) * 13.1));
    float facing = smoothstep(.3, .9, normalize(cameraPosition - vWorld).y);
    totalEmissiveRadiance += vec3(1., .97, .9) * crystal * snow * facing * 2.4 * (1. - smoothstep(40., 120., length(vViewPosition)));
  }
`;

const terrainNormal = /* glsl */ `
  #include <normal_fragment_maps>
  {
    float nearFade = 1. - smoothstep(60., 190., length(vViewPosition));
    float ripples = sin(dot(wp, vec2(.35, .94)) * 2.6 + worldNoise(wp * .21) * 7.) * .035 * snow * (.4 + deep);
    float relief = (rockTex * .22 * rockMask + snowTex * .07 * snow + earthTex * .05 * (1. - snow) + ripples
      - masks.g * road * .05 + fine * .02) * nearFade;
    vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
    vec3 r1 = cross(q1, normal), r2 = cross(normal, q0);
    float det = dot(q0, r1);
    normal = normalize(abs(det) * normal - sign(det) * (dFdx(relief) * r1 + dFdy(relief) * r2));
  }
`;

export function createTerrainMaterial(uniforms: TerrainUniforms) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec4 surface; attribute float shape;
      varying vec3 vWorld; varying vec3 vWorldNormal; varying vec4 vSurface; varying float vShape;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vWorld = (modelMatrix * vec4(position, 1.)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vSurface = surface;
      vShape = shape;`,
    );
    shader.fragmentShader = `
      ${surfaceGLSL}
      ${worldNoiseGLSL}
      uniform sampler2D uSurface; uniform vec4 uRect; uniform float uSnowCover, worldTime;
      uniform vec3 uSnow, uGrass, uEarth, uGravel, uRock, uCliff, uSand, uMarsh, uRoad, uShallow, uDeep;
      varying vec3 vWorld; varying vec3 vWorldNormal; varying vec4 vSurface; varying float vShape;
      ${shader.fragmentShader}`
      .replace('#include <color_fragment>', terrainFragment)
      .replace('#include <roughnessmap_fragment>', terrainRoughness)
      .replace('#include <normal_fragment_maps>', terrainNormal)
      .replace('#include <emissivemap_fragment>', terrainEmissive);
  };
  material.customProgramCacheKey = () => 'diorama-terrain-v2';
  return material;
}

/** The shared surface atlas tiles in world space. */
function repeatAtlas(atlas: THREE.Texture) {
  atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
  atlas.anisotropy = 8;
  return atlas;
}

/** Picks the tile's resolution by camera distance (with hysteresis). */
function Tile({ tile, material }: { tile: TerrainTile; material: THREE.Material }) {
  const mesh = useRef<THREE.Mesh>(null);
  const level = useRef(0);
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    const d = camera.position.distanceTo(tile.centre);
    const l = level.current;
    const next = d < (l === 0 ? 230 : 210) ? 0 : d < (l === 1 ? 470 : 440) ? 1 : 2;
    if (next !== l) {
      level.current = next;
      m.geometry = tile.levels[next];
    }
  });
  return (
    <mesh
      ref={mesh}
      geometry={tile.levels[0]}
      material={material}
      receiveShadow
      raycast={ignoreRaycast}
    />
  );
}

export function TerrainMesh({
  grid,
  map,
  masks,
  time,
}: {
  grid: WorldGrid;
  map: CompiledMap;
  masks: WorldMasks;
  time: THREE.Uniform<number>;
}) {
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const tiles = useMemo(() => buildTerrainTiles(grid), [grid]);
  const material = useMemo(
    () => createTerrainMaterial(terrainUniforms(map, masks, repeatAtlas(atlas), time)),
    [map, masks, atlas, time],
  );
  useEffect(
    () => () => {
      tiles.forEach((t) => t.levels.forEach((g) => g.dispose()));
      material.dispose();
    },
    [tiles, material],
  );
  return (
    <group>
      {tiles.map((tile, i) => (
        <Tile key={i} tile={tile} material={material} />
      ))}
    </group>
  );
}
