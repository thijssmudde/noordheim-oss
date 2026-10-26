'use client';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { SUPERWEAPONS, isUnit, type Battle, type Point } from '@/lib/tactics';
import {
  targetError,
  weaponName,
  type Strike,
  type SuperweaponKind,
} from '@/lib/tactical-superweapons';
import { useTerrain } from './terrain-context';

/**
 * Superweapon presentation: the aiming cursor, the red telegraph ring every
 * commander sees before a strike lands, and procedural impacts (flash,
 * fireball, shockwave, fire, snow, boats, supply drops) built from a handful
 * of meshes each and animated by time since impact. Frozen troops wear ice.
 */
type Height = (x: number, z: number) => number;
type Part = (t: number) => void;
type Effect = { group: THREE.Group; parts: Part[]; dispose: () => void };

const noRaycast = () => {};
/** Seconds since impact for every strike, pinned in development by `?strikeT=`. */
function pinnedStrikeTime() {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined')
    return null;
  const raw = new URLSearchParams(window.location.search).get('strikeT');
  return raw === null || !Number.isFinite(Number(raw)) ? null : Number(raw);
}
/** The server's clock between snapshots: the last tick plus local time since it arrived. */
function useServerNow(battle: Pick<Battle, 'tickAt'>) {
  const clock = useRef({ tickAt: battle.tickAt, at: 0 });
  useEffect(() => {
    clock.current = { tickAt: battle.tickAt, at: performance.now() };
  }, [battle.tickAt]);
  return () =>
    clock.current.tickAt +
    (clock.current.at ? performance.now() - clock.current.at : 0);
}
function random(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let n = Math.imul(h ^ (h >>> 15), h | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
/** 0..1 through [a, b], or -1 outside it. */
const span = (t: number, a: number, b: number) =>
  t < a || t > b ? -1 : (t - a) / (b - a);

class Kit {
  readonly group = new THREE.Group();
  readonly parts: Part[] = [];
  private owned: { dispose(): void }[] = [];
  constructor(
    readonly x: number,
    readonly z: number,
    readonly heightAt: Height,
  ) {
    this.group.position.set(x, heightAt(x, z), z);
  }
  material(color: string, opacity: number, additive = true, onTop = false) {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: !onTop,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.owned.push(m);
    return m;
  }
  mesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.owned.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.raycast = noRaycast;
    m.frustumCulled = false;
    m.visible = false;
    this.group.add(m);
    return m;
  }
  /** A flat ring or disc laid over the ground, `lift` metres above it. */
  draped(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    lift = 0.35,
  ) {
    geometry.rotateX(-Math.PI / 2);
    const p = geometry.attributes.position,
      base = this.heightAt(this.x, this.z);
    for (let i = 0; i < p.count; i++)
      p.setY(
        i,
        this.heightAt(this.x + p.getX(i), this.z + p.getZ(i)) - base + lift,
      );
    p.needsUpdate = true;
    return this.mesh(geometry, material);
  }
  /** Lifts off the ground beneath a local point. */
  ground(x: number, z: number) {
    return (
      this.heightAt(this.x + x, this.z + z) - this.heightAt(this.x, this.z)
    );
  }
  own<T extends { dispose(): void }>(o: T) {
    this.owned.push(o);
    return o;
  }
  dispose() {
    for (const o of this.owned) o.dispose();
  }
}
const fade = (m: THREE.Mesh, opacity: number) => {
  m.visible = opacity > 0.003;
  (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, opacity);
};

/** The red ring, sweep, crosshair and beam on a strike's target until it lands. */
function telegraph(k: Kit, radius: number, color = '#ff3b2f') {
  const outer = k.draped(
    new THREE.RingGeometry(radius * 0.95, radius, 96),
    k.material(color, 0.8, true, true),
    0.5,
  );
  const inner = k.draped(
    new THREE.RingGeometry(radius * 0.46, radius * 0.48, 72),
    k.material(color, 0.5, true, true),
    0.5,
  );
  const sweep = k.mesh(
    new THREE.RingGeometry(0.92, 1, 72).rotateX(-Math.PI / 2),
    k.material(color, 0.6, true, true),
  );
  sweep.position.y = 0.8;
  const cross = [0, 1].map((i) => {
    const bar = k.mesh(
      new THREE.PlaneGeometry(radius * 2.1, 0.5).rotateX(-Math.PI / 2),
      k.material(color, 0.55, true, true),
    );
    bar.rotation.y = i * (Math.PI / 2);
    bar.position.y = 0.7;
    return bar;
  });
  const beam = k.mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 90, 12, 1, true),
    k.material(color, 0.3),
  );
  beam.position.y = 45;
  for (const m of [outer, inner, sweep, ...cross]) m.renderOrder = 20;
  k.parts.push((t) => {
    const on = t < 0 ? 1 : Math.max(0, 1 - t / 0.5);
    const pulse = 0.65 + 0.35 * Math.sin(t * 9);
    fade(outer, on * pulse);
    fade(inner, on * 0.55);
    for (const c of cross) fade(c, on * 0.45);
    fade(beam, on * (0.18 + 0.12 * pulse));
    const s = 1 - (((t % 1) + 1) % 1);
    sweep.scale.setScalar(Math.max(0.05, radius * s));
    fade(sweep, on * 0.8 * (1 - s * 0.5));
  });
}
function cannon(k: Kit, s: Strike) {
  const r = s.radius;
  const shell = k.mesh(
    new THREE.CylinderGeometry(0.6, 0.15, 9, 8),
    k.material('#ffe2a8', 1),
  );
  const flash = k.mesh(
    new THREE.SphereGeometry(1, 20, 12),
    k.material('#fff3d6', 1),
  );
  const fireball = k.mesh(
    new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    k.material('#ff7a22', 0.9),
  );
  const core = k.mesh(
    new THREE.SphereGeometry(1, 16, 10),
    k.material('#ffd36a', 0.9),
  );
  const shock = k.draped(
    new THREE.RingGeometry(0.86, 1, 96),
    k.material('#ffd2a0', 0.9),
    0.6,
  );
  const scorch = k.draped(
    new THREE.CircleGeometry(r * 0.8, 48),
    k.material('#120c08', 0.7, false),
    0.2,
  );
  const rand = random(s.id);
  const smoke = Array.from({ length: 9 }, (_, i) => {
    const m = k.mesh(
      new THREE.SphereGeometry(1, 12, 8),
      k.material(i % 2 ? '#2b2522' : '#3d3631', 0.75, false),
    );
    return {
      m,
      a: rand() * Math.PI * 2,
      d: rand() * r * 0.35,
      delay: rand() * 1.5,
      rise: 3 + rand() * 4,
    };
  });
  const debris = Array.from({ length: 14 }, () => {
    const m = k.mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      k.material('#ffb347', 1),
    );
    return {
      m,
      a: rand() * Math.PI * 2,
      v: 10 + rand() * 14,
      up: 14 + rand() * 12,
    };
  });
  k.parts.push((t) => {
    const fall = span(t, -0.9, 0);
    shell.visible = fall >= 0;
    if (fall >= 0) {
      shell.position.set(
        30 * (1 - fall),
        110 * (1 - fall) + 4,
        -40 * (1 - fall),
      );
      shell.rotation.set(-0.34, 0, -0.26);
    }
    const f = span(t, 0, 0.9);
    flash.scale.setScalar(f < 0 ? 1 : r * (0.2 + 0.5 * Math.sqrt(f)));
    fade(flash, f < 0 ? 0 : 1 - f);
    const b = span(t, 0, 4);
    fireball.scale.set(
      r * (0.3 + 0.35 * Math.sqrt(Math.max(0, b))),
      r * (0.35 + 0.5 * Math.max(0, b)),
      r * (0.3 + 0.35 * Math.sqrt(Math.max(0, b))),
    );
    fade(fireball, b < 0 ? 0 : 0.95 * (1 - b) ** 1.4);
    core.scale.setScalar(r * 0.22 * (1 - Math.max(0, b)) + 0.1);
    core.position.y = r * 0.25 * Math.max(0, b);
    fade(core, b < 0 ? 0 : 1 - b);
    const w = span(t, 0, 1.1);
    shock.scale.setScalar(w < 0 ? 1 : r * 1.7 * Math.sqrt(w));
    fade(shock, w < 0 ? 0 : 0.9 * (1 - w));
    fade(
      scorch,
      t < 0
        ? 0
        : 0.75 *
            Math.min(1, t * 4) *
            Math.min(1, (s.until - s.impactAt) / 1000 - t),
    );
    for (const p of smoke) {
      const u = span(t, 0.3 + p.delay, 8 + p.delay);
      fade(p.m, u < 0 ? 0 : 0.8 * Math.min(1, u * 6) * (1 - u));
      if (u < 0) continue;
      p.m.position.set(
        Math.cos(p.a) * p.d,
        2 + u * r * 0.9 + p.rise * u,
        Math.sin(p.a) * p.d,
      );
      p.m.scale.setScalar(2.5 + u * 9);
    }
    for (const p of debris) {
      const u = t;
      p.m.visible = u > 0 && u < 2;
      if (!p.m.visible) continue;
      p.m.position.set(
        Math.cos(p.a) * p.v * u,
        Math.max(0, p.up * u - 14 * u * u),
        Math.sin(p.a) * p.v * u,
      );
      p.m.rotation.set(u * 7, u * 5, 0);
    }
  });
}
function firestorm(k: Kit, s: Strike) {
  const rules = SUPERWEAPONS.launcher,
    r = s.radius,
    rand = random(s.id);
  const spots = Array.from({ length: 18 }, () => {
    const a = rand() * Math.PI * 2,
      d = Math.sqrt(rand()) * r * 0.9;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, at: -1.6 + rand() * 1.4 };
  });
  const rockets = spots.map((p) => ({
    p,
    m: k.mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 7, 6),
      k.material('#ffb15a', 1),
    ),
  }));
  const bursts = spots.map((p) => ({
    p,
    m: k.mesh(new THREE.SphereGeometry(1, 12, 8), k.material('#ff8a2a', 1)),
  }));
  const embers = k.draped(
    new THREE.CircleGeometry(r, 64),
    k.material('#ff5a14', 0.35),
    0.3,
  );
  const reveal = k.draped(
    new THREE.RingGeometry(rules.revealRadius - 0.6, rules.revealRadius, 120),
    k.material('#ffb347', 0.5, true, true),
    0.6,
  );
  // A field of flickering flame tongues, instanced.
  const tongues = 70;
  const flameGeometry = k.own(
    new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
  );
  const flames = new THREE.InstancedMesh(
    flameGeometry,
    k.material('#ff7b1c', 0.85),
    tongues,
  );
  flames.raycast = noRaycast;
  flames.frustumCulled = false;
  k.group.add(flames);
  const glows = new THREE.InstancedMesh(
    flameGeometry,
    k.material('#ffd36a', 0.7),
    tongues,
  );
  glows.raycast = noRaycast;
  glows.frustumCulled = false;
  k.group.add(glows);
  const field = Array.from({ length: tongues }, () => {
    const a = rand() * Math.PI * 2,
      d = Math.sqrt(rand()) * r;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    return {
      x,
      z,
      y: k.ground(x, z),
      size: 0.9 + rand() * 1.6,
      phase: rand() * 10,
    };
  });
  const smoke = Array.from({ length: 8 }, () => {
    const m = k.mesh(
      new THREE.SphereGeometry(1, 10, 8),
      k.material('#2c2622', 0.6, false),
    );
    return {
      m,
      x: (rand() - 0.5) * r,
      z: (rand() - 0.5) * r,
      phase: rand() * 6,
    };
  });
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    v = new THREE.Vector3(),
    sc = new THREE.Vector3();
  k.parts.push((t) => {
    for (const { p, m } of rockets) {
      const u = span(t, p.at - 0.9, p.at);
      m.visible = u >= 0;
      if (u < 0) continue;
      m.position.set(
        p.x - 20 * (1 - u),
        k.ground(p.x, p.z) + 70 * (1 - u) + 3,
        p.z + 30 * (1 - u),
      );
      m.rotation.set(0.4, 0, 0.27);
    }
    for (const { p, m } of bursts) {
      const u = span(t, p.at, p.at + 0.7);
      m.position.set(p.x, k.ground(p.x, p.z) + 1, p.z);
      m.scale.setScalar(u < 0 ? 1 : 2 + 5 * u);
      fade(m, u < 0 ? 0 : 1 - u);
    }
    const burn = span(t, 0, rules.burnSeconds);
    const heat =
      burn < 0 ? 0 : Math.min(1, t * 2) * (burn > 0.85 ? (1 - burn) / 0.15 : 1);
    fade(embers, 0.35 * heat * (0.8 + 0.2 * Math.sin(t * 5)));
    for (let i = 0; i < tongues; i++) {
      const f = field[i];
      const flicker =
        0.7 +
        0.3 * Math.sin(t * 11 + f.phase) * Math.sin(t * 7.3 + f.phase * 2);
      const h = f.size * 3.2 * flicker * heat;
      v.set(f.x, f.y, f.z);
      sc.set(f.size * heat + 0.001, h + 0.001, f.size * heat + 0.001);
      flames.setMatrixAt(i, matrix.compose(v, q, sc));
      sc.set(
        f.size * 0.5 * heat + 0.001,
        h * 0.7 + 0.001,
        f.size * 0.5 * heat + 0.001,
      );
      glows.setMatrixAt(i, matrix.compose(v, q, sc));
    }
    flames.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    flames.visible = glows.visible = heat > 0;
    for (const p of smoke) {
      const u = ((t + p.phase) % 6) / 6;
      p.m.position.set(p.x, k.ground(p.x, p.z) + 3 + u * 22, p.z);
      p.m.scale.setScalar(2 + u * 6);
      fade(p.m, heat * 0.55 * Math.sin(u * Math.PI));
    }
    const lit = span(t, 0, rules.revealSeconds);
    fade(reveal, lit < 0 ? 0 : 0.5 * (lit > 0.9 ? (1 - lit) / 0.1 : 1));
  });
}
function convoy(k: Kit, s: Strike) {
  const r = s.radius,
    rand = random(s.id);
  const planes = [-14, 0, 14].map((offset, i) => {
    const g = new THREE.Group();
    const m = k.material('#6f7a4c', 0.95, false);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 10), m);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.35, 2.4), m);
    wing.position.y = 1;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 2), m);
    tail.position.z = 6;
    g.add(body, wing, tail);
    g.rotation.y = Math.PI / 2;
    g.traverse((o) => (o.raycast = noRaycast));
    k.group.add(g);
    return { g, offset, delay: i * 0.35 };
  });
  const crates = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + rand(),
      d = 4 + rand() * r * 0.45;
    const crate = k.mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      k.material('#8a6a3f', 1, false),
    );
    const chute = k.mesh(
      new THREE.SphereGeometry(1.7, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      k.material(i % 2 ? '#e9dfc6' : '#7ec2a0', 0.95, false),
    );
    return {
      crate,
      chute,
      x: Math.cos(a) * d,
      z: Math.sin(a) * d,
      delay: rand() * 0.8,
    };
  });
  const wave = k.draped(
    new THREE.RingGeometry(0.9, 1, 96),
    k.material('#9fffc8', 0.9),
    0.6,
  );
  const glow = k.draped(
    new THREE.RingGeometry(r * 0.9, r, 96),
    k.material('#ffd36a', 0.45),
    0.5,
  );
  const sparkleGeometry = new THREE.BufferGeometry();
  const count = 260,
    seeds = new Float32Array(count * 3),
    positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2,
      d = Math.sqrt(rand()) * r;
    seeds.set([Math.cos(a) * d, Math.sin(a) * d, rand()], i * 3);
  }
  sparkleGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );
  const sparkleMaterial = new THREE.PointsMaterial({
    color: '#c8ffb0',
    size: 0.9,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sparkles = new THREE.Points(sparkleGeometry, sparkleMaterial);
  sparkles.raycast = noRaycast;
  sparkles.frustumCulled = false;
  k.group.add(sparkles);
  const boost = SUPERWEAPONS.airstrip.boostSeconds;
  k.parts.push((t) => {
    for (const p of planes) {
      const u = span(t, -3 + p.delay, 3.5 + p.delay);
      p.g.visible = u >= 0;
      if (u >= 0)
        p.g.position.set(-120 + u * 240, 20 + Math.sin(u * 3) * 1.5, p.offset);
    }
    for (const c of crates) {
      const u = span(t, c.delay, c.delay + 3.2);
      const y = k.ground(c.x, c.z);
      const landed = t > c.delay + 3.2;
      c.crate.position.set(
        c.x,
        y + 0.8 + (u < 0 ? (landed ? 0 : 16) : 16 * (1 - u)),
        c.z,
      );
      fade(c.crate, t < c.delay ? 0 : landed ? Math.min(1, boost - t) : 1);
      c.chute.position.set(c.x, c.crate.position.y + 2.4, c.z);
      fade(c.chute, u < 0 ? 0 : u > 0.9 ? (1 - u) * 9.5 : 0.95);
    }
    const w = span(t, 0, 1.4);
    wave.scale.setScalar(w < 0 ? 1 : r * Math.sqrt(w));
    fade(wave, w < 0 ? 0 : 0.9 * (1 - w * 0.6));
    const held = span(t, 0, boost);
    fade(
      glow,
      held < 0
        ? 0
        : (0.25 + 0.15 * Math.sin(t * 3)) * (held > 0.9 ? (1 - held) / 0.1 : 1),
    );
    const rise = span(t, 0, 4);
    sparkles.visible = rise >= 0;
    if (rise >= 0) {
      for (let i = 0; i < count; i++) {
        const x = seeds[i * 3],
          z = seeds[i * 3 + 1],
          lift = ((seeds[i * 3 + 2] + t * 0.6) % 1) * 9;
        positions.set([x, k.ground(x, z) + 0.5 + lift, z], i * 3);
      }
      sparkleGeometry.attributes.position.needsUpdate = true;
      sparkleMaterial.opacity = 1 - rise;
    }
  });
  return () => {
    sparkleGeometry.dispose();
    sparkleMaterial.dispose();
    for (const p of planes)
      p.g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
  };
}
function skerry(k: Kit, s: Strike) {
  const rand = random(s.id);
  // The boats run in from the open side, toward the target.
  const heading = rand() * Math.PI * 2;
  const boats = [-7, 0, 7].map((offset, i) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 9),
      k.material('#2e2a26', 1, false),
    );
    hull.position.y = 0.6;
    const prow = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 3, 4).rotateX(Math.PI / 2),
      k.material('#2e2a26', 1, false),
    );
    prow.position.set(0, 0.6, -6);
    const strake = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.3, 8),
      k.material('#3f86b8', 1, false),
    );
    strake.position.y = 1.15;
    const mast = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 4, 0.2),
      k.material('#4f3b29', 1, false),
    );
    mast.position.y = 3;
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 2.8),
      k.material('#e9dfc6', 1, false),
    );
    sail.position.y = 3.4;
    // A white wake streams behind the hull while it runs in.
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 26).rotateX(-Math.PI / 2),
      k.material('#ffffff', 0.55),
    );
    wake.position.set(0, 0.2, 17);
    g.add(hull, prow, strake, mast, sail, wake);
    g.traverse((o) => (o.raycast = noRaycast));
    k.group.add(g);
    const side = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    const along = new THREE.Vector3(-side.z, 0, side.x);
    return { g, wake, offset, side, along, delay: i * 0.25 };
  });
  const spray = Array.from({ length: 12 }, () => ({
    m: k.mesh(
      new THREE.SphereGeometry(1, 10, 8),
      k.material('#eaf6ff', 0.9, false),
    ),
    a: rand() * Math.PI * 2,
    d: 2 + rand() * 9,
  }));
  const flares = [0, 1, 2].map((i) => {
    const m = k.mesh(
      new THREE.CylinderGeometry(0.8, 2.6, 16, 10, 1, true),
      k.material('#5fb6ff', 0.4),
    );
    const a = (i / 3) * Math.PI * 2 + heading;
    return { m, x: Math.cos(a) * 6, z: Math.sin(a) * 6 };
  });
  const life = (s.until - s.impactAt) / 1000;
  k.parts.push((t) => {
    for (const b of boats) {
      const u = span(t, -3 + b.delay, b.delay);
      b.g.visible = t >= -3 + b.delay && t < life;
      if (!b.g.visible) continue;
      const run = u < 0 ? 0 : (1 - u) ** 2 * 50;
      const p = b.side
        .clone()
        .multiplyScalar(run + 4)
        .add(b.along.clone().multiplyScalar(b.offset));
      b.g.position.set(
        p.x,
        k.ground(p.x, p.z) + Math.sin(t * 6 + b.offset) * 0.15,
        p.z,
      );
      b.g.rotation.y = Math.atan2(b.side.x, b.side.z);
      b.g.scale.setScalar(1.5 * (t > life - 1 ? Math.max(0.001, life - t) : 1));
      fade(b.wake, u < 0 ? Math.max(0, 0.55 - t) : 0.55);
    }
    for (const p of spray) {
      const u = span(t, 0, 1.2);
      p.m.position.set(
        Math.cos(p.a) * p.d,
        k.ground(Math.cos(p.a) * p.d, Math.sin(p.a) * p.d) +
          1 +
          (u < 0 ? 0 : 6 * u - 5 * u * u),
        Math.sin(p.a) * p.d,
      );
      p.m.scale.setScalar(u < 0 ? 1 : 1 + 2 * u);
      fade(p.m, u < 0 ? 0 : 0.9 * (1 - u));
    }
    for (const f of flares) {
      const u = span(t, 0.2, life);
      f.m.position.set(f.x, k.ground(f.x, f.z) + 8, f.z);
      fade(f.m, u < 0 ? 0 : 0.35 * Math.min(1, u * 8) * (1 - u));
    }
  });
}
function blizzard(k: Kit, s: Strike) {
  const r = s.radius,
    rand = random(s.id),
    freeze = SUPERWEAPONS.weathermast.freezeSeconds;
  const cloud = k.mesh(
    new THREE.RingGeometry(r * 0.5, r * 1.25, 48).rotateX(Math.PI / 2),
    k.material('#6c7c8f', 0.4, false),
  );
  cloud.position.y = 30;
  const ice = k.draped(
    new THREE.CircleGeometry(r, 64),
    k.material('#cfeaff', 0.5, false),
    0.3,
  );
  const frost = k.draped(
    new THREE.RingGeometry(0.9, 1, 96),
    k.material('#e8f7ff', 0.9),
    0.6,
  );
  const shardGeometry = new THREE.ConeGeometry(0.6, 1, 5).translate(0, 0.5, 0);
  const shards = new THREE.InstancedMesh(
    shardGeometry,
    k.material('#bfe6ff', 0.85, false),
    36,
  );
  shards.raycast = noRaycast;
  shards.frustumCulled = false;
  k.group.add(shards);
  const field = Array.from({ length: 36 }, () => {
    const a = rand() * Math.PI * 2,
      d = Math.sqrt(rand()) * r;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    return {
      x,
      z,
      y: k.ground(x, z),
      h: 1.5 + rand() * 3,
      tilt: (rand() - 0.5) * 0.6,
    };
  });
  const count = 900,
    seeds = new Float32Array(count * 4),
    positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++)
    seeds.set(
      [
        rand() * Math.PI * 2,
        Math.sqrt(rand()) * r * 1.1,
        rand(),
        0.6 + rand() * 0.8,
      ],
      i * 4,
    );
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );
  const snowMaterial = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.55,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.raycast = noRaycast;
  snow.frustumCulled = false;
  k.group.add(snow);
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    sc = new THREE.Vector3();
  k.parts.push((t) => {
    const gather = span(t, -4, 0);
    const storm = span(t, 0, freeze);
    fade(
      cloud,
      gather >= 0
        ? 0.35 * gather
        : storm >= 0
          ? 0.35 * (storm > 0.8 ? (1 - storm) / 0.2 : 1)
          : 0,
    );
    cloud.rotation.y = t * 0.3;
    const hold =
      storm >= 0 ? (storm > 0.85 ? (1 - storm) / 0.15 : Math.min(1, t * 3)) : 0;
    fade(ice, 0.5 * hold);
    const w = span(t, 0, 0.9);
    frost.scale.setScalar(w < 0 ? 1 : r * 1.2 * Math.sqrt(w));
    fade(frost, w < 0 ? 0 : 1 - w);
    shards.visible = hold > 0;
    for (let i = 0; i < field.length; i++) {
      const f = field[i];
      v.set(f.x, f.y, f.z);
      sc.set(hold, f.h * hold + 0.001, hold);
      q.setFromEuler(e.set(f.tilt, i, -f.tilt));
      shards.setMatrixAt(i, matrix.compose(v, q, sc));
    }
    shards.instanceMatrix.needsUpdate = true;
    const falling = span(t, -1.5, freeze + 0.5);
    snow.visible = falling >= 0;
    if (falling >= 0) {
      for (let i = 0; i < count; i++) {
        const a = seeds[i * 4] + t * seeds[i * 4 + 3] * 1.4,
          d = seeds[i * 4 + 1],
          y = (1 - ((seeds[i * 4 + 2] + t * 0.45 * seeds[i * 4 + 3]) % 1)) * 28;
        positions.set([Math.cos(a) * d, y, Math.sin(a) * d], i * 3);
      }
      snowGeometry.attributes.position.needsUpdate = true;
      snowMaterial.opacity =
        Math.min(1, (t + 1.5) * 1.5) *
        (falling > 0.9 ? (1 - falling) / 0.1 : 1);
    }
  });
  return () => {
    snowGeometry.dispose();
    snowMaterial.dispose();
    shardGeometry.dispose();
  };
}
const BUILD: Record<
  SuperweaponKind,
  (k: Kit, s: Strike) => void | (() => void)
> = {
  cannon,
  launcher: firestorm,
  airstrip: convoy,
  boathouse: skerry,
  weathermast: blizzard,
};
function StrikeEffect({
  strike,
  at,
}: {
  strike: Strike;
  at: (s: Strike) => number;
}) {
  const { heightAt } = useTerrain();
  const label = useRef<HTMLSpanElement>(null);
  const effect = useMemo<Effect>(() => {
    const k = new Kit(strike.x, strike.z, heightAt);
    telegraph(k, strike.radius, strike.team === 'red' ? '#7fd4ff' : '#ff3b2f');
    const extra = BUILD[strike.kind](k, strike);
    return {
      group: k.group,
      parts: k.parts,
      dispose: () => {
        k.dispose();
        extra?.();
      },
    };
  }, [strike, heightAt]);
  useEffect(() => () => effect.dispose(), [effect]);
  useFrame(() => {
    const t = at(strike);
    for (const part of effect.parts) part(t);
    if (label.current) {
      label.current.textContent =
        t < 0
          ? `${weaponName(strike.kind).toUpperCase()} · ${Math.ceil(-t)}`
          : '';
      label.current.style.display = t < 0 ? '' : 'none';
    }
  });
  return (
    <>
      <primitive object={effect.group} dispose={null} />
      <Html
        position={[strike.x, heightAt(strike.x, strike.z) + 6, strike.z]}
        center
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <span ref={label} className={`tac-strike-label is-${strike.team}`} />
      </Html>
    </>
  );
}
/** Every strike in flight or lingering, for every commander, plus ice on frozen troops. */
export function StrikeEffects({ battle }: { battle: Battle }) {
  const serverNow = useServerNow(battle);
  const [pinned] = useState(pinnedStrikeTime);
  const at = (s: Strike) => pinned ?? (serverNow() - s.impactAt) / 1000;
  return (
    <>
      {(battle.strikes ?? []).map((s) => (
        <StrikeEffect key={s.id} strike={s} at={at} />
      ))}
      <FrozenTroops battle={battle} now={serverNow} />
    </>
  );
}
const ICE_LIMIT = 160;
function FrozenTroops({ battle, now }: { battle: Battle; now: () => number }) {
  const { heightAt } = useTerrain();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const live = useRef(battle);
  useEffect(() => {
    live.current = battle;
  }, [battle]);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    const t = now();
    for (const e of live.current.entities) {
      if (n >= ICE_LIMIT) break;
      if (!isUnit(e.kind) || !e.frozenUntil || e.frozenUntil <= t) continue;
      matrix.makeTranslation(e.x, heightAt(e.x, e.z) + 1.2, e.z);
      m.setMatrixAt(n++, matrix);
    }
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, ICE_LIMIT]}
      frustumCulled={false}
      raycast={noRaycast}
      visible={false}
    >
      <octahedronGeometry args={[2.2, 0]} />
      <meshStandardMaterial
        color="#cfefff"
        transparent
        opacity={0.55}
        roughness={0.15}
        metalness={0.1}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
/** The target cursor while a commander aims: green on a valid target, red where it cannot strike. */
export function AimCursor({
  battle,
  owner,
  aim,
  cursor,
}: {
  battle: Battle;
  owner: string;
  aim: { kind: SuperweaponKind; radius: number };
  cursor: RefObject<Point | null>;
}) {
  const { heightAt } = useTerrain();
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const crosses = useRef<THREE.Group>(null);
  const live = useRef(battle);
  useEffect(() => {
    live.current = battle;
  }, [battle]);
  const checked = useRef({ at: 0, x: NaN, z: NaN, ok: true });
  useFrame(({ clock }) => {
    const g = group.current,
      p = cursor.current;
    if (!g) return;
    g.visible = !!p;
    if (!p) return;
    g.position.set(p.x, heightAt(p.x, p.z) + 0.6, p.z);
    g.rotation.y = clock.elapsedTime * 0.6;
    const c = checked.current;
    if ((c.x !== p.x || c.z !== p.z) && clock.elapsedTime - c.at > 0.12) {
      c.at = clock.elapsedTime;
      c.x = p.x;
      c.z = p.z;
      c.ok = !targetError(live.current, owner, aim.kind, p);
    }
    const color = c.ok ? '#ffb347' : '#ff4a3d';
    const material = ring.current?.material as
      | THREE.MeshBasicMaterial
      | undefined;
    material?.color.set(color);
    if (material)
      material.opacity = 0.7 + 0.25 * Math.sin(clock.elapsedTime * 6);
    crosses.current?.children.forEach((bar) =>
      ((bar as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(
        color,
      ),
    );
  });
  return (
    <group ref={group} visible={false}>
      <mesh
        ref={ring}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={21}
        raycast={noRaycast}
      >
        <ringGeometry args={[aim.radius - 0.7, aim.radius, 96]} />
        <meshBasicMaterial
          color="#ffb347"
          transparent
          opacity={0.85}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={crosses}>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]}
            position={[
              Math.cos((i * Math.PI) / 2) * aim.radius * 0.55,
              0,
              -Math.sin((i * Math.PI) / 2) * aim.radius * 0.55,
            ]}
            renderOrder={21}
            raycast={noRaycast}
          >
            <planeGeometry args={[aim.radius * 0.5, 0.45]} />
            <meshBasicMaterial
              color="#ffb347"
              transparent
              opacity={0.85}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={21}
        raycast={noRaycast}
      >
        <ringGeometry args={[0.8, 1.3, 24]} />
        <meshBasicMaterial
          color="#fff3d6"
          transparent
          opacity={0.9}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
