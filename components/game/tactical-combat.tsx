'use client';
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withMeshopt } from '../../lib/gltf';
import {
  CombatPresentation,
  DeathWatch,
  WEAPON_PROFILES,
  shellArc,
  type Death,
} from '@/lib/combat-presentation';
import { isUnit, isAir, spec, TACTICAL_UNITS, type Battle } from '@/lib/tactics';
import type { FogGrid } from '@/lib/tactical-fog';
import { useTerrain } from './terrain-context';
import { useOptionalGameAudio } from './game-audio';
import { FxEngine } from './world/fx';
import {
  constructionSites,
  emitters,
  muzzlePosition,
} from './world/fx-registry';
import { modelPath } from './world/models';

const ignoreRaycast = () => {};
const MAX_REMNANTS = 14;
/** Seconds a wreck burns and a ruin stands, including the final sink out of sight. */
const WRECK_SECONDS = 30;
const RUIN_SECONDS = 16;
const SINK_SECONDS = 4;
const lifeOf = (r: Remnant) => (r.ruin ? RUIN_SECONDS : WRECK_SECONDS);

type Remnant = Death & { at: number; y: number; ruin: boolean };

/** How brightly lamps burn: full at dusk and under the aurora, a glint at golden hour. */
export function lampLevel(grade: string, weather: string) {
  if (grade === 'dusk' || weather === 'aurora') return 1;
  if (grade === 'overcast' || weather === 'blizzard') return 0.55;
  return grade === 'dawn' ? 0.45 : 0.3;
}

const CHARRED = new THREE.MeshStandardMaterial({
  color: '#3b342e',
  roughness: 1,
  metalness: 0.1,
});

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** A burnt-out vehicle hull or a collapsing structure, sinking away after a while. */
function RemnantModel({ remnant }: { remnant: Remnant }) {
  const gltf = useLoader(GLTFLoader, modelPath(remnant.kind), withMeshopt);
  const group = useRef<THREE.Group>(null);
  const model = useMemo(() => {
    const m = gltf.scene.clone(true);
    m.traverse((o) => {
      o.raycast = ignoreRaycast;
      if (o instanceof THREE.Mesh) {
        o.material = CHARRED;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(m, true);
    return { m, height: Math.max(1, box.max.y) };
  }, [gltf]);
  const tilt = useMemo(() => {
    const h = Math.abs(Math.sin(remnant.x * 12.9898 + remnant.z * 78.233) * 43758.5453) % 1;
    return { x: (h - 0.5) * 0.25, z: (((h * 7) % 1) - 0.5) * 0.3 };
  }, [remnant]);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const age = clock.elapsedTime - remnant.at;
    // Ruins slump fast, then settle; everything sinks fully below ground at the end of its life.
    const slump = remnant.ruin
      ? Math.min(1, age / 3.2) ** 0.6 * model.height * 0.58
      : 0;
    const sink =
      Math.min(1, Math.max(0, (age - lifeOf(remnant) + SINK_SECONDS) / SINK_SECONDS)) ** 1.5 *
      (model.height + 0.5);
    g.position.set(remnant.x, remnant.y - slump - sink, remnant.z);
    g.rotation.set(
      remnant.ruin ? Math.min(1, age / 3) * tilt.x * 0.6 : tilt.x,
      remnant.angle,
      remnant.ruin ? Math.min(1, age / 3) * tilt.z * 0.5 : tilt.z,
    );
    const shrink = remnant.ruin ? 1 : 0.94;
    g.scale.set(shrink, remnant.ruin ? 1 - Math.min(1, age / 3.2) * 0.2 : 0.9, shrink);
  });
  return (
    <group ref={group}>
      <primitive object={model.m} />
    </group>
  );
}

/**
 * Battlefield effects: muzzle flashes at barrel tips, tracers, shell arcs,
 * explosions with fireball, smoke column, debris, shockwave and scorch marks,
 * burning wrecks and collapsing structures, plus the ambient life of standing
 * bases (chimney smoke, construction dust, lamps). A few instanced draws in
 * total, pooled with no per-frame allocation; every effect respects fog.
 */
export function TacticalCombat({
  battle,
  fog,
  lamps = 0.3,
}: {
  battle: Battle;
  fog: FogGrid;
  /** 0..1 lamp glow strength for the map's light (dusk: full). */
  lamps?: number;
}) {
  const map = useTerrain();
  const audio = useOptionalGameAudio();
  const root = useRef<THREE.Group>(null);
  const engine = useRef<FxEngine | null>(null);
  const latest = useRef(battle);
  const hidden = useRef(false);
  const [remnants, setRemnants] = useState<Remnant[]>([]);
  const live = useRef({
    tracker: new CombatPresentation(),
    deaths: new DeathWatch(),
    lastBattle: null as Battle | null,
    nextDamage: 0,
    carry: new Map<unknown, number>(),
    end: new THREE.Vector3(),
    remnants: [] as Remnant[],
    lampPositions: Array.from({ length: 160 }, () => new THREE.Vector3()),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    screen: new THREE.Vector3(),
    eye: new THREE.Vector3(),
  });
  useEffect(() => {
    latest.current = battle;
  }, [battle]);
  useEffect(() => {
    live.current.remnants = remnants;
  }, [remnants]);
  const snowy = map.design.atmosphere.snowCover > 0.45;
  useEffect(() => {
    const visibility = () => {
      hidden.current = document.hidden;
      engine.current?.clear();
      live.current.tracker = new CombatPresentation();
      live.current.deaths = new DeathWatch();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);
  useFrame(({ clock, camera }, delta) => {
    if (!root.current || hidden.current) return;
    if (!engine.current) {
      engine.current = new FxEngine();
      engine.current.groundAt = map.heightAt;
      root.current.add(engine.current.group);
    }
    const fx = engine.current,
      L = live.current,
      now = clock.elapsedTime;
    const b = latest.current;
    const seen = (p: { x: number; z: number }) => fog.sight(p) === 'visible';
    const visible = (x: number, z: number) => fog.sight({ x, z }) === 'visible';
    camera.getWorldPosition(L.eye);

    if (L.lastBattle !== b) {
      L.lastBattle = b;
      // Shots confirmed by the server this tick.
      for (const shot of L.tracker.update(b, seen)) {
        const profile = WEAPON_PROFILES[shot.family];
        const to = L.to.set(
          shot.to.x,
          map.heightAt(shot.to.x, shot.to.z) + shot.targetHeight,
          shot.to.z,
        );
        const from =
          muzzlePosition(shot.id, L.from) ??
          L.from.set(
            shot.from.x,
            map.heightAt(shot.from.x, shot.from.z) + shot.height,
            shot.from.z,
          );
        if (!muzzlePosition(shot.id)) {
          L.dir.subVectors(to, from).normalize();
          from.addScaledVector(L.dir, profile.reach);
        }
        const distance = from.distanceTo(to);
        const arc = shellArc(shot.family, distance);
        const tracer = profile.tracer;
        for (let i = 0; i < profile.burst; i++) {
          const delay = i * 0.065;
          const jitter = shot.family === 'rifle' || shot.family === 'machine' ? 0.5 : 0;
          const end = L.end.set(
            to.x + Math.sin(shot.seed + i * 3.1) * jitter,
            to.y,
            to.z + Math.cos(shot.seed + i * 1.7) * jitter,
          );
          const blast = profile.blast;
          fx.tracer(now, from, end, {
            duration: Math.max(0.05, (distance + arc) / profile.speed),
            width: tracer.width,
            length: Math.min(tracer.length, distance * 0.5),
            r: tracer.color[0],
            g: tracer.color[1],
            b: tracer.color[2],
            arc,
            delay,
            trail: shot.family === 'rocket' ? 34 : shot.family === 'artillery' ? 22 : 0,
            onLand: (x, y, z) => {
              if (!visible(x, z)) return;
              if (blast > 0) fx.explode(clock.elapsedTime, x, map.heightAt(x, z), z, blast, false);
              else fx.impact(clock.elapsedTime, x, y, z, shot.family === 'machine' ? 1.1 : 0.8, snowy);
            },
          });
          if (i === 0 || shot.family !== 'rifle') fx.flash(now + delay, from.x, from.y, from.z, profile.size);
        }
        L.screen.copy(from).project(camera);
        if (Math.abs(L.screen.x) < 1.3 && Math.abs(L.screen.y) < 1.3)
          audio?.playWeapon(
            shot.family,
            Math.max(-1, Math.min(1, L.screen.x)),
            Math.min(0.85, 24 / Math.max(20, camera.position.distanceTo(from))),
          );
      }
      // Deaths: vehicles burn, structures collapse, infantry leave a puff.
      const fresh: Remnant[] = [];
      for (const d of L.deaths.update(b, seen)) {
        const y = map.heightAt(d.x, d.z) + (d.category === 'air' ? (d.kind === 'drone' ? 5 : 7) : 0);
        if (d.category === 'infantry') {
          fx.impact(now, d.x, y + 0.6, d.z, 1.3, snowy);
          continue;
        }
        const structure = d.category === 'structure';
        fx.explode(now, d.x, y + 0.5, d.z, structure ? 2.2 : 1.35, structure);
        if (structure)
          for (let k = 0; k < 3; k++)
            fx.explode(now + 0.25 + k * 0.3, d.x + Math.sin(k * 2.1) * 3, y + 1, d.z + Math.cos(k * 2.1) * 3, 1.1, true);
        if (d.category !== 'air')
          fresh.push({ ...d, y: map.heightAt(d.x, d.z), at: now, ruin: structure });
      }
      if (fresh.length)
        setRemnants((list) => [...list, ...fresh].slice(-MAX_REMNANTS));
      // A new structure raised on a ruin clears the rubble away.
      const built = L.remnants.filter(
        (r) =>
          r.ruin &&
          b.entities.some(
            (e) => e.hp > 0 && !isUnit(e.kind) && Math.hypot(e.x - r.x, e.z - r.z) < 4,
          ),
      );
      if (built.length) setRemnants((list) => list.filter((r) => !built.includes(r)));
    }

    // Persistent damage: low-health vehicles and structures smoke, structures burn.
    if (now >= L.nextDamage) {
      L.nextDamage = now + 0.22;
      let emitted = 0;
      for (const e of b.entities) {
        if (
          e.hp <= 0 ||
          e.readyAt > 0 ||
          e.hp / spec(e.kind).hp >= 0.45 ||
          (isUnit(e.kind) && TACTICAL_UNITS[e.kind].category === 'infantry') ||
          !seen(e)
        )
          continue;
        if (emitted++ >= 28) break;
        const y =
          map.heightAt(e.x, e.z) + (isAir(e.kind) ? 6 : isUnit(e.kind) ? 1.6 : 3);
        const severe = e.hp / spec(e.kind).hp < 0.25;
        fx.puffAt(now, e.x, y, e.z, {
          size: isUnit(e.kind) ? 0.9 : 1.6,
          grow: isUnit(e.kind) ? 3 : 5,
          life: 3.2,
          r: 0.18,
          g: 0.17,
          b: 0.16,
          a: 0.6,
          vy: 1.8,
          drag: 0.4,
        });
        if (!isUnit(e.kind) || severe)
          fx.spark(now, e.x + Math.sin(now * 5 + emitted) * 1.2, y - 0.8, e.z + Math.cos(now * 4) * 1.2, {
            size: isUnit(e.kind) ? 0.9 : 1.8,
            life: 0.45,
            r: 9,
            g: 3.6,
            b: 0.9,
            vy: 2.2,
            grow: 0.8,
          });
      }
    }

    // Wrecks burn, ruins smoulder and throw dust as they fall.
    for (const r of L.remnants) {
      const age = now - r.at;
      if (age > lifeOf(r) - SINK_SECONDS || !visible(r.x, r.z)) continue;
      const rate = r.ruin ? (age < 4 ? 14 : 3) : age < 20 ? 6 : 2.5;
      const key = `${r.id}:${r.at}`;
      const carry = (L.carry.get(key) ?? 0) + rate * delta;
      L.carry.set(key, carry % 1);
      for (let k = 0; k < Math.floor(carry); k++) {
        const jx = Math.sin(now * 13 + k) * (r.ruin ? 3 : 1),
          jz = Math.cos(now * 11 + k) * (r.ruin ? 3 : 1);
        if (r.ruin && age < 4)
          fx.puffAt(now, r.x + jx * 1.5, r.y + 0.8, r.z + jz * 1.5, {
            size: 2.2, grow: 7, life: 3, r: 0.55, g: 0.5, b: 0.44, a: 0.55, vy: 1.2, drag: 0.8,
            vx: jx, vz: jz,
          });
        fx.puffAt(now, r.x + jx * 0.4, r.y + 1.4, r.z + jz * 0.4, {
          size: 1, grow: 4.5, life: 4.5, r: 0.13, g: 0.12, b: 0.12, a: 0.55, vy: 2.4, drag: 0.3,
        });
        if (age < (r.ruin ? 9 : 20))
          fx.spark(now, r.x + jx * 0.5, r.y + 0.9, r.z + jz * 0.5, {
            size: 1.3, life: 0.5, r: 10, g: 4, b: 1, vy: 2.6, grow: 0.9,
          });
      }
    }
    // Remnants past their life leave the scene.
    if (L.remnants.some((r) => now - r.at > lifeOf(r))) {
      for (const r of L.remnants) if (now - r.at > lifeOf(r)) L.carry.delete(`${r.id}:${r.at}`);
      setRemnants((list) => list.filter((r) => now - r.at <= lifeOf(r)));
    }

    // Chimney smoke and lamps of standing structures; dust over construction.
    let lampCount = 0;
    for (const list of emitters.values())
      for (const em of list) {
        if (!em.node.parent) continue;
        const p = em.node.getWorldPosition(L.dir);
        if (!visible(p.x, p.z)) continue;
        if (em.kind === 'light') {
          if (lampCount < L.lampPositions.length) L.lampPositions[lampCount++].copy(p);
          continue;
        }
        if (L.eye.distanceTo(p) > 260) continue;
        const carry = (L.carry.get(em.node) ?? Math.random()) + em.strength * delta;
        L.carry.set(em.node, carry % 1);
        if (carry >= 1)
          fx.puffAt(now, p.x, p.y, p.z, {
            size: 0.6, grow: 3.4, life: 5, r: 0.78, g: 0.77, b: 0.76, a: 0.5, vy: 1.6, drag: 0.25,
          });
      }
    fx.lamps(L.lampPositions, lampCount, lamps, now, camera);
    for (const [id, site] of constructionSites) {
      if (!visible(site.x, site.z)) continue;
      const key = `site:${id}`;
      const carry = (L.carry.get(key) ?? 0) + 5 * delta;
      L.carry.set(key, carry % 1);
      if (carry >= 1) {
        const a = (now * 2.3 + id.length) % (Math.PI * 2);
        fx.puffAt(now, site.x + Math.cos(a) * site.radius, site.y + 0.4, site.z + Math.sin(a) * site.radius, {
          size: 1, grow: 3, life: 2.2, r: 0.62, g: 0.56, b: 0.47, a: 0.45, vy: 0.9, drag: 1,
        });
      }
    }

    fx.update(now, delta, camera, visible);
  });
  return (
    <group ref={root}>
      {remnants.map((r) => (
        <Quiet key={`${r.id}:${r.at}`}>
          <Suspense fallback={null}>
            <RemnantModel remnant={r} />
          </Suspense>
        </Quiet>
      ))}
    </group>
  );
}
