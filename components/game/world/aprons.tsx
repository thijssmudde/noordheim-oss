'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CompiledMap } from '@/lib/maps/types';
import { worldNoiseGLSL } from './shader-chunks';

const ignoreRaycast = () => {};
const MAX = 256;

export type Apron = { minX: number; maxX: number; minZ: number; maxZ: number };

const vertexShader = /* glsl */ `
attribute vec4 apron;
varying vec2 vLocal; varying vec2 vHalf; varying vec3 vWorld;
void main() {
  vLocal = (uv - .5) * apron.xy;
  vHalf = apron.xy * .5;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uMud, uGravel, uSnow;
uniform float uSnowCover;
varying vec2 vLocal; varying vec2 vHalf; varying vec3 vWorld;
${worldNoiseGLSL}
void main() {
  // A trampled yard around each structure: soft, ragged edge, tyre marks, slush.
  vec2 q = abs(vLocal) - (vHalf - 3.2);
  float box = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
  float n = worldFbm(vWorld.xz * .35) - .5;
  float edge = 1. - smoothstep(-.6, 2.2, box + n * 2.2);
  if (edge < .01) discard;
  float grit = worldNoise(vWorld.xz * 2.1);
  vec3 c = mix(uMud, uGravel, smoothstep(.35, .7, worldFbm(vWorld.xz * .12 + 4.)));
  c *= .82 + grit * .25;
  float ruts = smoothstep(.72, .9, sin(vWorld.x * .9 + worldNoise(vWorld.xz * .2) * 5.) * .5 + .5) * .35;
  c *= 1. - ruts * smoothstep(.2, .8, edge);
  float slush = smoothstep(.62, .8, worldNoise(vWorld.xz * .25 + 9.)) * uSnowCover * (1. - edge * .75) * .5;
  c = mix(c, uSnow * .85, slush);
  gl_FragColor = vec4(c, edge * .92);
}`;

function layoutAprons(
  m: THREE.InstancedMesh,
  data: THREE.InstancedBufferAttribute,
  aprons: Apron[],
  map: CompiledMap,
) {
  const matrix = new THREE.Matrix4();
  const list = aprons.slice(0, MAX);
  list.forEach((a, i) => {
    const w = a.maxX - a.minX + 9,
      d = a.maxZ - a.minZ + 9;
    const x = (a.minX + a.maxX) / 2,
      z = (a.minZ + a.maxZ) / 2;
    matrix.makeScale(w, 1, d).setPosition(x, map.heightAt(x, z) + 0.04, z);
    m.setMatrixAt(i, matrix);
    data.setXYZW(i, w, d, 0, 0);
  });
  m.count = list.length;
  m.instanceMatrix.needsUpdate = true;
  data.needsUpdate = true;
  m.computeBoundingSphere();
}

/** Worn yards of mud and gravel around every standing structure. */
export function BuildingAprons({ map, aprons }: { map: CompiledMap; aprons: Apron[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const assets = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const data = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    geometry.setAttribute('apron', data);
    const p = map.design.palette;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uMud: { value: new THREE.Color(p.earth).multiplyScalar(0.62) },
        uGravel: { value: new THREE.Color(p.gravel).multiplyScalar(0.72) },
        uSnow: { value: new THREE.Color(p.snow) },
        uSnowCover: { value: map.design.atmosphere.snowCover },
      },
      vertexShader,
      fragmentShader,
    });
    return { geometry, material, data };
  }, [map]);
  useEffect(
    () => () => {
      assets.geometry.dispose();
      assets.material.dispose();
    },
    [assets],
  );
  useEffect(() => {
    if (mesh.current) layoutAprons(mesh.current, assets.data, aprons, map);
  }, [aprons, assets, map]);
  return (
    <instancedMesh
      ref={mesh}
      args={[assets.geometry, assets.material, MAX]}
      renderOrder={1}
      frustumCulled={false}
      raycast={ignoreRaycast}
    />
  );
}
