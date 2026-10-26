'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { AtmosphereDesign } from '@/lib/maps/types';
import { seeded } from './world-map';

const ignoreRaycast = () => {};
const BOX = new THREE.Vector3(150, 46, 150);

type Kind = 'snow' | 'blizzard' | 'embers' | 'aurora';
const SETTINGS: Record<Kind, { count: number; fall: number; drift: number; size: number; color: string; alpha: number; streak: number }> = {
  snow: { count: 5200, fall: 1.6, drift: 0.9, size: 1.0, color: '#f4f6fa', alpha: 0.8, streak: 0 },
  blizzard: { count: 14000, fall: 3.4, drift: 11, size: 1.15, color: '#eef3f8', alpha: 0.75, streak: 1 },
  embers: { count: 1400, fall: -1.4, drift: 1.3, size: 1.25, color: '#ff9a3c', alpha: 1, streak: 0 },
  // A few slow, sparkling flakes under the aurora.
  aurora: { count: 1800, fall: 0.8, drift: 0.5, size: 0.9, color: '#e8f0ff', alpha: 0.65, streak: 0 },
};

const vertexShader = /* glsl */ `
uniform float worldTime, uFall, uDrift, uSize, uStreak;
uniform vec3 uBox;
attribute float seed;
varying float vFade;
varying float vSeed;
void main() {
  float t = worldTime;
  vec3 p = position;
  p.y -= t * uFall * (.7 + seed * .6);
  p.x += t * uDrift * (.8 + seed * .4) + sin(t * .7 + seed * 40.) * 1.2;
  p.z += cos(t * .5 + seed * 30.) * 1.2 + t * uDrift * .25;
  // Wrap the particle box around the camera so weather never runs out.
  vec3 origin = cameraPosition - vec3(uBox.x * .5, uBox.y * .75, uBox.z * .5);
  p = origin + mod(p - origin, uBox);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  float edge = min(min(p.x - origin.x, origin.x + uBox.x - p.x), min(p.z - origin.z, origin.z + uBox.z - p.z));
  // Flakes thin out as the camera climbs, so overviews stay clear.
  float high = 1. - smoothstep(55., 120., cameraPosition.y);
  vFade = high * smoothstep(0., 12., edge) * smoothstep(0., 6., p.y - origin.y) * smoothstep(0., 8., origin.y + uBox.y - p.y);
  vSeed = seed;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 130. / -mv.z, 1., 5.);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha, uGlow, worldTime;
varying float vFade;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - .5;
  float r = length(c) * 2.;
  if (r > 1.) discard;
  float a = (1. - r * r) * uAlpha * vFade;
  float flicker = uGlow > 0. ? .6 + .4 * sin(worldTime * 7. + vSeed * 60.) : 1.;
  gl_FragColor = vec4(uColor * (1. + uGlow * 5. * flicker), a * flicker);
}`;

/** Snowfall, blizzard, drifting embers or aurora sparkle around the camera. */
export function Weather({
  atmosphere,
  time,
  density = 1,
}: {
  atmosphere: AtmosphereDesign;
  time: THREE.Uniform<number>;
  /** Scales particle count (render quality). */
  density?: number;
}) {
  const kind: Kind | null =
    atmosphere.weather === 'snowfall'
      ? 'snow'
      : atmosphere.weather === 'blizzard'
        ? 'blizzard'
        : atmosphere.weather === 'embers'
          ? 'embers'
          : atmosphere.weather === 'aurora'
            ? 'aurora'
            : null;
  const assets = useMemo(() => {
    if (!kind) return null;
    const s = SETTINGS[kind];
    const count = Math.round(s.count * density);
    const random = seeded(4242);
    const positions = new Float32Array(count * 3),
      seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = random() * BOX.x;
      positions[i * 3 + 1] = random() * BOX.y;
      positions[i * 3 + 2] = random() * BOX.z;
      seeds[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: kind === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        worldTime: time,
        uFall: { value: s.fall },
        uDrift: { value: s.drift },
        uSize: { value: s.size },
        uStreak: { value: s.streak },
        uBox: { value: BOX },
        uColor: { value: new THREE.Color(s.color) },
        uAlpha: { value: s.alpha },
        uGlow: { value: kind === 'embers' ? 1 : 0 },
      },
      vertexShader,
      fragmentShader,
    });
    return { geometry, material };
  }, [kind, time, density]);
  useEffect(
    () => () => {
      assets?.geometry.dispose();
      assets?.material.dispose();
    },
    [assets],
  );
  if (!assets) return null;
  return (
    <points
      geometry={assets.geometry}
      material={assets.material}
      frustumCulled={false}
      renderOrder={5}
      raycast={ignoreRaycast}
    />
  );
}
