'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { WATER_LEVEL, type CompiledMap } from '@/lib/maps/types';
import type { WorldGrid } from './world-map';
import type { WorldMasks } from './masks';
import { worldNoiseGLSL } from './shader-chunks';
import { sunDirection } from './lighting';

const ignoreRaycast = () => {};

const vertexShader = /* glsl */ `
varying vec2 vWater;
varying vec3 vWorldPosition;
#include <common>
#include <shadowmap_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWater = worldPosition.xz;
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  vec3 transformedNormal = normalMatrix * normal;
  #include <shadowmap_vertex>
}`;

const fragmentShader = /* glsl */ `
uniform float worldTime;
uniform sampler2D uHeight;
uniform vec4 uGrid;
uniform sampler2D uWater;
uniform vec4 uRect;
uniform vec3 uShallow, uDeep, uFoam, uSky, uHorizon, uSun, uSunDir;
varying vec2 vWater;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${worldNoiseGLSL}
float ripple(vec2 p) {
  return worldNoise(p) * .55 + worldNoise(p * 2.3 + 7.) * .3 + worldNoise(p * 5.1 - 3.) * .15;
}
vec2 slopeAt(vec2 p) {
  float e = .06;
  float c = ripple(p);
  return vec2(ripple(p + vec2(e, 0.)) - c, ripple(p + vec2(0., e)) - c) / e;
}
void main() {
  vec2 wp = vWater;
  float bed = texture2D(uHeight, (wp - uGrid.xy + .5) / uGrid.zw).r;
  float depth = ${WATER_LEVEL.toFixed(2)} - bed;
  if (depth < -.04) discard;
  vec4 wm = texture2D(uWater, (wp - uRect.xy) / uRect.zw);
  vec2 flow = (wm.rg - .5) * 2.;
  float current = clamp(length(flow) * 1.2, 0., 1.);
  float t = worldTime;
  // Flow-map advection: two phases cross-fade so the pattern never stretches.
  float ph0 = fract(t * .18), ph1 = fract(t * .18 + .5);
  float blend = abs(ph0 * 2. - 1.);
  vec2 drift = flow * 5.5;
  vec2 wind = vec2(t * .09, t * .05);
  vec2 s0 = slopeAt(wp * .42 - drift * ph0 + wind);
  vec2 s1 = slopeAt(wp * .42 - drift * ph1 + wind + 11.3);
  vec2 slope = mix(s0, s1, blend) * (.2 + current * .22);
  slope += slopeAt(wp * 1.6 + vec2(-t * .31, t * .23)) * .03;
  vec3 n = normalize(vec3(-slope.x, 1., -slope.y));
  vec3 eye = normalize(cameraPosition - vWorldPosition);
  float fresnel = .03 + .97 * pow(1. - max(0., dot(n, eye)), 5.);
  vec3 r = reflect(-eye, n);
  // Reflections keep the sky's value but only part of its hue, so dusk water stays water.
  vec3 sky = mix(uHorizon, uSky, smoothstep(0., .55, r.y));
  sky = mix(vec3(dot(sky, vec3(.3, .59, .11))), sky, .45) * vec3(.9, .96, 1.04);
  float shade = mix(.55, 1., getShadowMask());
  // Depth colour: bright shallows over sand, dark cold deeps.
  float deepness = 1. - exp(-max(depth, 0.) * 1.1);
  vec3 body = mix(uShallow * .8, uDeep * .75, deepness);
  body *= (.9 + worldNoise(wp * .05) * .2);
  vec3 color = body * mix(.7, 1., shade);
  color = mix(color, sky * .55, fresnel * .45);
  // Sun sparkle: tight HDR glints feed the bloom.
  float glint = pow(max(0., dot(r, normalize(uSunDir))), 380.);
  float sparkle = step(.72, worldNoise(wp * 3.1 + t * 1.7));
  color += uSun * (glint * (3. + sparkle * 7.) * shade);
  color += uSun * pow(max(0., dot(r, normalize(uSunDir))), 18.) * .12 * shade;
  // Shoreline foam and streaks along the current.
  float lap = sin(depth * 16. - t * 2.2 + worldNoise(wp * .4) * 6.) * .5 + .5;
  float shore = (1. - smoothstep(.02, .4 + lap * .25, depth)) * smoothstep(.45, .7, worldNoise(wp * .9 + t * .15) + lap * .2);
  // Long streaks drawn out along the current, not speckles.
  vec2 along = normalize(flow + vec2(1e-4));
  vec2 streakUv = vec2(dot(wp, along) * .12, dot(wp, vec2(-along.y, along.x)) * .9) - vec2(t * .5, 0.);
  float streak = smoothstep(.7, .84, worldFbm(streakUv)) * current;
  float foam = clamp(shore + streak * .18, 0., 1.);
  color = mix(color, uFoam * mix(.75, 1.05, shade), foam * .85);
  float alpha = mix(.55, .95, smoothstep(0., 1.4, depth));
  alpha = max(alpha, foam) * smoothstep(-.04, .05, depth);
  gl_FragColor = vec4(color, alpha);
}`;

/** One water surface over the whole map, clipped where the natural ground stands dry. */
export function WaterSurface({
  map,
  grid,
  masks,
  heights,
  time,
}: {
  map: CompiledMap;
  grid: WorldGrid;
  masks: WorldMasks;
  heights: THREE.DataTexture;
  time: THREE.Uniform<number>;
}) {
  const { bounds, design } = map;
  const material = useMemo(() => {
    const p = design.palette,
      a = design.atmosphere;
    const c = (hex: string) => new THREE.Uniform(new THREE.Color(hex));
    return new THREE.ShaderMaterial({
      lights: true,
      transparent: true,
      depthWrite: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
        worldTime: time,
        uHeight: new THREE.Uniform(heights),
        uGrid: new THREE.Uniform(
          new THREE.Vector4(grid.minX, grid.minZ, grid.width, grid.depth),
        ),
        uWater: new THREE.Uniform(masks.water),
        uRect: new THREE.Uniform(masks.rect),
        uShallow: c(p.shallow),
        uDeep: c(p.deep),
        uFoam: c(p.foam),
        uSky: c(a.sky),
        uHorizon: c(a.horizon),
        uSun: new THREE.Uniform(
          new THREE.Color(a.sun).multiplyScalar(a.sunIntensity * 0.5),
        ),
        uSunDir: new THREE.Uniform(new THREE.Vector3(...sunDirection(a)).normalize()),
      },
      vertexShader,
      fragmentShader,
    });
  }, [design, time, heights, masks, grid]);
  useEffect(() => () => material.dispose(), [material]);
  const width = bounds.maxX - bounds.minX,
    depth = bounds.maxZ - bounds.minZ;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[
        (bounds.minX + bounds.maxX) / 2,
        WATER_LEVEL,
        (bounds.minZ + bounds.maxZ) / 2,
      ]}
      material={material}
      receiveShadow
      renderOrder={1}
      raycast={ignoreRaycast}
    >
      <planeGeometry args={[width, depth, 1, 1]} />
    </mesh>
  );
}
