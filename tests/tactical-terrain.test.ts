import { describe, expect, test } from 'vitest';
import {
  defaultTerrain,
  terrainFor,
  TERRAIN_SPEED,
} from '../lib/tactical-terrain';
import { MAPS, mapFor, mapIds, TERRAIN_CODES } from '../lib/maps';
import {
  findPath,
  joinBattle,
  newBattle,
  tickBattle,
  isUnit,
  makeEntity,
  TACTICAL_UNITS,
} from '../lib/tactics';
import { withRoutingBudget } from '../lib/tactical-navigation';

const map = defaultTerrain;
const design = MAPS.fjordmouth;
const { terrainAt, groundAt, heightAt, buildableAt, terrainSpeed } = map;
const kaldelva = design.crossings.find((c) => c.id === 'kaldelva')!;
const ford = design.crossings.find((c) => c.style === 'ford')!;
const kvitasen = design.plateaus.find((p) => p.name === 'Kvitåsen')!;
const southRamp = kvitasen.ramps[0];
const marsh = design.marshes[0];
const centre = (poly: { x: number; z: number }[]) => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  z: poly.reduce((s, p) => s + p.z, 0) / poly.length,
});

/** Stored routes keep turning points only, so classify every half metre between them. */
const walked = (path: { x: number; z: number }[], from: { x: number; z: number }) => {
  const seen = new Set<string>();
  const points = [from, ...path];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2));
    for (let s = 0; s <= steps; s++)
      seen.add(
        terrainAt(a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps),
      );
  }
  return seen;
};

describe('Compiled battlefield terrain', () => {
  test('water is impassable, crossings, ramps and roads are ground, cliffs are walls', () => {
    expect(terrainAt(40, 2)).toBe('river');
    expect(groundAt(40, 2)).toBe(false);
    for (const c of design.crossings)
      expect(terrainAt(c.x, c.z)).toBe(c.style === 'ford' ? 'ford' : 'bridge');
    expect(terrainAt(-140, -10)).toBe('sea');
    expect(terrainAt(-128, -82)).toBe('lake');
    expect(terrainAt(5, -62)).toBe('plateau');
    expect(terrainAt(southRamp.from.x, (southRamp.from.z + southRamp.to.z) / 2)).toBe('ramp');
    expect(terrainAt(-12, -43)).toBe('cliff');
    expect(groundAt(-12, -43)).toBe(false);
    expect(terrainAt(centre(marsh).x, centre(marsh).z)).toBe('marsh');
    expect(terrainAt(0, 90)).toBe('road');
    expect(terrainAt(-500, 0)).toBe('void');
  });

  test('speeds: roads are quick, ramps, marsh and fords slow, water and cliffs stop', () => {
    expect(TERRAIN_SPEED.road).toBeGreaterThan(1);
    expect(terrainSpeed(0, 90)).toBe(TERRAIN_SPEED.road);
    expect(terrainSpeed(ford.x, ford.z)).toBe(0.45);
    expect(terrainSpeed(centre(marsh).x, centre(marsh).z)).toBe(0.55);
    expect(TERRAIN_SPEED.ramp).toBe(0.8);
    for (const t of ['river', 'lake', 'sea', 'cliff', 'void'] as const)
      expect(TERRAIN_SPEED[t]).toBe(0);
  });

  test('heights: the plateau stands proud, water beds lie below the surface, decks above it', () => {
    expect(heightAt(5, -62)).toBeGreaterThan(heightAt(5, -20) + 3);
    expect(heightAt(40, 2)).toBeLessThan(-0.3);
    expect(heightAt(-128, -82)).toBeLessThan(-1);
    expect(heightAt(kaldelva.x, kaldelva.z)).toBeGreaterThanOrEqual(0.6);
    // A ramp climbs steadily from the lowland to the plateau.
    const climb = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      heightAt(
        southRamp.from.x + (southRamp.to.x - southRamp.from.x) * t,
        southRamp.from.z + (southRamp.to.z - southRamp.from.z) * t,
      ),
    );
    for (let i = 1; i < climb.length; i++) expect(climb[i]).toBeGreaterThan(climb[i - 1]);
    // Heights interpolate smoothly between lattice points.
    expect(heightAt(10.5, 60.5)).toBeCloseTo(
      (heightAt(10, 60) + heightAt(11, 60) + heightAt(10, 61) + heightAt(11, 61)) / 4,
      5,
    );
  });

  test('foundations need land or plateau: roads, banks, marsh, ramps and fords refuse them', () => {
    expect(buildableAt(0, 90)).toBe(false);
    expect(buildableAt(centre(marsh).x, centre(marsh).z)).toBe(false);
    expect(buildableAt(ford.x, ford.z)).toBe(false);
    expect(buildableAt(southRamp.from.x, -45)).toBe(false);
    expect(terrainAt(40, 13.5)).toBe('bank');
    expect(buildableAt(40, 13.5)).toBe(false);
    expect(buildableAt(5, -62)).toBe(true);
    expect(buildableAt(-62, 88)).toBe(true);
  });

  test.each(mapIds)('%s has no walkable step: water meets high ground in a sheer wall', (id) => {
    const g = mapFor(id).grid();
    const walk = TERRAIN_CODES.map((t) => TERRAIN_SPEED[t] > 0);
    let worst = 0;
    for (let z = 0; z < g.depth; z++)
      for (let x = 0; x < g.width; x++) {
        const i = z * g.width + x;
        if (!walk[g.terrain[i]]) continue;
        if (x + 1 < g.width && walk[g.terrain[i + 1]])
          worst = Math.max(worst, Math.abs(g.heights[i] - g.heights[i + 1]));
        if (z + 1 < g.depth && walk[g.terrain[i + g.width]])
          worst = Math.max(worst, Math.abs(g.heights[i] - g.heights[i + g.width]));
      }
    expect(worst).toBeLessThan(1);
  });

  test('every landing, hostile structure and seam stands on usable ground', () => {
    const b = newBattle(1000, { seed: 5, playerSlots: 2, enemyCount: 2 });
    for (let i = 0; i < 2; i++)
      joinBattle(b, { id: `p${i}`, name: `P${i}`, culture: 'neutral' }, 1000);
    const terrain = terrainFor(b);
    for (const e of b.entities)
      expect(terrain.groundAt(e.x, e.z), `${e.kind} at ${e.x},${e.z}`).toBe(true);
    for (const e of b.entities.filter((e) => !isUnit(e.kind)))
      expect(terrain.buildableAt(e.x, e.z), `${e.kind} at ${e.x},${e.z}`).toBe(true);
    for (const d of b.deposits!) expect(terrain.groundAt(d.x, d.z), d.name).toBe(true);
  });

  test('ground routes cross the river on a crossing and climb the plateau by a ramp', () => {
    const route = (from: { x: number; z: number }, to: { x: number; z: number }) =>
      withRoutingBudget(() => findPath(from, to, false, [], map), Infinity);
    const from = { x: 20, z: 40 };
    const crossing = route(from, { x: 20, z: -25 });
    expect(crossing.length).toBeGreaterThan(1);
    const crossed = walked(crossing, from);
    expect(crossed.has('river')).toBe(false);
    expect(crossed.has('bridge') || crossed.has('ford')).toBe(true);
    const base = { x: 5, z: -20 };
    const climb = route(base, { x: 5, z: -66 });
    expect(climb.length).toBeGreaterThan(0);
    const climbed = walked(climb, base);
    expect(climbed.has('ramp')).toBe(true);
    expect(climbed.has('cliff')).toBe(false);
    expect(climbed.has('plateau')).toBe(true);
    // No route leads into the tarn.
    expect(route({ x: -100, z: -80 }, { x: -128, z: -82 })).toEqual([]);
  });

  test('units wading a ford move slower than on firm ground', () => {
    const b = newBattle(1000, { seed: 3 });
    joinBattle(b, { id: 'a', name: 'A', culture: 'neutral' }, 1000);
    // Open ground only: the dry lane runs past a tech site.
    b.sites = [];
    const dry = makeEntity(b, 'lynx', 'a', 'blue', { x: 20, z: 40 }),
      wet = makeEntity(b, 'lynx', 'a', 'blue', { x: ford.x, z: ford.z });
    for (const e of [dry, wet]) {
      e.order = 'move';
      // Cruising along the lane already, so only terrain sets the pace.
      e.angle = Math.PI;
      e.v = TACTICAL_UNITS.lynx.speed;
      e.path = [{ x: e.x, z: e.z - 30 }];
      b.entities.push(e);
    }
    tickBattle(b, 1250);
    const dryMoved = 40 - dry.z,
      wetMoved = ford.z - wet.z;
    expect(dryMoved).toBeGreaterThan(0);
    expect(wetMoved).toBeGreaterThan(0);
    expect(wetMoved).toBeLessThan(dryMoved * 0.6);
  });
});
