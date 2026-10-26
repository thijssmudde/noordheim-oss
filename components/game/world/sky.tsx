'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AtmosphereDesign } from '@/lib/maps/types';
import { worldNoiseGLSL } from './shader-chunks';
import { sunDirection } from './lighting';

const ignoreRaycast = () => {};

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.);
  vDirection = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_Position.z = gl_Position.w * .99999;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uSky, uHorizon, uSun, uSunDir, uBackdrop, uFog;
uniform float uAurora, worldTime;
varying vec3 vDirection;
${worldNoiseGLSL}
void main() {
  vec3 d = normalize(vDirection);
  float y = d.y;
  // A studio sky: a luminous band at the horizon behind the diorama, deepening upward.
  vec3 sky = mix(uHorizon, uSky, smoothstep(-.02, .3, y));
  sky = mix(sky, uSky * .7, smoothstep(.3, 1., y));
  float sunAmount = max(0., dot(d, normalize(uSunDir)));
  sky += uSun * (pow(sunAmount, 12.) * .35 + pow(sunAmount, 900.) * 6.);
  // Aurora: slow folding curtains, green at the hem and violet above.
  if (uAurora > 0.) {
    float az = atan(d.z, d.x);
    float fold = worldFbm(vec2(az * 2.2 + worldTime * .015, worldTime * .03));
    float band = smoothstep(.06, .14, y - fold * .18) * (1. - smoothstep(.2, .62, y - fold * .18));
    float rays = .55 + .45 * worldNoise(vec2(az * 60. + fold * 10., worldTime * .25));
    float hem = 1. - smoothstep(.0, .1, y - .08 - fold * .18);
    vec3 green = vec3(.18, 1., .52), violet = vec3(.55, .25, 1.);
    vec3 aurora = mix(green, violet, smoothstep(.12, .5, y - fold * .18)) * band * rays;
    aurora += green * hem * band * .6;
    sky += aurora * uAurora * 1.6 * smoothstep(-.05, .1, y);
  }
  // Below the horizon: the sea of mist the diorama floats over.
  vec3 color = mix(uBackdrop, sky, smoothstep(-.02, .02, y));
  gl_FragColor = vec4(color, 1.);
}`;

/** The mist below the horizon: matches the backdrop's far mist. */
export function mistColor(atmosphere: AtmosphereDesign) {
  const haze = new THREE.Color(atmosphere.horizon).lerp(new THREE.Color(atmosphere.fog), 0.5);
  const sky = new THREE.Color(atmosphere.sky);
  const light = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b;
  return haze.multiplyScalar(THREE.MathUtils.clamp(light * 1.6, 0.35, 0.85));
}

/** Sky dome gradient with sun glow, optional aurora and a dark backdrop below the horizon. */
export function SkyDome({
  atmosphere,
  time,
}: {
  atmosphere: AtmosphereDesign;
  time: THREE.Uniform<number>;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => {
    const c = (hex: string, k = 1) =>
      new THREE.Uniform(new THREE.Color(hex).multiplyScalar(k));
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        worldTime: time,
        uSky: c(atmosphere.sky),
        uHorizon: c(atmosphere.horizon),
        uSun: c(atmosphere.sun, 1),
        uSunDir: new THREE.Uniform(
          new THREE.Vector3(...sunDirection(atmosphere)).normalize(),
        ),
        uFog: c(atmosphere.fog),
        uBackdrop: new THREE.Uniform(
          mistColor(atmosphere),
        ),
        uAurora: new THREE.Uniform(atmosphere.weather === 'aurora' ? 1 : 0),
      },
      vertexShader,
      fragmentShader,
    });
  }, [atmosphere, time]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position);
  });
  return (
    <mesh
      ref={mesh}
      material={material}
      renderOrder={-10}
      frustumCulled={false}
      raycast={ignoreRaycast}
    >
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}
