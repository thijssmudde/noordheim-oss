import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { parseGlb } from '../lib/gltf';
import { makeEntity, newBattle, tickBattle } from '../lib/tactics';
import { terrainFor } from '../lib/tactical-terrain';
import { openGround } from './helpers/open-ground';
import { UnitMotion } from '../lib/tactical-motion';
import { productionExit } from '../lib/tactical-placement';

async function harvesterModel() {
  const bytes = readFileSync(
    new URL('../public/models/tactical/harvester.glb', import.meta.url),
  );
  return (
    await parseGlb(bytes)
  ).scene;
}

describe('Malm visuals', () => {
  test('the empty hopper has an open cavity, with no lid or ribs across the load', async () => {
    const model = await harvesterModel();
    const cargo = model.getObjectByName('cargo_fill')!;
    expect(cargo).toBeDefined();
    cargo.removeFromParent();
    model.updateMatrixWorld(true);
    // The diorama Malm's bin: a recessed floor 1.63 m up, 2.5 m wide, 3.9 m long.
    for (const x of [-0.8, 0, 0.8])
      for (const z of [-2.6, -1.4, -0.2]) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(x, 6, z),
          new THREE.Vector3(0, -1, 0),
        );
        const hit = ray.intersectObject(model, true)[0];
        expect(hit.point.y).toBeGreaterThan(1.55);
        expect(hit.point.y).toBeLessThan(1.7);
      }
  });

  test('ironstone stays anchored inside the bin at every fill level', async () => {
    const model = await harvesterModel();
    const cargo = model.getObjectByName('cargo_fill') as THREE.Mesh;
    const material = cargo.material as THREE.MeshStandardMaterial;
    expect(material.emissive.getHex()).toBe(0);
    expect(material.roughness).toBeGreaterThan(0.8);
    expect(cargo.geometry.attributes.color).toBeDefined();
    for (const fill of [0.02, 0.25, 0.5, 1]) {
      cargo.scale.y = fill;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(cargo, true);
      expect(box.min.y).toBeCloseTo(1.633, 2);
      expect(box.min.x).toBeGreaterThan(-1.3);
      expect(box.max.x).toBeLessThan(1.3);
      expect(box.min.z).toBeGreaterThan(-3.3);
      expect(box.max.z).toBeLessThan(0.7);
      expect(box.max.y).toBeLessThan(3.2);
    }
  });
});

describe('Harvester arrival', () => {
  function operation(cargo: number) {
    const b = newBattle(1000);
    b.entities = b.entities.filter((e) => e.team === 'red' && e.kind === 'hq');
    b.commanders = [];
    // A firm, open yard on whichever map the operation uses.
    const o = openGround(terrainFor(b), 70, b.entities);
    b.deposits = [
      {
        id: 'ore',
        name: 'Ore',
        x: o.x,
        z: o.z,
        capacity: 10000,
        amount: 10000,
      },
    ];
    const refinery = makeEntity(b, 'refinery', 'alice', 'blue', {
      x: o.x - 20,
      z: o.z,
    });
    const e = makeEntity(b, 'harvester', 'alice', 'blue', {
      x: o.x - 5,
      z: o.z,
    });
    e.cargo = cargo;
    e.target = 'ore';
    e.path = [{ x: o.x - 3, z: o.z }];
    b.entities.push(refinery, e);
    return { b, e, refinery, o };
  }

  test('pickup completes the approved approach without a visible backwards correction', () => {
    const { b, e, o } = operation(0);
    // Lined up with the seam: a tracked hull would otherwise pivot first.
    e.angle = Math.PI / 2;
    let snapshot = structuredClone(e);
    const motion = new UnitMotion(snapshot, b.tickAt, 0);
    let previous = e.x;
    // Two metres from a standstill: accelerate, then brake onto the bay.
    for (let frame = 1; frame <= 150; frame++) {
      if (frame % 15 === 0) {
        tickBattle(b, 1000 + (frame / 60) * 1000);
        snapshot = structuredClone(e);
      }
      const rendered = motion.sample(snapshot, b.tickAt, frame / 60, true);
      expect(rendered.x).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = rendered.x;
    }
    expect(e.x).toBe(o.x - 3);
    expect(e.cargo).toBeGreaterThan(0);
  });

  test('faster harvesters keep the rendered speed aligned between authoritative ticks', () => {
    const { e, o } = operation(0);
    e.path = [{ x: o.x + 30, z: o.z }];
    // Already cruising toward the seam.
    e.angle = Math.PI / 2;
    e.v = 6.5 * 1.1;
    let snapshot = structuredClone(e),
      tick = 1000;
    const motion = new UnitMotion(snapshot, tick, 0, 1.1);
    for (let frame = 1; frame <= 60; frame++) {
      const seconds = frame / 60;
      if (frame % 15 === 0) {
        tick = 1000 + seconds * 1000;
        snapshot = { ...e, x: e.x + 6.5 * 1.1 * seconds };
      }
      expect(motion.sample(snapshot, tick, seconds, true).x).toBeCloseTo(
        e.x + 6.5 * 1.1 * seconds,
        6,
      );
    }
  });

  test('unloading waits for the approved dock position instead of stopping mid-route', () => {
    const { b, e, refinery } = operation(500);
    const dock = productionExit(refinery);
    e.x = dock.x + 4;
    e.z = dock.z;
    e.angle = -Math.PI / 2;
    e.path = [dock];
    // Four metres from a standstill take the heavy truck about two seconds.
    let now = 1000;
    while (e.path.length && now < 4000) {
      now += 250;
      tickBattle(b, now);
      expect(e.cargo).toBe(500);
    }
    expect(now).toBeLessThanOrEqual(3000);
    expect(e.x).toBeCloseTo(dock.x);
    expect(e.z).toBeCloseTo(dock.z);
    tickBattle(b, now + 250);
    expect(e.cargo).toBe(0);
  });

  test('repeated mining cycles keep each parked harvester in a separate spot', () => {
    const { b, e, o } = operation(0);
    const fleet = [e];
    for (let i = 1; i < 3; i++) {
      const truck = makeEntity(b, 'harvester', 'alice', 'blue', {
        x: o.x - 5 - i * 7,
        z: o.z,
      });
      b.entities.push(truck);
      fleet.push(truck);
    }
    let simultaneous = false;
    for (let now = 1250; now <= 91000; now += 250) {
      tickBattle(b, now);
      const parked = fleet.filter(
        (truck) =>
          !truck.path.length &&
          (truck.cargo ?? 0) > 0 &&
          Math.hypot(truck.x - o.x, truck.z - o.z) < 4.6,
      );
      if (parked.length >= 2) simultaneous = true;
      for (let i = 0; i < parked.length; i++)
        for (let j = i + 1; j < parked.length; j++)
          expect(
            Math.hypot(parked[i].x - parked[j].x, parked[i].z - parked[j].z),
          ).toBeGreaterThanOrEqual(3.3 - 1e-6);
    }
    expect(simultaneous).toBe(true);
    expect(b.deposits![0].amount).toBeLessThan(6000);
  });

  test('a full fleet queues for separate refinery bays and every truck unloads', () => {
    const { b, refinery } = operation(500);
    const dock = productionExit(refinery);
    b.entities = b.entities.filter(
      (e) => e.team === 'red' || e.id === refinery.id,
    );
    b.deposits = [];
    const fleet = Array.from({ length: 8 }, (_, i) => {
      const truck = makeEntity(b, 'harvester', 'alice', 'blue', {
        x: dock.x + 14 + i * 5.5,
        z: dock.z + 17,
      });
      truck.cargo = 500;
      b.entities.push(truck);
      return truck;
    });
    tickBattle(b, 1250);
    const goals = fleet.map((truck) => truck.path.at(-1)!);
    expect(goals.every(Boolean)).toBe(true);
    for (let i = 0; i < goals.length; i++)
      for (let j = i + 1; j < goals.length; j++)
        expect(
          Math.hypot(goals[i].x - goals[j].x, goals[i].z - goals[j].z),
        ).toBeGreaterThan(3.3);
    expect(goals.filter((p) => Math.abs(p.z - dock.z) < 0.01)).toHaveLength(3);
    for (let now = 1500; now <= 31000; now += 250) tickBattle(b, now);
    expect(fleet.every((truck) => truck.cargo === 0)).toBe(true);
  });
});
