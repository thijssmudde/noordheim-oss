'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cultureArt } from '@/lib/culture-art';
import type { Culture } from '@/lib/cultures';
import {
  PICKUP_RADIUS,
  PICKUP_SECONDS,
  RETURN_SECONDS,
  carrierOf,
  flagHome,
  flagState,
  type Battle,
  type Flag,
} from '@/lib/tactics';
import { useTerrain } from '../terrain-context';
import { unitBodies } from './fx-registry';

const ignoreRaycast = () => {};
const HOSTILE = '#c75240';
const POLE = 10;
/** The short staff a carrier bears, and how high above the troop's origin it is mounted. */
const STAFF = 3.2;
const MOUNT = 2.4;

/** A pennant that ripples: vertices sway with distance from the pole. */
function Cloth({
  color,
  still,
  y,
  scale = 1,
}: {
  color: string;
  still: boolean;
  y: number;
  scale?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(5, 3, 14, 5);
    g.translate(2.5, 0, 0);
    return g;
  }, []);
  const rest = useRef<Float32Array | null>(null);
  useFrame(({ clock }) => {
    if (!mesh.current || still) return;
    const g = mesh.current.geometry;
    const position = g.attributes.position as THREE.BufferAttribute;
    rest.current ??= Float32Array.from(position.array as Float32Array);
    const t = clock.elapsedTime;
    for (let i = 0; i < position.count; i++) {
      const x = rest.current[i * 3];
      position.setZ(i, Math.sin(x * 1.7 - t * 4.2) * 0.3 * (x / 5));
    }
    position.needsUpdate = true;
    g.computeVertexNormals();
  });
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      position={[0.12, y, 0]}
      scale={scale}
      castShadow
      raycast={ignoreRaycast}
    >
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.18}
        side={THREE.DoubleSide}
        roughness={0.8}
      />
    </mesh>
  );
}

function Pole({ height, radius = 0.11 }: { height: number; radius?: number }) {
  return (
    <>
      <mesh position={[0, height / 2, 0]} castShadow raycast={ignoreRaycast}>
        <cylinderGeometry args={[radius * 0.8, radius * 1.2, height, 8]} />
        <meshStandardMaterial color="#d8d4c8" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, height + 0.12, 0]} raycast={ignoreRaycast}>
        <sphereGeometry args={[radius * 1.8, 10, 8]} />
        <meshStandardMaterial color="#e8c46a" metalness={0.8} roughness={0.3} />
      </mesh>
    </>
  );
}

/** A flat ground arc: `fill` of a full turn, clockwise from north. */
function Arc({
  inner,
  outer,
  fill,
  color,
  opacity,
}: {
  inner: number;
  outer: number;
  fill: number;
  color: string;
  opacity: number;
}) {
  if (fill <= 0) return null;
  return (
    <mesh raycast={ignoreRaycast} renderOrder={3}>
      <ringGeometry
        args={[inner, outer, 64, 1, Math.PI / 2, -Math.min(1, fill) * Math.PI * 2]}
      />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** The home zone on the ground: a faint band marking where carriers score. */
function Zone({ flag, color }: { flag: Flag; color: string }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
      <mesh raycast={ignoreRaycast} renderOrder={2}>
        <ringGeometry args={[flag.radius - 0.45, flag.radius, 96]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.5}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh raycast={ignoreRaycast} renderOrder={1}>
        <circleGeometry args={[flag.radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.07} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Pickup progress: an arc around the flag that fills in the taker's colour. */
function Pickup({ flag, color }: { flag: Flag; color: string }) {
  if (!flag.pickupBy || !flag.pickupProgress) return null;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
      <Arc
        inner={PICKUP_RADIUS - 0.7}
        outer={PICKUP_RADIUS}
        fill={flag.pickupProgress / PICKUP_SECONDS}
        color={color}
        opacity={0.85}
      />
    </group>
  );
}

/**
 * A carried flag: a short staff mounted above the carrier, following its
 * interpolated pose through the unit registry, with a pulsing ground marker.
 */
function Carried({ flag, color }: { flag: Flag; color: string }) {
  const { heightAt } = useTerrain();
  const staff = useRef<THREE.Group>(null),
    marker = useRef<THREE.Group>(null),
    glow = useRef<THREE.MeshBasicMaterial>(null);
  const id = carrierOf(flag);
  useFrame(({ clock }) => {
    const body = id ? unitBodies.get(id) : undefined;
    const x = body ? body.position.x : flag.x,
      z = body ? body.position.z : flag.z,
      y = body ? body.position.y : heightAt(x, z);
    staff.current?.position.set(x, y + MOUNT, z);
    marker.current?.position.set(x, heightAt(x, z) + 0.14, z);
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5);
    if (glow.current) glow.current.opacity = 0.35 + 0.45 * pulse;
    if (marker.current) marker.current.scale.setScalar(1 + 0.25 * pulse);
  });
  return (
    <>
      <group ref={staff} position={[flag.x, heightAt(flag.x, flag.z) + MOUNT, flag.z]}>
        <Pole height={STAFF} radius={0.06} />
        <Cloth color={color} still={false} y={STAFF - 0.55} scale={0.36} />
      </group>
      <group ref={marker} position={[flag.x, heightAt(flag.x, flag.z) + 0.14, flag.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={ignoreRaycast} renderOrder={3}>
          <ringGeometry args={[2.3, 2.9, 48]} />
          <meshBasicMaterial
            ref={glow}
            color={color}
            transparent
            opacity={0.6}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  );
}

/** A dropped flag lies tilted on the ground, a ring counting down its return home. */
function Dropped({
  flag,
  color,
  tickAt,
}: {
  flag: Flag;
  color: string;
  tickAt: number;
}) {
  const { heightAt } = useTerrain();
  const left = Math.max(
    0,
    1 - (tickAt - (flag.droppedAt ?? tickAt)) / (RETURN_SECONDS * 1000),
  );
  return (
    <group position={[flag.x, heightAt(flag.x, flag.z), flag.z]}>
      <group rotation={[0, 0.6, 1.15]} position={[0, 0.2, 0]}>
        <Pole height={4.5} radius={0.07} />
        <Cloth color={color} still y={3.7} scale={0.5} />
      </group>
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}>
        <mesh raycast={ignoreRaycast} renderOrder={2}>
          <ringGeometry args={[PICKUP_RADIUS + 0.2, PICKUP_RADIUS + 0.55, 64]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.25}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <Arc
          inner={PICKUP_RADIUS + 0.2}
          outer={PICKUP_RADIUS + 0.55}
          fill={left}
          color={color}
          opacity={0.8}
        />
      </group>
    </group>
  );
}

/**
 * Carry-the-flag markers: each army's home zone ring with its pole, the flag
 * itself where it is (on the pole, on a carrier, or lying where a carrier
 * fell) and the pickup progress arc. A captured flag hangs low on its pole.
 */
export function CaptureFlags({
  battle,
}: {
  battle: Pick<Battle, 'flags' | 'commanders' | 'tickAt'>;
}) {
  const { heightAt } = useTerrain();
  const colorOf = (owner: string, team: 'blue' | 'red') => {
    if (team === 'red') return HOSTILE;
    const c = battle.commanders.find((c) => c.id === owner);
    return c ? cultureArt(c.culture as Culture).primary : '#59c5d9';
  };
  return (
    <group>
      {(battle.flags ?? []).map((flag) => {
        const color = colorOf(flag.owner, flag.team);
        const taker = flag.team === 'red' ? '#71e8da' : '#f27c6e';
        const captured = flag.capturedAt !== undefined;
        const state = captured ? 'home' : flagState(flag);
        const home = flagHome(flag);
        return (
          <group key={flag.id}>
            <group position={[home.x, heightAt(home.x, home.z), home.z]}>
              <Zone flag={flag} color={color} />
              <Pole height={POLE} />
              <mesh position={[0, 0.25, 0]} castShadow receiveShadow raycast={ignoreRaycast}>
                <cylinderGeometry args={[0.7, 0.9, 0.5, 8]} />
                <meshStandardMaterial color="#6f6c66" roughness={0.9} />
              </mesh>
              {state === 'home' && (
                <Cloth
                  color={captured ? taker : color}
                  still={captured}
                  y={captured ? 1.9 : POLE - 1.6}
                />
              )}
            </group>
            {state === 'carried' && <Carried flag={flag} color={color} />}
            {state === 'dropped' && (
              <Dropped flag={flag} color={color} tickAt={battle.tickAt} />
            )}
            {!captured && state !== 'carried' && (
              <group position={[flag.x, heightAt(flag.x, flag.z), flag.z]}>
                <Pickup flag={flag} color={taker} />
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}
