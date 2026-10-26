'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { modelUrl } from './models';
import { preloadModel, useModel } from './use-model';
import { useLightAssets } from './scene-mode';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURFACE_ATLAS, detailMaterial } from '../surface-detail';
import { useWorldTime } from './world-time';

const ignoreRaycast = () => {};
const CELL = 64;

export type Placement = {
  x: number;
  y: number;
  z: number;
  angle: number;
  scale: number;
  /** Optional non-uniform stretch: [x, y, z] multipliers. */
  stretch?: [number, number, number];
  tilt?: number;
  /** Nose-up rotation about the local x axis, without the roll `tilt` adds. */
  pitch?: number;
};

export function placementMatrix(p: Placement, target = new THREE.Matrix4()) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((p.tilt ?? 0) + (p.pitch ?? 0), p.angle, (p.tilt ?? 0) * 0.6, 'YXZ'),
  );
  const s = p.stretch ?? [1, 1, 1];
  return target.compose(
    new THREE.Vector3(p.x, p.y, p.z),
    q,
    new THREE.Vector3(p.scale * s[0], p.scale * s[1], p.scale * s[2]),
  );
}

type Options = {
  /** Sway crowns in the wind (vertex shader, also in the shadow pass). */
  wind?: boolean;
  /** 0..1: snow settles on up-facing surfaces. */
  snow?: number;
  snowColor?: string;
  detail?: number;
  shadows?: boolean;
};

/** Merge every mesh of a GLB (baked transforms) into one geometry + material. */
function flatten(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  if (!meshes.length) throw new Error('Model has no mesh');
  const first = meshes[0];
  return {
    geometry: first.geometry.clone().applyMatrix4(first.matrixWorld),
    material: (first.material as THREE.MeshStandardMaterial).clone(),
    extra: meshes.slice(1).map((m) => ({
      geometry: m.geometry.clone().applyMatrix4(m.matrixWorld),
      material: (m.material as THREE.MeshStandardMaterial).clone(),
    })),
  };
}

/** A handful of triangles standing in for a tree seen from far away. */
function proxyTree(source: THREE.BufferGeometry, conifer: boolean) {
  source.computeBoundingBox();
  const box = source.boundingBox!;
  const height = box.max.y - box.min.y;
  const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const colors = source.getAttribute('color');
  const positions = source.getAttribute('position');
  const crown = new THREE.Color(0, 0, 0),
    trunk = new THREE.Color(0, 0, 0);
  let nc = 0,
    nt = 0;
  if (colors)
    for (let i = 0; i < colors.count; i += 7) {
      const up = positions.getY(i) > box.min.y + height * 0.35;
      (up ? crown : trunk).add(new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i)));
      if (up) nc++;
      else nt++;
    }
  if (nc) crown.multiplyScalar(1 / nc);
  else crown.set('#2f4a3a');
  if (nt) trunk.multiplyScalar(1 / nt);
  else trunk.set('#4a3a2a');
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const data = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(data, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const stem = new THREE.CylinderGeometry(radius * 0.08, radius * 0.1, height * 0.4, 5, 1, true);
  stem.translate(0, box.min.y + height * 0.2, 0);
  parts.push(paint(stem, trunk));
  if (conifer)
    for (let k = 0; k < 3; k++) {
      const h = height * (0.5 - k * 0.1);
      const cone = new THREE.ConeGeometry(radius * (0.95 - k * 0.22), h, 7, 1, true);
      cone.translate(0, box.min.y + height * (0.14 + k * 0.24) + h / 2, 0);
      parts.push(paint(cone, crown.clone().multiplyScalar(0.9 + k * 0.08)));
    }
  else {
    const blob = new THREE.IcosahedronGeometry(radius * 0.8, 0);
    blob.scale(1, (height * 0.42) / (radius * 0.8), 1);
    blob.translate(0, box.min.y + height * 0.62, 0);
    parts.push(paint(blob, crown));
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  merged.computeVertexNormals();
  return merged;
}

/** A low blob with the model's bounds and average colour: rocks, shrubs and reeds far away. */
function proxyBlob(source: THREE.BufferGeometry, detail: number) {
  source.computeBoundingBox();
  const box = source.boundingBox!;
  const size = box.getSize(new THREE.Vector3()),
    centre = box.getCenter(new THREE.Vector3());
  const colors = source.getAttribute('color');
  const avg = new THREE.Color(0, 0, 0);
  let n = 0;
  if (colors)
    for (let i = 0; i < colors.count; i += 5) {
      avg.r += colors.getX(i);
      avg.g += colors.getY(i);
      avg.b += colors.getZ(i);
      n++;
    }
  if (n) avg.multiplyScalar(1 / n);
  else avg.set('#8a8781');
  const blob = new THREE.IcosahedronGeometry(0.5, detail);
  blob.scale(size.x, size.y, size.z);
  blob.translate(centre.x, centre.y, centre.z);
  blob.deleteAttribute('uv');
  const count = blob.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) data.set([avg.r, avg.g, avg.b], i * 3);
  blob.setAttribute('color', new THREE.BufferAttribute(data, 3));
  blob.computeVertexNormals();
  return blob;
}

function decorate(
  material: THREE.MeshStandardMaterial,
  time: THREE.Uniform<number>,
  options: Options,
) {
  const snow = options.snow ?? 0;
  const snowColor = new THREE.Color(options.snowColor ?? '#f3efe6');
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.worldTime = time;
    shader.uniforms.uFoliageSnow = { value: snow };
    shader.uniforms.uFoliageSnowColor = { value: snowColor };
    shader.vertexShader = `uniform float worldTime; varying float vUpFacing; varying float vCrown;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 upNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        float phase = instanceMatrix[3].x * .12 + instanceMatrix[3].z * .08;
      #else
        vec3 upNormal = normalize(mat3(modelMatrix) * objectNormal);
        float phase = 0.;
      #endif
      vUpFacing = upNormal.y;
      vCrown = smoothstep(.5, 3.5, position.y);
      ${
        options.wind
          ? `float gust = .65 + .35 * sin(worldTime * .23 + phase * .1);
      transformed.x += sin(worldTime * 1.7 + phase + position.y * .8) * vCrown * .09 * gust;
      transformed.z += cos(worldTime * 1.3 + phase) * vCrown * .04 * gust;`
          : ''
      }`,
    );
    shader.fragmentShader = `uniform float uFoliageSnow; uniform vec3 uFoliageSnowColor; varying float vUpFacing; varying float vCrown;
      ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float settle = smoothstep(.55, .9, vUpFacing) * uFoliageSnow;
      diffuseColor.rgb = mix(diffuseColor.rgb, uFoliageSnowColor * .92, settle * .85);`,
    );
  };
  material.customProgramCacheKey = () =>
    `diorama-foliage-${options.wind ? 1 : 0}-${snow.toFixed(2)}-${material.name}`;
}

function windDepth(time: THREE.Uniform<number>) {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.worldTime = time;
    shader.vertexShader = `uniform float worldTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase = instanceMatrix[3].x * .12 + instanceMatrix[3].z * .08;
      #else
        float phase = 0.;
      #endif
      float crown = smoothstep(.5, 3.5, position.y);
      float gust = .65 + .35 * sin(worldTime * .23 + phase * .1);
      transformed.x += sin(worldTime * 1.7 + phase + position.y * .8) * crown * .09 * gust;
      transformed.z += cos(worldTime * 1.3 + phase) * crown * .04 * gust;`,
    );
  };
  return depth;
}

/**
 * Instanced GLB scatter in 40 m cells: each cell culls on its own (view and
 * shadow camera) and swaps to the `_lod` mesh when the camera is far away.
 */
export function InstancedModel(props: Parameters<typeof LoadedModel>[0]) {
  const { lod = false } = props;
  // A missing model throws into the caller's error boundary. The attract mode shows the authored LOD at every distance.
  const light = useLightAssets() && lod;
  if (!props.placements.length) return null;
  return <LoadedModel {...props} light={light} />;
}

function LoadedModel({
  name,
  folder = 'landscape',
  lod = false,
  light = false,
  placements,
  options = {},
}: {
  name: string;
  folder?: string;
  lod?: boolean;
  /** Use the `_lod` mesh for the near tier too. */
  light?: boolean;
  placements: Placement[];
  options?: Options;
}) {
  const time = useWorldTime();
  // Options are plain data; a key keeps the materials stable across renders.
  const optionsKey = JSON.stringify(options);
  const urls = [light ? `${name}_lod` : name, lod ? `${name}_lod` : name].map((n) =>
    modelUrl(`${folder}/${n}`),
  );
  preloadModel(urls[1]);
  const near = useModel(urls[0]);
  const far = useModel(urls[1]);
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const asset = useMemo(() => {
    const a = flatten(near.scene),
      b = flatten(far.scene);
    const o = JSON.parse(optionsKey) as Options;
    for (const m of [a.material, ...a.extra.map((e) => e.material)]) {
      if (o.detail) detailMaterial(m, atlas, o.detail);
      decorate(m, time, o);
    }
    const tree = /^(spruce|pine|birch)/.test(name);
    const structure = name.startsWith('bridge');
    if (!lod) b.geometry.dispose();
    return {
      geometry: a.geometry,
      // Models without an authored LOD fall back to a blob at mid distance;
      // structures (bridges) keep their shape at every distance. The pine's
      // authored LOD reads as a lollipop from above, so it stays detailed.
      lowGeometry: name.startsWith('pine')
        ? a.geometry
        : lod
          ? b.geometry
          : structure
            ? null
            : proxyBlob(a.geometry, 1),
      farGeometry: tree
        ? proxyTree(b.geometry, !name.startsWith('birch'))
        : structure
          ? null
          : proxyBlob(a.geometry, 0),
      material: a.material,
      extra: a.extra,
      depth: o.wind ? windDepth(time) : undefined,
    };
  }, [near, far, atlas, time, optionsKey, name, lod]);
  useEffect(
    () => () => {
      asset.geometry.dispose();
      if (asset.lowGeometry !== asset.geometry) asset.lowGeometry?.dispose();
      asset.farGeometry?.dispose();
      asset.material.dispose();
      asset.extra.forEach((e) => {
        e.geometry.dispose();
        e.material.dispose();
      });
      asset.depth?.dispose();
    },
    [asset],
  );
  const cells = useMemo(() => {
    const groups = new Map<string, THREE.Matrix4[]>();
    for (const p of placements) {
      const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(placementMatrix(p));
    }
    return [...groups];
  }, [placements]);
  return (
    <group>
      {cells.map(([key, matrices]) => (
        <Cell
          key={key}
          matrices={matrices}
          geometry={asset.geometry}
          lowGeometry={asset.lowGeometry}
          farGeometry={asset.farGeometry}
          material={asset.material}
          depth={asset.depth}
          shadows={options.shadows ?? true}
        />
      ))}
      {asset.extra.map((e, i) =>
        cells.map(([key, matrices]) => (
          <Cell
            key={`${i}:${key}`}
            matrices={matrices}
            geometry={e.geometry}
            lowGeometry={null}
            farGeometry={null}
            material={e.material}
            shadows={options.shadows ?? true}
          />
        )),
      )}
    </group>
  );
}

function Cell({
  matrices,
  geometry,
  lowGeometry,
  farGeometry,
  material,
  depth,
  shadows,
}: {
  matrices: THREE.Matrix4[];
  geometry: THREE.BufferGeometry;
  lowGeometry: THREE.BufferGeometry | null;
  farGeometry: THREE.BufferGeometry | null;
  material: THREE.Material;
  depth?: THREE.Material;
  shadows: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tier = useRef(0);
  useFrame(({ camera }) => {
    const object = mesh.current;
    if (!object?.boundingSphere || (!lowGeometry && !farGeometry)) return;
    const distance = camera.position.distanceTo(object.boundingSphere.center);
    // Hysteresis keeps a cell from flickering between tiers at the boundary.
    const t = tier.current;
    const next =
      distance < (t === 0 ? 125 : 112)
        ? 0
        : farGeometry && distance > (t === 2 ? 190 : 205)
          ? 2
          : 1;
    if (next !== t) {
      tier.current = next;
      object.geometry =
        next === 0 ? geometry : next === 2 ? farGeometry! : (lowGeometry ?? geometry);
    }
  });
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    matrices.forEach((matrix, i) => m.setMatrixAt(i, matrix));
    m.count = matrices.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    if (m.boundingSphere) m.boundingSphere.radius += 2;
  }, [matrices]);
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, Math.max(1, matrices.length)]}
      castShadow={shadows}
      receiveShadow
      customDepthMaterial={depth}
      raycast={ignoreRaycast}
    />
  );
}
