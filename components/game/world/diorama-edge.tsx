'use client';
import { useEffect, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL, type CompiledMap } from '@/lib/maps/types';
import { SURFACE_ATLAS, surfaceGLSL } from '../surface-detail';
import type { WorldGrid } from './world-map';
import { worldNoiseGLSL } from './shader-chunks';

const ignoreRaycast = () => {};
/** Where the terrain block stands on its wooden plinth. */
export const PLINTH_TOP = -7.5;
const PLINTH_HEIGHT = 5;
const PLINTH_MARGIN = 3.5;

type Side = { along: 'x' | 'z'; fixed: number; outward: [number, number] };

/** The four cut faces of the terrain block: soil, rock strata and snow crust, plus resin water. */
function buildWalls(grid: WorldGrid) {
  const { width, depth, minX, minZ, heights } = grid;
  const maxX = minX + width - 1,
    maxZ = minZ + depth - 1;
  const sides: Side[] = [
    { along: 'x', fixed: minZ, outward: [0, -1] },
    { along: 'x', fixed: maxZ, outward: [0, 1] },
    { along: 'z', fixed: minX, outward: [-1, 0] },
    { along: 'z', fixed: maxX, outward: [1, 0] },
  ];
  const soil = { position: [] as number[], normal: [] as number[], top: [] as number[], index: [] as number[] };
  const water = { position: [] as number[], normal: [] as number[], top: [] as number[], index: [] as number[] };
  for (const side of sides) {
    const count = side.along === 'x' ? width : depth;
    const sample = (i: number) => {
      const ix = side.along === 'x' ? i : side.fixed === minX ? 0 : width - 1;
      const iz = side.along === 'z' ? i : side.fixed === minZ ? 0 : depth - 1;
      return { x: minX + ix, z: minZ + iz, h: heights[iz * width + ix] };
    };
    const base = soil.position.length / 3;
    const wBase = water.position.length / 3;
    for (let i = 0; i < count; i++) {
      const s = sample(i);
      soil.position.push(s.x, s.h, s.z, s.x, PLINTH_TOP, s.z);
      soil.normal.push(side.outward[0], 0, side.outward[1], side.outward[0], 0, side.outward[1]);
      soil.top.push(s.h, s.h);
      const bed = Math.min(s.h, WATER_LEVEL);
      water.position.push(s.x, WATER_LEVEL, s.z, s.x, bed, s.z);
      water.normal.push(side.outward[0], 0, side.outward[1], side.outward[0], 0, side.outward[1]);
      water.top.push(WATER_LEVEL - s.h, WATER_LEVEL - s.h);
      if (i === 0) continue;
      const a = base + (i - 1) * 2,
        b = base + i * 2;
      // Wind outward-facing triangles for each side.
      const flip = side.outward[0] + side.outward[1] > 0 !== (side.along === 'z');
      if (flip) soil.index.push(a, a + 1, b, b, a + 1, b + 1);
      else soil.index.push(a, b, a + 1, b, b + 1, a + 1);
      const prev = sample(i - 1);
      if (prev.h < WATER_LEVEL || s.h < WATER_LEVEL) {
        const wa = wBase + (i - 1) * 2,
          wb = wBase + i * 2;
        if (flip) water.index.push(wa, wa + 1, wb, wb, wa + 1, wb + 1);
        else water.index.push(wa, wb, wa + 1, wb, wb + 1, wa + 1);
      }
    }
  }
  const geometry = (g: typeof soil) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('surfaceTop', new THREE.Float32BufferAttribute(g.top, 1));
    geo.setIndex(g.index);
    geo.computeBoundingSphere();
    return geo;
  };
  return { soil: geometry(soil), water: geometry(water) };
}

function soilMaterial(map: CompiledMap, atlas: THREE.Texture) {
  const p = map.design.palette;
  const material = new THREE.MeshStandardMaterial({ roughness: 0.96 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      northernAtlas: { value: atlas },
      uEarth: { value: new THREE.Color(p.earth) },
      uRock: { value: new THREE.Color(p.rock) },
      uCliff: { value: new THREE.Color(p.cliff) },
      uSnow: { value: new THREE.Color(p.snow) },
      uSand: { value: new THREE.Color(p.sand) },
      uSnowCover: { value: map.design.atmosphere.snowCover },
    });
    shader.vertexShader = `attribute float surfaceTop; varying float vTop; varying vec3 vCut;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vTop = surfaceTop; vCut = (modelMatrix * vec4(position, 1.)).xyz;`,
    );
    shader.fragmentShader = `${surfaceGLSL}
      ${worldNoiseGLSL}
      uniform vec3 uEarth, uRock, uCliff, uSnow, uSand; uniform float uSnowCover;
      varying float vTop; varying vec3 vCut;
      ${shader.fragmentShader}`
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float run = vCut.x + vCut.z;
        float wobble = worldFbm(vec2(run * .08, vCut.y * .2)) * 1.4;
        float below = vTop - vCut.y;
        float grain = northernTile(vec2(run * .35, vCut.y * .35), vec2(0., 1.));
        float soilGrain = northernTile(vec2(run * .4, vCut.y * .4), vec2(1., 1.));
        // Rock strata: tilted beds of alternating tone.
        float bed = vCut.y * 1.1 + run * .025 + wobble;
        float layer = fract(bed * .42);
        vec3 rock = mix(uCliff * .8, uRock, smoothstep(.2, .5, layer) * (1. - smoothstep(.75, .95, layer)));
        rock *= .7 + grain * .55;
        rock = mix(rock, rock * vec3(.85, .8, .72), smoothstep(.55, .75, worldNoise(vec2(run * .3, bed * 2.))) * .5);
        vec3 clay = mix(uEarth, uSand * .8, .35) * (.78 + soilGrain * .4);
        vec3 humus = uEarth * vec3(.45, .38, .32) * (.8 + soilGrain * .4);
        float clayDepth = 1.6 + wobble * .6, humusDepth = .5 + wobble * .15;
        vec3 cut = mix(humus, clay, smoothstep(humusDepth - .1, humusDepth + .1, below));
        cut = mix(cut, rock, smoothstep(clayDepth - .2, clayDepth + .3, below));
        // Pebbles in the clay band.
        float pebble = step(.8, worldNoise(vec2(run * 2.3, vCut.y * 2.3))) * smoothstep(humusDepth, humusDepth + .3, below) * (1. - smoothstep(clayDepth, clayDepth + .3, below));
        cut = mix(cut, uRock * 1.1, pebble * .7);
        // Snow crust on dry ground above the waterline.
        float crust = (1. - smoothstep(.1, .22 + wobble * .05, below)) * step(.5, vTop) * smoothstep(.2, .6, uSnowCover);
        cut = mix(cut, uSnow * .95, crust);
        // Darker toward the plinth: the block reads as solid mass.
        cut *= mix(.55, 1., smoothstep(${PLINTH_TOP.toFixed(1)}, vTop, vCut.y));
        diffuseColor.rgb = cut;`,
      );
  };
  material.customProgramCacheKey = () => 'diorama-cut-v1';
  return material;
}

function resinMaterial(map: CompiledMap) {
  const p = map.design.palette;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uShallow: { value: new THREE.Color(p.shallow) },
      uDeep: { value: new THREE.Color(p.deep) },
      uFoam: { value: new THREE.Color(p.foam) },
    },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vP;
      void main() { vec4 w = modelMatrix * vec4(position, 1.); vY = w.y; vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uShallow, uDeep, uFoam; varying float vY; varying vec3 vP;
      void main() {
        float d = clamp(-vY / 4., 0., 1.);
        vec3 c = mix(uShallow * .9, uDeep * .6, d);
        float streak = .9 + .1 * sin((vP.x + vP.z) * 3.1 + vY * 1.7);
        c *= streak;
        c = mix(c, uFoam, (1. - smoothstep(.0, .12, -vY)) * .6);
        gl_FragColor = vec4(c, .82);
      }`,
  });
}

function nameplateTexture(name: string, tagline: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#e2bd73');
  gradient.addColorStop(0.5, '#b88c43');
  gradient.addColorStop(1, '#8c6429');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2048, 256);
  // Brushed metal.
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,240,200' : '80,50,10'},${Math.random() * 0.08})`;
    ctx.fillRect(0, Math.random() * 256, 2048, 1);
  }
  ctx.strokeStyle = '#6b4a1c';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, 2012, 220);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 118px Georgia, "Times New Roman", serif';
  const title = name.toUpperCase().split('').join(String.fromCharCode(8202));
  ctx.fillStyle = 'rgba(255,236,190,.55)';
  ctx.fillText(title, 1024, 108);
  ctx.fillStyle = '#3a2508';
  ctx.fillText(title, 1024, 104);
  ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
  ctx.fillStyle = '#4a3212';
  ctx.fillText(tagline, 1024, 196);
  for (const x of [52, 1996]) {
    ctx.beginPath();
    ctx.arc(x, 128, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#7a5520';
    ctx.fill();
    ctx.strokeStyle = '#3a2508';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 10, 128);
    ctx.lineTo(x + 10, 128);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function woodMaterial(atlas: THREE.Texture) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#4a2c1b',
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.northernAtlas = { value: atlas };
    shader.vertexShader = `varying vec3 vWood;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vWood = (modelMatrix * vec4(position, 1.)).xyz;`,
    );
    shader.fragmentShader = `${surfaceGLSL}\n${worldNoiseGLSL}\nvarying vec3 vWood;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 wn = abs(normalize(cross(dFdx(vWood), dFdy(vWood))));
      vec2 grainUv = wn.y > .5 ? vWood.xz : (wn.x > wn.z ? vec2(vWood.z, vWood.y) : vec2(vWood.x, vWood.y));
      float rings = sin(grainUv.x * .9 + worldFbm(grainUv * vec2(.05, 1.2)) * 9.) * .5 + .5;
      float fibre = northernTile(vec2(grainUv.y * .6, grainUv.x * .05), vec2(1., 0.));
      diffuseColor.rgb *= .62 + rings * .28 + fibre * .45;`,
    );
  };
  material.customProgramCacheKey = () => 'diorama-walnut-v1';
  return material;
}

/**
 * The map as a tabletop miniature: the terrain block is cut cleanly at the
 * bounds and stands on a lacquered walnut plinth with a brass nameplate.
 */
export function DioramaEdge({ map, grid }: { map: CompiledMap; grid: WorldGrid }) {
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const { bounds, design } = map;
  const assets = useMemo(() => {
    const walls = buildWalls(grid);
    const width = bounds.maxX - bounds.minX + PLINTH_MARGIN * 2,
      depth = bounds.maxZ - bounds.minZ + PLINTH_MARGIN * 2;
    // A chamfered slab: the bevel catches the light like a real routed edge.
    const shape = new THREE.Shape();
    const r = 1.2;
    shape.moveTo(-width / 2 + r, -depth / 2);
    shape.lineTo(width / 2 - r, -depth / 2);
    shape.quadraticCurveTo(width / 2, -depth / 2, width / 2, -depth / 2 + r);
    shape.lineTo(width / 2, depth / 2 - r);
    shape.quadraticCurveTo(width / 2, depth / 2, width / 2 - r, depth / 2);
    shape.lineTo(-width / 2 + r, depth / 2);
    shape.quadraticCurveTo(-width / 2, depth / 2, -width / 2, depth / 2 - r);
    shape.lineTo(-width / 2, -depth / 2 + r);
    shape.quadraticCurveTo(-width / 2, -depth / 2, -width / 2 + r, -depth / 2);
    const plinth = new THREE.ExtrudeGeometry(shape, {
      depth: PLINTH_HEIGHT - 1.2,
      bevelEnabled: true,
      bevelThickness: 0.6,
      bevelSize: 0.6,
      bevelSegments: 3,
      curveSegments: 4,
    });
    plinth.rotateX(Math.PI / 2);
    plinth.translate(
      (bounds.minX + bounds.maxX) / 2,
      PLINTH_TOP - 0.6,
      (bounds.minZ + bounds.maxZ) / 2,
    );
    const plate = nameplateTexture(design.name, design.biome);
    return {
      walls,
      plinth,
      plate,
      soil: soilMaterial(map, atlas),
      resin: resinMaterial(map),
      wood: woodMaterial(atlas),
      width,
      depth,
    };
  }, [grid, bounds, design, map, atlas]);
  useEffect(
    () => () => {
      assets.walls.soil.dispose();
      assets.walls.water.dispose();
      assets.plinth.dispose();
      assets.plate.dispose();
      assets.soil.dispose();
      assets.resin.dispose();
      assets.wood.dispose();
    },
    [assets],
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const plateWidth = Math.min(90, (bounds.maxX - bounds.minX) * 0.32);
  return (
    <group>
      <mesh geometry={assets.walls.soil} material={assets.soil} receiveShadow raycast={ignoreRaycast} />
      <mesh geometry={assets.walls.water} material={assets.resin} renderOrder={2} raycast={ignoreRaycast} />
      <mesh geometry={assets.plinth} material={assets.wood} receiveShadow castShadow raycast={ignoreRaycast} />

      <mesh
        position={[cx, PLINTH_TOP - PLINTH_HEIGHT * 0.52, bounds.maxZ + PLINTH_MARGIN + 0.62]}
        raycast={ignoreRaycast}
      >
        <boxGeometry args={[plateWidth, plateWidth / 8, 0.12]} />
        <meshStandardMaterial map={assets.plate} metalness={0.85} roughness={0.32} />
      </mesh>
    </group>
  );
}
