'use client';

import { useTerrain } from './terrain-context';

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { SURFACE_ATLAS, detailMaterial } from './surface-detail';
import * as THREE from 'three';
import { modelUrl } from './world/models';
import { preloadModel, useModel } from './world/use-model';
import { isUnit, type Battle, type BuildingKind } from '@/lib/tactics';
import {
  footprint,
  insideFootprint,
} from '@/lib/tactical-placement';
import { WindCanopyMaterial } from './tactical-environment';

const ignoreRaycast = () => {};
class LandscapeBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Bakes the Blender node transform into shared geometry once; one draw per variant. */
function Scatter({
  name,
  matrices,
  wind = false,
}: {
  name: string;
  matrices: THREE.Matrix4[];
  wind?: boolean;
}) {
  const tree = /^(spruce|birch)/.test(name);
  const map = useTerrain();
  const { mapId } = map;
  const urls = [name, tree ? `${name}_lod` : name].map((n) => modelUrl(`landscape/${n}`));
  preloadModel(urls[1]);
  const gltf = useModel(urls[0]);
  const lod = useModel(urls[1]);
  const atlas = useLoader(THREE.TextureLoader, SURFACE_ATLAS);
  const asset = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const source = gltf.scene.getObjectByProperty('isMesh', true) as
      | THREE.Mesh
      | undefined;
    if (!source) throw new Error(`Missing landscape mesh: ${name}`);
    lod.scene.updateMatrixWorld(true);
    const low = lod.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    if (name === 'bridge_timber') material.name = 'weathered timber';
    detailMaterial(material, atlas, tree ? 0.25 : 0.8);
    if (name === 'bridge_span') {
      material.roughness = 0.66;
      material.metalness = 0.28;
      const prior = material.onBeforeCompile.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        prior(shader, renderer);
        shader.uniforms.deckSnow = {
          value: map.design.atmosphere.snowCover,
        };
        shader.fragmentShader =
          'uniform float deckSnow;\n' +
          shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `
          float deck = smoothstep(.25,.45,vNorthernSurface.y)*(1.-smoothstep(.7,.85,vNorthernSurface.y));
          float edge = smoothstep(3.65,4.75,abs(vNorthernSurface.x));
          float joint = 1.-smoothstep(.015,.05,abs(fract(vNorthernSurface.z*.5+.5)-.5));
          float panel = fract(sin(floor(vNorthernSurface.z*.5)*43.+floor(vNorthernSurface.x*.5)*17.)*43758.5453);
          float wheelOffset=.2*sin(vNorthernSurface.z*1.7)+.12*(panel-.5);
          float wheelWidth=.45+.45*panel;
          float wheel = (1.-smoothstep(wheelWidth*.35,wheelWidth,abs(abs(vNorthernSurface.x-wheelOffset)-1.5)))*smoothstep(.24,.55,grain)*smoothstep(.18,.65,panel);
          diffuseColor.rgb *= 1.-deck*(joint*(.5+.25*panel)+edge*.20);
          diffuseColor.rgb += vec3(.18,.19,.20)*deck*wheel;
          diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.56,.65,.72),deck*edge*deckSnow*smoothstep(.22,.46,grain)*smoothstep(.65,.82,panel)*.95);
          #include <roughnessmap_fragment>`,
          );
      };
      material.customProgramCacheKey = () => `northern-bridge-wear-${mapId}`;
    }
    return {
      geometry: source.geometry.clone().applyMatrix4(source.matrixWorld),
      lowGeometry: low.geometry.clone().applyMatrix4(low.matrixWorld),
      material,
    };
  }, [gltf, name, lod, atlas, tree, mapId, map]);
  useEffect(
    () => () => {
      asset.geometry.dispose();
      asset.lowGeometry.dispose();
      asset.material.dispose();
    },
    [asset],
  );
  const cells = useMemo(() => {
    const groups = new Map<string, THREE.Matrix4[]>();
    for (const matrix of matrices) {
      const key = `${Math.floor(matrix.elements[12] / 40)},${Math.floor(matrix.elements[14] / 40)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(matrix);
    }
    return [...groups];
  }, [matrices]);
  return (
    <group>
      {cells.map(([cell, instances]) => (
        <ScatterCell
          key={cell}
          asset={asset}
          matrices={instances}
          wind={wind}
        />
      ))}
    </group>
  );
}

/** Small spatial batches let both the view and the moving shadow camera cull distant forest. */
function ScatterCell({
  asset,
  matrices,
  wind,
}: {
  asset: {
    geometry: THREE.BufferGeometry;
    lowGeometry: THREE.BufferGeometry;
    material: THREE.MeshStandardMaterial;
  };
  matrices: THREE.Matrix4[];
  wind: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const close = useRef(false);
  useFrame(({ camera }) => {
    const object = mesh.current;
    if (!object?.boundingSphere) return;
    const distance = camera.position.distanceTo(object.boundingSphere.center);
    const near = distance < (close.current ? 83 : 72);
    if (
      near !== close.current ||
      object.geometry !== (near ? asset.geometry : asset.lowGeometry)
    ) {
      close.current = near;
      object.geometry = near ? asset.geometry : asset.lowGeometry;
    }
  });
  useEffect(() => {
    if (!mesh.current) return;
    matrices.forEach((m, i) => mesh.current!.setMatrixAt(i, m));
    mesh.current.count = matrices.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    // Wind shifts branch tips outside the static GLB bounds.
    if (mesh.current.boundingSphere) mesh.current.boundingSphere.radius += 1;
  }, [matrices]);
  return (
    <instancedMesh
      ref={mesh}
      args={[asset.geometry, asset.material, Math.max(1, matrices.length)]}
      castShadow
      receiveShadow
      raycast={ignoreRaycast}
    >
      {wind && <WindCanopyMaterial source={asset.material} />}
    </instancedMesh>
  );
}

/** Stores and short fences dress HQs, clearing away whenever a player builds over them. */
export function LandingStores({ battle }: { battle: Battle }) {
  const map = useTerrain();
  const { heightAt } = map;

  const matrices = useMemo(() => {
    const structures = battle.entities.filter((e) => !isUnit(e.kind));
    const boxes = structures.map((e) => ({
      id: e.id,
      box: footprint(e.kind as BuildingKind, e, e.angle),
    }));
    const stores: THREE.Matrix4[] = [],
      fences: THREE.Matrix4[] = [];
    for (const hq of structures.filter(
      (e) => e.kind === 'hq' && e.readyAt <= battle.tickAt,
    )) {
      for (const [x, z, angle, kind] of [
        [-6, -1, 0.15, 0],
        [-6, 1, 1.7, 0],
        [5, -3, 0, 1],
        [7, -1, Math.PI / 2, 1],
      ]) {
        const p = new THREE.Vector3(
          hq.x + x * Math.cos(hq.angle) + z * Math.sin(hq.angle),
          0,
          hq.z - x * Math.sin(hq.angle) + z * Math.cos(hq.angle),
        );
        if (
          boxes.some(
            (b) =>
              b.id !== hq.id && insideFootprint({ x: p.x, z: p.z }, b.box, 2),
          )
        )
          continue;
        p.y = heightAt(p.x, p.z);
        (kind === 0 ? stores : fences).push(
          new THREE.Matrix4().compose(
            p,
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              hq.angle + angle,
            ),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
    return { stores, fences };
  }, [battle.entities, battle.tickAt, heightAt]);
  return (
    <LandscapeBoundary>
      <Suspense fallback={null}>
        <Scatter name="field_stores" matrices={matrices.stores} />
        <Scatter name="field_fence" matrices={matrices.fences} />
      </Suspense>
    </LandscapeBoundary>
  );
}

