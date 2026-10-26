'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CompiledMap } from '@/lib/maps/types';
import { noise2, seeded } from './world-map';
import { PLINTH_TOP } from './diorama-edge';
import { sunDirection } from './lighting';
import { worldNoiseGLSL } from './shader-chunks';

const ignoreRaycast = () => {};
/** The mist the diorama stands in, well below the plinth. */
const MIST_Y = PLINTH_TOP - 6.5;

/** A ring of jagged, snow-capped peaks far beyond the table, fading into the sky. */
function mountainRing(map: CompiledMap) {
  const { bounds, design } = map;
  const random = seeded(design.ground.seed * 7 + 311);
  const cx = (bounds.minX + bounds.maxX) / 2,
    cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  const snowCap = new THREE.Color(design.palette.snow);
  const rock = new THREE.Color(design.palette.cliff).multiplyScalar(0.8);
  const forest = new THREE.Color('#2f4a3a').multiplyScalar(0.7);
  const parts: THREE.BufferGeometry[] = [];
  const peaks = 96;
  for (let i = 0; i < peaks; i++) {
    const a = (i / peaks) * Math.PI * 2 + random() * 0.08;
    const back = random();
    const r = half * (1.6 + back * 0.9);
    const height = half * (0.2 + random() * 0.26) * (0.8 + back * 0.6);
    const radius = height * (0.85 + random() * 0.6);
    const cone = new THREE.ConeGeometry(radius, height - MIST_Y + 20, 14, 8, true);
    const p = cone.getAttribute('position');
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v),
        y = p.getY(v),
        z = p.getZ(v);
      const t = (y + (height - MIST_Y + 20) / 2) / (height - MIST_Y + 20);
      // Jagged ridges: push vertices in and out, sharper towards the top.
      const n =
        Math.sin(x * 0.05 + i) * Math.cos(z * 0.07 - i * 1.3) * 0.5 +
        Math.sin(Math.atan2(z, x) * 5 + i) * 0.3 +
        (random() - 0.5) * 0.45;
      const k = Math.max(0.2, 1 + n * 0.42 * (0.3 + t));
      p.setXYZ(v, x * k, y + (random() - 0.5) * height * 0.04, z * k);
      const snowLine = 0.62 + Math.sin(a * 5 + x * 0.02) * 0.08;
      c.copy(t < 0.3 ? forest : rock).lerp(snowCap, THREE.MathUtils.smoothstep(t, snowLine - 0.04, snowLine + 0.05));
      colors.set([c.r, c.g, c.b], v * 3);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    cone.deleteAttribute('uv');
    cone.rotateY(random() * Math.PI);
    cone.translate(cx + Math.cos(a) * r, MIST_Y - 20 + (height - MIST_Y + 20) / 2, cz + Math.sin(a) * r);
    parts.push(cone.toNonIndexed());
    cone.dispose();
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** How far the foothills reach past the board, as a share of its half-diagonal. */
const FOOTHILL_REACH = 0.75;

/**
 * Snowy, forested foothills in the mist around the table: they rise out of the
 * cloud a short way past the cut edge, so even at play zoom the board sits in
 * a landscape instead of a void.
 */
function foothills(map: CompiledMap) {
  const { bounds, design } = map;
  const cx = (bounds.minX + bounds.maxX) / 2,
    cz = (bounds.minZ + bounds.maxZ) / 2;
  const hw = (bounds.maxX - bounds.minX) / 2,
    hd = (bounds.maxZ - bounds.minZ) / 2;
  const half = Math.hypot(hw, hd);
  const reach = half * FOOTHILL_REACH;
  const segments = 220;
  const sx = (hw + reach) * 2,
    sz = (hd + reach) * 2;
  const seed = design.ground.seed * 0.013;
  const fbm = (x: number, z: number) =>
    noise2(x + seed, z - seed) * 0.55 +
    noise2(x * 2.1 - seed, z * 2.1 + 3.7) * 0.28 +
    noise2(x * 4.3 + 9.1, z * 4.3 - seed) * 0.17;
  const heightAt = (x: number, z: number) => {
    const out = Math.hypot(
      Math.max(0, Math.abs(x - cx) - hw),
      Math.max(0, Math.abs(z - cz) - hd),
    );
    const rise = THREE.MathUtils.smoothstep(out, 8, reach * 0.8);
    // Ridged hills: sharp crests read as mountains-in-miniature.
    const ridge = 1 - Math.abs(fbm(x * 0.009, z * 0.009) * 2 - 1);
    const lump = fbm(x * 0.022 + 5, z * 0.022);
    return MIST_Y - 10 + rise * (8 + ridge * ridge * 30 + lump * 10) + lump * 4;
  };
  const geometry = new THREE.PlaneGeometry(sx, sz, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(cx, 0, cz);
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  // Drop cells hidden under the board so they cost nothing.
  const index = geometry.getIndex()!;
  const kept: number[] = [];
  const under = (v: number) =>
    Math.abs(p.getX(v) - cx) < hw - 2 && Math.abs(p.getZ(v) - cz) < hd - 2;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (!(under(a) && under(b) && under(c))) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal');
  const snow = new THREE.Color(design.palette.snow);
  const rock = new THREE.Color(design.palette.cliff).multiplyScalar(0.85);
  const forest = new THREE.Color('#24392d').lerp(new THREE.Color(design.palette.grass), 0.2).multiplyScalar(0.55);
  const cover = design.atmosphere.snowCover;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      up = (p.getY(i) - MIST_Y) / 40;
    const steep = 1 - THREE.MathUtils.smoothstep(n.getY(i), 0.6, 0.85);
    // Forest skirts the lower slopes in patches; snow takes the crests.
    const patch = noise2(x * 0.016, z * 0.016) * 0.7 + noise2(x * 0.06, z * 0.06) * 0.3;
    const woods = THREE.MathUtils.smoothstep(patch, 0.38, 0.55) * (1 - THREE.MathUtils.smoothstep(up, 0.45, 0.75));
    // A touch dimmer than the board, so the playable ground stays the brightest thing in view.
    c.copy(snow).multiplyScalar(0.8);
    c.lerp(forest, Math.min(1, woods * (1.25 - cover * 0.3)));
    c.lerp(rock, steep * 0.85);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Vertex-coloured distant land that fades into the sky with distance and into mist at its feet. */
function hazeMaterial(
  haze: THREE.Color,
  distance: THREE.Color,
  { feet, aerial, key, flatShading }: { feet: number; aerial: number; key: string; flatShading: boolean },
) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHaze = { value: haze };
    shader.uniforms.uDistance = { value: distance };
    shader.vertexShader = `varying vec3 vRange;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vRange = (modelMatrix * vec4(position, 1.)).xyz;`,
    );
    shader.fragmentShader = `uniform vec3 uHaze, uDistance; varying vec3 vRange;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      `// Aerial perspective: distant ranges fade to the horizon, their feet into mist.
      float far = 1. - exp(-distance(vRange, cameraPosition) * .0016);
      float feet = 1. - smoothstep(${MIST_Y.toFixed(1)}, ${(MIST_Y + feet).toFixed(1)}, vRange.y);
      outgoingLight = mix(outgoingLight, uDistance, clamp(far * ${aerial.toFixed(2)}, 0., .9));
      outgoingLight = mix(outgoingLight, uHaze, clamp(feet * .85, 0., .95));
      #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/**
 * Beyond the table: the diorama floats over a sea of mist with a ring of
 * distant mountains, both dissolving into the sky's horizon colour, so no
 * camera angle ever looks into a black void.
 */
export function Backdrop({ map }: { map: CompiledMap }) {
  const { bounds, design } = map;
  const assets = useMemo(() => {
    const a = design.atmosphere;
    const haze = new THREE.Color(a.horizon).lerp(new THREE.Color(a.fog), 0.5);
    // Dusk skies get a dim mist; bright days a pale one that still frames the board.
    const sky = new THREE.Color(a.sky);
    const light = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b;
    haze.multiplyScalar(THREE.MathUtils.clamp(light * 1.6, 0.35, 0.85));
    const distance = new THREE.Color(a.horizon).lerp(new THREE.Color(a.sky), 0.45);
    const mountains = mountainRing(map);
    const mountainMaterial = hazeMaterial(haze, distance, { feet: 70, aerial: 0.62, key: 'diorama-mountains-v1', flatShading: true });
    const hills = foothills(map);
    const hillMaterial = hazeMaterial(haze, distance, { feet: 7, aerial: 0.3, key: 'diorama-foothills-v1', flatShading: false });
    const width = bounds.maxX - bounds.minX,
      depth = bounds.maxZ - bounds.minZ;
    const mist = new THREE.ShaderMaterial({
      depthWrite: true,
      uniforms: {
        uHaze: { value: haze },
        uShade: { value: new THREE.Color(a.bounce).multiplyScalar(0.28) },
        uCentre: { value: new THREE.Vector2((bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2) },
        uSize: { value: new THREE.Vector2(width, depth) },
        uSun: { value: new THREE.Vector3(...sunDirection(a)).normalize() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vMist;
        void main() { vec4 w = modelMatrix * vec4(position, 1.); vMist = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHaze, uShade, uSun; uniform vec2 uCentre, uSize; uniform float uTime; varying vec3 vMist;
        ${worldNoiseGLSL}
        void main() {
          vec2 rel = (vMist.xz - uCentre) / (uSize * .5);
          // Slow billows of cloud drifting past the table legs.
          vec2 drift = vec2(uTime * .9, uTime * .35);
          float billow = worldFbm((vMist.xz + drift) * .012);
          float wisp = worldFbm((vMist.xz - drift * 1.7) * .035 + 4.);
          float cloud = smoothstep(.3, .8, billow * .7 + wisp * .3);
          // A soft shadow of the plinth falls away from the sun onto the cloud.
          vec2 away = rel + normalize(uSun.xz + 1e-4) * .08;
          float box = max(abs(away.x), abs(away.y));
          float shadow = 1. - smoothstep(.98, 1.25, box);
          vec3 c = mix(uHaze * .72, uHaze * 1.08, cloud);
          c = mix(c, uShade, shadow * .45);
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    return { mountains, mountainMaterial, hills, hillMaterial, mist, size: Math.max(width, depth) * 40, haze };
  }, [map, bounds, design]);
  useEffect(
    () => () => {
      assets.mountains.dispose();
      assets.mountainMaterial.dispose();
      assets.hills.dispose();
      assets.hillMaterial.dispose();
      assets.mist.dispose();
    },
    [assets],
  );
  const mist = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>(null);
  useFrame(({ clock }) => {
    if (mist.current) mist.current.material.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <group>
      <mesh
        ref={mist}
        position={[(bounds.minX + bounds.maxX) / 2, MIST_Y, (bounds.minZ + bounds.maxZ) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={assets.mist}
        raycast={ignoreRaycast}
      >
        <planeGeometry args={[assets.size, assets.size]} />
      </mesh>
      <mesh geometry={assets.hills} material={assets.hillMaterial} receiveShadow raycast={ignoreRaycast} />
      <mesh geometry={assets.mountains} material={assets.mountainMaterial} raycast={ignoreRaycast} />
    </group>
  );
}
