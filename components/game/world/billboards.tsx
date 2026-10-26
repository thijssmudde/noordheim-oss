'use client';
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { BillboardDesign, CompiledMap } from '@/lib/maps/types';
import { standingBillboards } from '@/lib/sponsor-placement';
import type { Footprint } from '@/lib/tactical-placement';
import { useBillboardTexture } from '../sponsor-billboard';

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
const ignoreRaycast = () => {};

/** Poster size (w x h) and how high its bottom edge stands, in metres. */
const SIZE: Record<BillboardDesign['size'], { w: number; h: number; lift: number; lean: number }> = {
  hoarding: { w: 10, h: 5, lift: 2.4, lean: 0.38 },
  tower: { w: 5.5, h: 11, lift: 4, lean: 0.22 },
  banner: { w: 12, h: 3.4, lift: 1.4, lean: 0.62 },
};
/** The default play camera looks north-east from the south-west (HOME_YAW). */
const CAMERA_FACING = Math.atan2(Math.sin(-Math.PI / 5), Math.cos(-Math.PI / 5));

/**
 * Posters turn toward the player's camera: a board authored facing away is
 * flipped, and every board swings halfway toward the camera heading so none
 * is seen edge-on.
 */
export function posterAngle(angle: number) {
  let a = Math.atan2(Math.sin(angle), Math.cos(angle));
  const off = (x: number) => Math.atan2(Math.sin(x - CAMERA_FACING), Math.cos(x - CAMERA_FACING));
  if (Math.abs(off(a)) > Math.PI / 2) a += Math.PI;
  return CAMERA_FACING + off(a) * 0.5;
}
const TIMBER = '#5a4331';
const TRIM = '#8e2f25';

/** How long a poster change takes, in seconds, and how many slats turn. */
const FLIP_S = 1.1;
const SLATS = 9;
/** Posters carry a little of their own light, like a lamp-lit hoarding at dusk. */
const GLOW = 0.28;

/**
 * Tri-vision flip: the poster is cut into vertical slats that turn one after
 * another, the old poster folding away as the new one unfolds. Done in the
 * poster's fragment shader, so it costs no extra meshes or draw calls.
 */
const FLIP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  float slatX = vMapUv.x * ${SLATS.toFixed(1)};
  float slat = floor(slatX);
  float across = fract(slatX);
  float turn = clamp((posterFlip - slat / ${SLATS.toFixed(1)} * 0.45) / 0.55, 0.0, 1.0);
  vec4 face = vec4(0.06, 0.05, 0.045, 1.0);
  if (turn < 0.5) {
    float width = 1.0 - turn * 2.0;
    if (across <= width)
      face = texture2D(posterPrevious, vec2((slat + across / max(width, 0.001)) / ${SLATS.toFixed(1)}, vMapUv.y)) * (0.45 + 0.55 * width);
  } else {
    float width = turn * 2.0 - 1.0;
    if (across >= 1.0 - width)
      face = texture2D(map, vec2((slat + (across - 1.0 + width) / max(width, 0.001)) / ${SLATS.toFixed(1)}, vMapUv.y)) * (0.45 + 0.55 * width);
  }
  diffuseColor *= face;
#endif
`;

type PosterUniforms = {
  posterPrevious: { value: THREE.Texture };
  posterFlip: { value: number };
  posterGlow: { value: number };
};

function posterMaterial(texture: THREE.Texture) {
  const uniforms: PosterUniforms = {
    posterPrevious: { value: texture },
    posterFlip: { value: 1 },
    posterGlow: { value: GLOW },
  };
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 });
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        '#include <map_pars_fragment>\nuniform sampler2D posterPrevious;\nuniform float posterFlip;\nuniform float posterGlow;',
      )
      .replace('#include <map_fragment>', FLIP_FRAGMENT)
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * posterGlow;',
      );
  };
  material.customProgramCacheKey = () => 'sponsor-poster-flip';
  return material;
}

/**
 * The poster mesh's material: flips to each new texture and glows faintly.
 * Animated through the mesh ref, so per-frame writes never touch React state.
 */
function usePosterFlip(texture: THREE.Texture) {
  const [material] = useState(() => posterMaterial(texture));
  const mesh = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(null);
  // Which texture is up and when its flip started.
  const flip = useRef({ shown: texture, startedAt: -1 });
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const poster = mesh.current?.material;
    if (!poster) return;
    const uniforms = poster.userData.uniforms as PosterUniforms;
    const state = flip.current;
    if (state.shown !== texture) {
      uniforms.posterPrevious.value = state.shown;
      poster.map = texture;
      state.shown = texture;
      state.startedAt = clock.elapsedTime;
    }
    if (state.startedAt < 0) return;
    const t = Math.min(1, (clock.elapsedTime - state.startedAt) / FLIP_S);
    uniforms.posterFlip.value = t;
    // The lamps flare while the slats turn: movement and light draw the eye.
    uniforms.posterGlow.value = GLOW + 0.55 * Math.sin(Math.PI * t);
    if (t >= 1) state.startedAt = -1;
  });
  return [material, mesh] as const;
}

function Board({ board, index, y }: { board: BillboardDesign; index: number; y: number }) {
  const scale = board.scale ?? 1;
  const base = SIZE[board.size];
  const { w, h, lift } = { w: base.w * scale, h: base.h * scale, lift: base.lift * scale };
  const lean = base.lean;
  const texture = useBillboardTexture(index, { style: board.size });
  const [posterMaterial, posterMesh] = usePosterFlip(texture);
  const posts = board.size === 'tower' ? [0] : [-w * 0.36, w * 0.36];
  return (
    <group position={[board.x, y, board.z]} rotation={[0, posterAngle(board.angle), 0]}>
      {posts.map((x) => (
        // Posts stand behind the leaning poster and carry it at mid-height.
        <mesh
          key={x}
          position={[x, (lift + Math.cos(lean) * h * 0.5) / 2, -Math.sin(lean) * h * 0.5 - 0.35]}
          castShadow
          receiveShadow
          raycast={ignoreRaycast}
        >
          <boxGeometry args={[board.size === 'tower' ? 0.7 : 0.34, lift + Math.cos(lean) * h * 0.5, board.size === 'tower' ? 0.7 : 0.34]} />
          <meshStandardMaterial color={TIMBER} roughness={0.9} />
        </mesh>
      ))}
      {/* The poster leans back so it reads from the high RTS camera. */}
      <group position={[0, lift, 0]} rotation={[-lean, 0, 0]}>
        {/* Backing boards and a red-painted frame. */}
        <mesh position={[0, h / 2, -0.12]} castShadow receiveShadow raycast={ignoreRaycast}>
          <boxGeometry args={[w + 0.5, h + 0.5, 0.18]} />
          <meshStandardMaterial color={TRIM} roughness={0.8} />
        </mesh>
        <mesh ref={posterMesh} position={[0, h / 2, 0.0]} raycast={ignoreRaycast} material={posterMaterial}>
          <planeGeometry args={[w, h]} />
        </mesh>
        <mesh position={[0, h + 0.35, 0.05]} castShadow raycast={ignoreRaycast}>
          <boxGeometry args={[w + 0.9, 0.22, 0.6]} />
          <meshStandardMaterial color="#3b4450" roughness={0.6} metalness={0.3} />
        </mesh>
        {/* Gooseneck lamps over the poster. */}
        {[-w * 0.3, w * 0.3].map((x) => (
          <group key={x} position={[x, h + 0.3, 0.5]}>
            <mesh raycast={ignoreRaycast}>
              <boxGeometry args={[0.5, 0.18, 0.35]} />
              <meshStandardMaterial color="#2a2f35" roughness={0.5} metalness={0.5} />
            </mesh>
            <mesh position={[0, -0.1, 0.05]} raycast={ignoreRaycast}>
              <boxGeometry args={[0.4, 0.04, 0.25]} />
              <meshBasicMaterial color="#ffd690" toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * Sponsor billboards: the authored ones from `design.billboards`, plus one
 * beside every landing where the opening camera sees it (`homeBillboards`).
 * A home board stands down when a commander builds on its ground; it never
 * blocks construction.
 */
export function WorldBillboards({ map, occupied = [] }: { map: CompiledMap; occupied?: Footprint[] }) {
  const standing = useMemo(() => standingBillboards(map, occupied), [map, occupied]);
  return (
    <group>
      {standing.map(({ board: b, index: i }) => (
        <Quiet key={i}>
          <Suspense fallback={null}>
            <Board board={b} index={i} y={map.heightAt(b.x, b.z)} />
          </Suspense>
        </Quiet>
      ))}
    </group>
  );
}
