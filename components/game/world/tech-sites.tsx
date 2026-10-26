'use client';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withMeshopt } from '@/lib/gltf';
import { cultureArt } from '@/lib/culture-art';
import type { Culture } from '@/lib/cultures';
import {
  SITE_RULES,
  TECH_SITES,
  captureShare,
  reconPosition,
  type Battle,
  type ReconFlight,
  type TechSite,
} from '@/lib/tactics';
import { useTerrain } from '../terrain-context';
import { modelUrl } from './models';

const ignoreRaycast = () => {};
export const SITE_NEUTRAL = '#a9b3ba';
export const SITE_HOSTILE = '#c75240';
/** Who is taking a site: the coalition in teal, the garrison in coral; amber while contested. */
export const SITE_TAKER = { blue: '#71e8da', red: '#f27c6e' } as const;
export const SITE_CONTESTED = '#f2b84b';
/** Recon planes cruise this high over the ground. */
const CRUISE = 24;
const siteModel = (kind: string) => modelUrl(`tactical/sites/${kind}`);

/** The holder's colour: their commander's culture, the garrison's red, or neutral grey. */
export function siteColor(
  site: Pick<TechSite, 'team' | 'holder'>,
  commanders: Battle['commanders'],
) {
  if (site.team === 'red') return SITE_HOSTILE;
  if (site.team !== 'blue') return SITE_NEUTRAL;
  const c = commanders.find((c) => c.id === site.holder);
  return c ? cultureArt(c.culture as Culture).primary : '#59c5d9';
}
/**
 * The battle's clock, carried forward between ticks on the local clock. Frame
 * loops call it; it re-anchors the first time it sees a new tick.
 */
function useServerClock(tickAt: number) {
  const anchor = useRef({ tickAt: Number.NaN, at: 0 });
  return () => {
    const a = anchor.current;
    if (a.tickAt !== tickAt) {
      a.tickAt = tickAt;
      a.at = performance.now();
    }
    return a.tickAt + (performance.now() - a.at);
  };
}

type Ground = (x: number, z: number) => number;
/**
 * A band on the ground around a site: `fill` of a full turn, clockwise from
 * north, from `inner` to `outer` metres. Every vertex follows the terrain, so
 * a ring across a slope is never buried in it. Coordinates are relative to
 * the site's centre, whose ground height is `base`.
 */
function groundBand(
  heightAt: Ground,
  site: { x: number; z: number },
  base: number,
  inner: number,
  outer: number,
  fill = 1,
  lift = 0.3,
) {
  const segments = Math.max(4, Math.ceil(96 * fill)),
    positions: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * fill * Math.PI * 2,
      sx = Math.sin(t),
      sz = -Math.cos(t);
    for (const r of [inner, outer]) {
      const x = sx * r,
        z = sz * r;
      positions.push(x, heightAt(site.x + x, site.z + z) - base + lift, z);
    }
    if (i < segments) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  return g;
}
function Band({
  geometry,
  color,
  opacity,
  order,
  material,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  opacity: number;
  order: number;
  material?: React.Ref<THREE.MeshBasicMaterial>;
}) {
  return (
    <mesh geometry={geometry} raycast={ignoreRaycast} renderOrder={order}>
      <meshBasicMaterial
        ref={material}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

/** The capture ring: a band in the holder's colour, a progress arc in the taker's. */
function CaptureRing({ site, color }: { site: TechSite; color: string }) {
  const { heightAt } = useTerrain();
  const r = SITE_RULES.captureRadius;
  const { x, z } = site;
  const base = heightAt(x, z);
  const share = captureShare(site);
  const health = site.hp / TECH_SITES[site.kind].hp;
  const shapes = useMemo(
    () => ({
      field: groundBand(heightAt, { x, z }, base, 6.5, r, 1, 0.2),
      edge: groundBand(heightAt, { x, z }, base, r - 0.6, r),
    }),
    [heightAt, x, z, base, r],
  );
  // Rebuilt as the count moves, once a tick.
  const progress = useMemo(
    () =>
      share > 0
        ? groundBand(heightAt, { x, z }, base, r - 2.2, r - 0.8, share, 0.35)
        : null,
    [heightAt, x, z, base, r, share],
  );
  const strength = useMemo(
    () =>
      site.team && health < 1
        ? groundBand(heightAt, { x, z }, base, r - 3, r - 2.5, health, 0.35)
        : null,
    [heightAt, x, z, base, r, site.team, health],
  );
  const taker = site.contested
    ? SITE_CONTESTED
    : site.capturing
      ? SITE_TAKER[site.capturing]
      : color;
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current)
      glow.current.opacity = site.contested
        ? 0.45 + 0.4 * Math.sin(clock.elapsedTime * 6) ** 2
        : 0.95;
  });
  return (
    <group>
      <Band
        geometry={shapes.field}
        color={color}
        opacity={site.team ? 0.12 : 0.06}
        order={1}
      />
      <Band
        geometry={shapes.edge}
        color={color}
        opacity={site.team ? 0.85 : 0.55}
        order={2}
      />
      {progress && (
        <Band
          geometry={progress}
          color={taker}
          opacity={0.95}
          order={3}
          material={glow}
        />
      )}
      {/* Strength: a thin inner arc once the site has taken fire. */}
      {strength && (
        <Band
          geometry={strength}
          color={health > 0.35 ? '#e8e4d8' : '#f27c6e'}
          opacity={0.85}
          order={3}
        />
      )}
    </group>
  );
}

type SiteRig = {
  pump?: THREE.Object3D;
  flags: { node: THREE.Object3D; ry: number }[];
};
/** The pumpjack rocks while the site is held; flags always wave. */
function animateSite(rig: SiteRig, held: boolean, t: number) {
  if (rig.pump) rig.pump.rotation.x = held ? Math.sin(t * 1.6) * 0.28 : 0;
  for (const f of rig.flags)
    f.node.rotation.y = f.ry + Math.sin(t * 2.3) * 0.22;
}
/** The site's diorama model, painted in the holder's colour; the pumpjack rocks while held. */
function SiteModel({ site, color }: { site: TechSite; color: string }) {
  const gltf = useLoader(GLTFLoader, siteModel(site.kind), withMeshopt);
  const asset = useMemo(() => {
    const model = gltf.scene.clone(true);
    model.traverse((n) => {
      if (!(n instanceof THREE.Mesh)) return;
      n.castShadow = true;
      n.receiveShadow = true;
      n.material = (n.material as THREE.MeshStandardMaterial).clone();
      const m = n.material as THREE.MeshStandardMaterial;
      if (m.name === 'culture_trim') {
        m.color.set(color);
        m.emissive.set(color);
        m.emissiveIntensity = 0.16;
      }
      if (/lamp|glass/.test(m.name)) {
        m.emissive.set('#ffc46b');
        m.emissiveIntensity = m.name === 'lamp' ? 2.2 : 0.6;
      }
    });
    return {
      model,
      pump: model.getObjectByName('pump'),
      flags: (() => {
        const list: THREE.Object3D[] = [];
        model.traverse((n) => {
          if (n.name.startsWith('flag')) list.push(n);
        });
        return list.map((node) => ({ node, ry: node.rotation.y }));
      })(),
    };
  }, [gltf, color]);
  // Frame loops read the rig through a ref; the render never mutates it.
  const parts = useRef({ asset, held: !!site.team });
  useEffect(() => {
    parts.current = { asset, held: !!site.team };
  }, [asset, site.team]);
  useFrame(({ clock }) =>
    animateSite(
      parts.current.asset,
      parts.current.held,
      clock.elapsedTime + site.x,
    ),
  );
  return <primitive object={asset.model} />;
}

function SiteLabel({ site, color }: { site: TechSite; color: string }) {
  const spec = TECH_SITES[site.kind];
  const holder = !site.team
    ? 'Neutral'
    : site.team === 'red'
      ? 'Enemy held'
      : 'Coalition';
  const status = site.contested
    ? 'Contested'
    : site.capturing
      ? `${site.capturing === 'blue' ? 'Capturing' : 'Enemy capturing'} ${Math.round(captureShare(site) * 100)}%`
      : holder;
  return (
    <Html
      center
      position={[0, 14, 0]}
      zIndexRange={[8, 1]}
      style={{ pointerEvents: 'none' }}
    >
      <span
        className="tac-objective-label tac-site-label"
        style={{ borderLeftColor: site.contested ? SITE_CONTESTED : color }}
      >
        <b style={{ color }}>{spec.name}</b>
        {status}
      </span>
    </Html>
  );
}

/**
 * Neutral tech sites: the model in its holder's colour, the capture ring with
 * its progress arc, and a label. Sites are landmarks, drawn through the fog.
 * Clicking one hits `userData.tacticalId`: a hostile one is attacked, any other
 * is a move order into its ring.
 */
export function TechSites({
  battle,
  labels = true,
}: {
  battle: Pick<Battle, 'sites' | 'commanders'>;
  labels?: boolean;
}) {
  const { heightAt } = useTerrain();
  return (
    <group>
      {(battle.sites ?? []).map((site) => {
        const color = siteColor(site, battle.commanders);
        return (
          <group
            key={site.id}
            position={[site.x, heightAt(site.x, site.z), site.z]}
          >
            <CaptureRing site={site} color={color} />
            <group
              rotation={[0, site.angle, 0]}
              userData={{ tacticalId: site.id }}
            >
              <Suspense fallback={null}>
                <SiteModel site={site} color={color} />
              </Suspense>
            </group>
            {labels && <SiteLabel site={site} color={color} />}
          </group>
        );
      })}
    </group>
  );
}

/** One recon plane in flight, placed every frame from its flight plan. */
function Flight({
  flight,
  color,
  clock,
}: {
  flight: ReconFlight;
  color: string;
  clock: () => number;
}) {
  const gltf = useLoader(GLTFLoader, siteModel('recon'), withMeshopt);
  const { heightAt } = useTerrain();
  const body = useRef<THREE.Group>(null);
  const asset = useMemo(() => {
    const model = gltf.scene.clone(true);
    model.traverse((n) => {
      if (!(n instanceof THREE.Mesh)) return;
      n.castShadow = true;
      n.material = (n.material as THREE.MeshStandardMaterial).clone();
      const m = n.material as THREE.MeshStandardMaterial;
      if (m.name === 'culture_trim') {
        m.color.set(color);
        m.emissive.set(color);
        m.emissiveIntensity = 0.2;
      }
    });
    return { model, prop: model.getObjectByName('prop') };
  }, [gltf, color]);
  const prop = useRef(asset.prop);
  useEffect(() => {
    prop.current = asset.prop;
  }, [asset]);
  useFrame((_, delta) => {
    const g = body.current;
    if (!g) return;
    const now = clock();
    const p = reconPosition(flight, now);
    const climb = Math.min(
      1,
      (now - flight.launchedAt) / 4000,
      (flight.goneAt - now) / 4000,
    );
    g.visible = now >= flight.launchedAt && now < flight.goneAt;
    g.position.set(
      p.x,
      heightAt(p.x, p.z) + 1.4 + (CRUISE - 1.4) * Math.max(0, climb),
      p.z,
    );
    g.rotation.set(0, p.heading, 0);
    // Banked round the loiter circuit, level on the straight legs.
    const banking = now > flight.arriveAt && now < flight.leaveAt;
    g.rotateZ(banking ? -0.45 : 0);
    if (prop.current) prop.current.rotation.z += delta * 40;
  });
  return (
    <group ref={body}>
      <primitive object={asset.model} />
    </group>
  );
}

/** Recon planes from captured airstrips, flying their plans between server ticks. */
export function ReconFlights({
  battle,
}: {
  battle: Pick<Battle, 'recon' | 'sites' | 'commanders' | 'tickAt'>;
}) {
  const clock = useServerClock(battle.tickAt);
  return (
    <group>
      {(battle.recon ?? []).map((f) => (
        <Suspense key={f.id} fallback={null}>
          <Flight
            flight={f}
            clock={clock}
            color={
              f.team === 'red'
                ? SITE_HOSTILE
                : siteColor(
                    { team: 'blue', holder: f.owner },
                    battle.commanders,
                  )
            }
          />
        </Suspense>
      ))}
    </group>
  );
}
/** What coalition tech sites and recon planes see right now, for the fog of war. */
export function siteEyes(
  battle: Pick<Battle, 'recon' | 'sites'>,
  now: number,
): { x: number; z: number; radius: number }[] {
  return [
    ...(battle.sites ?? [])
      .filter((s) => s.team === 'blue')
      .map((s) => ({ x: s.x, z: s.z, radius: SITE_RULES.vision })),
    ...(battle.recon ?? [])
      .filter((f) => f.team === 'blue' && now >= f.launchedAt && now < f.goneAt)
      .map((f) => ({
        ...reconPosition(f, now),
        radius: TECH_SITES.airstrip.reconVision,
      })),
  ];
}
