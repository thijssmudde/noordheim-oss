import { describe, expect, test, vi } from 'vitest';
import {
  formationDestinations,
  formationRadius,
} from '../lib/tactical-formation';
import {
  groundNavigation,
  groundSegmentCost,
} from '../lib/tactical-navigation';
import {
  insideFootprint,
  segmentIntersectsFootprint,
} from '../lib/tactical-placement';
import {
  defaultTerrain,
  terrainFor,
  type TerrainMap,
} from '../lib/tactical-terrain';
import { openGround } from './helpers/open-ground';
import {
  findPath,
  issueOrder,
  makeEntity,
  newBattle,
  tickBattle,
  TACTICAL_UNITS,
  unitKinds,
  type Point,
  type UnitKind,
} from '../lib/tactics';

const terrain: TerrainMap = defaultTerrain;
const groundAt = (x: number, z: number) => terrain.groundAt(x, z);
/**
 * A squad on open, firm ground of the default map. `at` places the original
 * Skerry-era test coordinates (x -30..22, z 28..70) around that ground.
 */
function squad(count: number, kind: UnitKind = 'ranger') {
  const b = newBattle(1000);
  b.entities = b.entities.filter((e) => e.team === 'red' && e.kind === 'hq');
  const o = openGround(terrainFor(b), 90, b.entities, 60, false);
  const at = (x: number, z: number): Point => ({
    x: o.x + x + 7,
    z: o.z + z - 47,
  });
  const units = Array.from({ length: count }, (_, i) =>
    makeEntity(
      b,
      kind,
      'alice',
      'blue',
      at(-30 + (i % 4) * 3, 30 + Math.floor(i / 4) * 3),
    ),
  );
  b.entities.push(...units);
  return { b, units, at };
}
/** A squad drawn up on one bank, facing the map's first real bridge. */
function bridgeSquad(count: number, kind: UnitKind) {
  const b = newBattle(1000);
  b.entities = b.entities.filter((e) => e.team === 'red' && e.kind === 'hq');
  const bridge = terrainFor(b).design.crossings.find(
    (c) => c.style !== 'ford',
  )!;
  const ux = Math.sin(bridge.angle),
    uz = Math.cos(bridge.angle);
  const bank = bridge.length / 2 + 8;
  const units = Array.from({ length: count }, (_, i) => {
    const across = ((i % 4) - 1.5) * 3,
      back = bank + Math.floor(i / 4) * 3;
    return makeEntity(b, kind, 'alice', 'blue', {
      x: bridge.x - ux * back + uz * across,
      z: bridge.z - uz * back - ux * across,
    });
  });
  for (const e of units) expect(groundAt(e.x, e.z)).toBe(true);
  b.entities.push(...units);
  return { b, units, target: { x: bridge.x, z: bridge.z } };
}
function assertSeparated(points: Point[], gap: number) {
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      expect(
        Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z),
      ).toBeGreaterThanOrEqual(gap - 1e-6);
}
function assertGroundRoute(from: Point, path: Point[]) {
  expect(path.length).toBeGreaterThan(0);
  for (const p of path) {
    expect(Number.isFinite(groundSegmentCost(from, p))).toBe(true);
    from = p;
  }
}

describe('Squad movement', () => {
  test('all faction infantry keep a compact full-army formation', () => {
    for (const kind of unitKinds.filter(
      (kind) => TACTICAL_UNITS[kind].category === 'infantry',
    )) {
      const { units, at } = squad(80, kind);
      const target = at(15, 65);
      const points = [...formationDestinations(units, target, []).values()];
      assertSeparated(points, 2.16);
      // Eighty soldiers fit within a roughly 20m-wide body, even for signature rosters.
      expect(
        Math.max(
          ...points.map((p) => Math.hypot(p.x - target.x, p.z - target.z)),
        ),
        kind,
      ).toBeLessThan(15);
    }
  });

  test('adding heavy armor does not inflate every infantry slot, and matching preserves body clearance', () => {
    const { b, units, at } = squad(80, 'militia');
    units[0].kind = 'jotun';
    units[1].kind = 'tank';
    units[2].kind = 'gunship';
    const target = at(15, 65);
    const slots = formationDestinations(units, target, []);
    const reversed = formationDestinations([...units].reverse(), target, []);
    for (let i = 0; i < units.length; i++) {
      const p = slots.get(units[i].id)!;
      expect(reversed.get(units[i].id)).toEqual(p);
      expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(20);
      for (let j = i + 1; j < units.length; j++) {
        const q = slots.get(units[j].id)!;
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(
          (formationRadius(units[i].kind) + formationRadius(units[j].kind)) *
            0.9 -
            1e-6,
        );
      }
    }
    issueOrder(
      b,
      'alice',
      units.map((unit) => unit.id),
      'move',
      target,
    );
    for (let now = 1250; now <= 41000; now += 250) tickBattle(b, now);
    for (const unit of units) {
      expect(unit.path).toHaveLength(0);
      expect(unit.x).toBeCloseTo(slots.get(unit.id)!.x);
      expect(unit.z).toBeCloseTo(slots.get(unit.id)!.z);
    }
  });

  test('formation faces travel and retains left/right ordering regardless of selection order', () => {
    const { units, at } = squad(2);
    Object.assign(units[0], at(0, 28));
    Object.assign(units[1], at(0, 36));
    const target = at(30, 32);
    const first = formationDestinations(units, target, []);
    const reversed = formationDestinations([...units].reverse(), target, []);
    for (const e of units) expect(first.get(e.id)).toEqual(reversed.get(e.id));
    expect(first.get(units[0].id)!.z).toBeLessThan(first.get(units[1].id)!.z);
    for (const p of first.values()) expect(p.x).toBeCloseTo(target.x);
    expect([...first.values()].reduce((n, p) => n + p.z / 2, 0)).toBeCloseTo(
      target.z,
    );
  });

  test('large vehicles have room to park and a single unit keeps the exact clicked destination', () => {
    const { units, at } = squad(9, 'tank');
    const target = at(0, 65);
    const slots = formationDestinations(units, target, []);
    assertSeparated([...slots.values()], 4.86);
    expect(
      formationDestinations(units.slice(0, 1), target, []).get(units[0].id),
    ).toEqual(target);
    const centre = [...slots.values()].reduce(
      (p, q) => ({ x: p.x + q.x / 9, z: p.z + q.z / 9 }),
      { x: 0, z: 0 },
    );
    expect(centre.x).toBeCloseTo(target.x);
    expect(centre.z).toBeCloseTo(target.z);
  });

  test('wide groups fit a narrow bridge with distinct reachable destinations', () => {
    const { b, units, target } = bridgeSquad(12, 'tank');
    issueOrder(
      b,
      'alice',
      units.map((e) => e.id),
      'move',
      target,
    );
    assertSeparated(
      units.map((e) => e.path.at(-1)!),
      4.86,
    );
    for (const e of units) assertGroundRoute(e, e.path);
    for (let now = 1250; now <= 41000; now += 250) {
      tickBattle(b, now);
      for (const e of units) expect(groundAt(e.x, e.z)).toBe(true);
    }
    expect(units.every((e) => !e.path.length)).toBe(true);
    assertSeparated(units, 4.86);
  });

  test('mixed-size ranks adapt to a bridge without overlapping or placing infantry in water', () => {
    const { b, units, target } = bridgeSquad(24, 'sapper');
    for (const unit of units.slice(0, 4)) unit.kind = 'tank';
    issueOrder(
      b,
      'alice',
      units.map((unit) => unit.id),
      'move',
      target,
    );
    for (let i = 0; i < units.length; i++) {
      assertGroundRoute(units[i], units[i].path);
      const p = units[i].path.at(-1)!;
      for (let j = i + 1; j < units.length; j++) {
        const q = units[j].path.at(-1)!;
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(
          (formationRadius(units[i].kind) + formationRadius(units[j].kind)) *
            0.9 -
            1e-6,
        );
      }
    }
  });

  test('edge and foundation alternatives never pile every soldier onto the click', () => {
    const { units } = squad(12);
    // A click one metre inside the eastern edge, beside a new foundation.
    const edge = terrain.bounds.maxX - 1;
    let click: Point | undefined;
    for (
      let z = terrain.bounds.minZ + 20;
      !click && z < terrain.bounds.maxZ - 20;
      z += 2
    ) {
      let firm = true;
      for (let dx = 0; firm && dx <= 24; dx += 2)
        for (let dz = -14; firm && dz <= 14; dz += 2)
          firm = groundAt(edge - dx, z + dz);
      if (firm) click = { x: edge, z };
    }
    expect(click).toBeDefined();
    const box = {
      minX: click!.x - 9,
      maxX: click!.x - 4,
      minZ: click!.z + 3,
      maxZ: click!.z + 9,
    };
    const slots = formationDestinations(units, click!, [box]);
    assertSeparated([...slots.values()], 2.16);
    for (const p of slots.values()) {
      expect(groundAt(p.x, p.z)).toBe(true);
      expect(p.x).toBeLessThanOrEqual(terrain.bounds.maxX);
      expect(insideFootprint(p, box, 1)).toBe(false);
    }
  });

  test('a full army receives bounded, separate routes for attack-move', () => {
    const { b, units, at } = squad(80);
    issueOrder(
      b,
      'alice',
      units.map((e) => e.id),
      'attackMove',
      at(15, 50),
    );
    assertSeparated(
      units.map((e) => e.path.at(-1)!),
      2.16,
    );
    for (const e of units) {
      expect(e.order).toBe('attackMove');
      expect(e.path.length).toBeLessThan(24);
    }
  });

  test('reissuing an identical order preserves destinations and invalid orders are atomic', () => {
    const { b, units, at } = squad(6);
    const ids = units.map((e) => e.id);
    const target = at(-30, 65);
    issueOrder(b, 'alice', ids, 'move', target);
    const goals = units.map((e) => e.path.at(-1));
    issueOrder(b, 'alice', ids.reverse(), 'move', target);
    expect(units.map((e) => e.path.at(-1))).toEqual(goals);
    const before = structuredClone(b);
    expect(() =>
      issueOrder(
        b,
        'alice',
        ids,
        'move',
        { x: terrain.bounds.maxX + 100, z: 0 },
        undefined,
        1200,
      ),
    ).toThrow();
    expect(b).toEqual(before);
  });

  test('a turn at a finished waypoint preserves the final heading', () => {
    const { b, units } = squad(1);
    const e = units[0];
    e.order = 'move';
    e.angle = Math.PI / 2;
    e.path = [{ x: e.x, z: e.z }];
    tickBattle(b, 1250);
    expect(e.angle).toBe(Math.PI / 2);
  });
});

describe('Natural routes', () => {
  test('squad routes reuse terrain checks without changing routes or crossing new foundations', () => {
    const terrainSpeed = vi.fn(defaultTerrain.terrainSpeed);
    const terrain = { ...defaultTerrain, terrainSpeed };
    const from = { x: -15, z: 30 },
      to = { x: -15, z: -60 };
    const obstacles = [{ minX: -10, maxX: 10, minZ: 45, maxZ: 55 }];
    const first = findPath(from, to, false, obstacles, terrain);
    const initialChecks = terrainSpeed.mock.calls.length;
    terrainSpeed.mockClear();
    const second = findPath(from, to, false, obstacles, terrain);
    expect(second).toEqual(first);
    expect(terrainSpeed.mock.calls.length).toBeLessThan(initialChecks * 0.8);
    assertGroundRoute(from, second);

    const start = { x: 0, z: 30 },
      goal = { x: 0, z: 65 };
    expect(findPath(start, goal, false, [], terrain)).toEqual([goal]);
    const rebuilt = findPath(start, goal, false, obstacles, terrain);
    expect(rebuilt.length).toBeGreaterThan(1);
    let previous = start;
    for (const next of rebuilt) {
      expect(segmentIntersectsFootprint(previous, next, obstacles[0])).toBe(
        false,
      );
      previous = next;
    }
  });

  test('shared collision checks retain clearance across spatial bucket boundaries in both directions', () => {
    const boxes = [
      { minX: -17, maxX: -14, minZ: 29, maxZ: 35 },
      { minX: 15.5, maxX: 18, minZ: 31.5, maxZ: 48 },
    ];
    const grid = groundNavigation(boxes, terrain);
    for (let x = -20; x <= 20; x += 0.5)
      for (let z = 28; z <= 50; z += 0.5) {
        const from = { x, z },
          to = { x: x + 2, z: z + 2 };
        const clear = !boxes.some((box) =>
          segmentIntersectsFootprint(from, to, box),
        );
        expect(grid.clearEdge(from, to)).toBe(clear);
        expect(grid.clearEdge(to, from)).toBe(clear);
        expect(grid.passable(x, z)).toBe(
          terrain.terrainSpeed(x, z) > 0 &&
            !boxes.some((box) => insideFootprint(from, box, 1)),
        );
      }
  });

  test('open-ground redirects take one direct segment without returning to a grid anchor', () => {
    const from = { x: 0.7, z: 30.3 },
      to = { x: 21.3, z: 48.7 };
    expect(findPath(from, to)).toEqual([to]);
  });

  test('smoothing retains cheaper routes around marsh and safe crossings through the sector', () => {
    const marsh = terrain.design.marshes[0];
    const xs = marsh.map((p) => p.x),
      zs = marsh.map((p) => p.z);
    const middle = (Math.min(...zs) + Math.max(...zs)) / 2;
    const from = { x: Math.min(...xs) - 6, z: middle },
      to = { x: Math.max(...xs) + 6, z: middle };
    const route = findPath(from, to);
    assertGroundRoute(from, route);
    let current = from,
      cost = 0;
    for (const p of route) {
      cost += groundSegmentCost(current, p);
      current = p;
    }
    expect(cost).toBeLessThan(groundSegmentCost(from, to) * 0.95);
    // Every landing reaches every hostile stronghold across the rivers.
    const { landings, strongholds } = terrain.design;
    for (const a of landings)
      for (const z of strongholds) assertGroundRoute(a, findPath(a, z));
  });
});

/**
 * A battle with one hostile station and a clear, firm 70 m square to march
 * in, found on whatever map the operation uses. Coordinates are relative to
 * the square's centre.
 */
function field() {
  const b = newBattle(1000);
  b.entities = b.entities.filter((e) => e.team === 'red' && e.kind === 'hq');
  const o = openGround(terrainFor(b), 70, b.entities);
  const at = (dx: number, dz: number): Point => ({ x: o.x + dx, z: o.z + dz });
  const troop = (kind: UnitKind, dx: number, dz: number) => {
    const e = makeEntity(b, kind, 'alice', 'blue', at(dx, dz));
    b.entities.push(e);
    return e;
  };
  return { b, at, troop, terrain: terrainFor(b) };
}

describe('Red Alert movement feel', () => {
  test('stacked troops ease apart instead of sharing one spot', () => {
    const { b, troop, terrain } = field();
    const units = [0, 1, 2, 3].map(() => troop('ranger', 0, 0));
    for (const e of units) e.order = 'stop';
    for (let now = 1250; now <= 4000; now += 250) tickBattle(b, now);
    assertSeparated(units, 1.2 * 2 * 0.75 - 0.05);
    for (const e of units) expect(terrain.groundAt(e.x, e.z)).toBe(true);
  });

  test('a marching tank drives straight through a parked one, which keeps its spot', () => {
    const { b, at, troop } = field();
    const parked = troop('tank', 0, 0),
      mover = troop('tank', 0, -20);
    parked.order = 'stop';
    mover.angle = 0;
    const home = at(0, 0),
      goal = at(0.5, 20);
    issueOrder(b, 'alice', [mover.id], 'move', goal);
    let closest = Infinity;
    for (let now = 1250; now <= 15000; now += 250) {
      tickBattle(b, now);
      closest = Math.min(
        closest,
        Math.hypot(mover.x - home.x, mover.z - home.z),
      );
      expect(parked).toMatchObject(home);
    }
    // No detour: the route runs through the parked hull.
    expect(closest).toBeLessThan(1);
    expect(mover.x).toBeCloseTo(goal.x);
    expect(mover.z).toBeCloseTo(goal.z);
  });

  test('a crowd of vehicles converging on one point never jams', () => {
    const { b, at, troop } = field();
    const tanks = Array.from({ length: 9 }, (_, i) =>
      troop('tank', ((i % 3) - 1) * 12, Math.floor(i / 3) * 12 - 30),
    );
    for (const t of tanks) issueOrder(b, 'alice', [t.id], 'move', at(0, 10));
    for (let now = 1250; now <= 30000; now += 250) tickBattle(b, now);
    // Every tank reaches the shared point instead of grinding against the others.
    for (const t of tanks) {
      expect(t.path).toHaveLength(0);
      expect(Math.hypot(t.x - at(0, 10).x, t.z - at(0, 10).z)).toBeLessThan(8);
    }
  });

  test('a marching troop flows around a parked one, which keeps its spot', () => {
    const { b, at, troop } = field();
    const parked = troop('ranger', 0, 0),
      mover = troop('ranger', 0, -20);
    parked.order = 'stop';
    mover.angle = 0;
    const home = at(0, 0),
      goal = at(0.5, 20);
    issueOrder(b, 'alice', [mover.id], 'move', goal);
    let closest = Infinity;
    for (let now = 1250; now <= 15000; now += 250) {
      tickBattle(b, now);
      closest = Math.min(
        closest,
        Math.hypot(mover.x - home.x, mover.z - home.z),
      );
      expect(parked).toMatchObject(home);
    }
    expect(closest).toBeGreaterThan(1);
    expect(mover.path).toHaveLength(0);
    expect(mover.x).toBeCloseTo(goal.x);
    expect(mover.z).toBeCloseTo(goal.z);
  });

  test('a troop whose destination is occupied halts beside the occupant', () => {
    const { b, at, troop } = field();
    const parked = troop('ranger', 0, 0),
      mover = troop('ranger', 0, -10);
    parked.order = 'stop';
    issueOrder(b, 'alice', [mover.id], 'move', at(0, 0));
    for (let now = 1250; now <= 6000; now += 250) tickBattle(b, now);
    expect(mover.path).toHaveLength(0);
    expect(mover.order).toBe('stop');
    expect(Math.hypot(mover.x - parked.x, mover.z - parked.z)).toBeLessThan(
      3.6,
    );
    expect(parked).toMatchObject(at(0, 0));
  });

  test('a mixed column marches at its slowest member’s pace and arrives together', () => {
    const { b, at, troop } = field();
    const units = [
      troop('lynx', -25, -12),
      troop('lynx', -25, 0),
      troop('lynx', -25, 6),
      troop('jotun', -25, 12),
    ];
    for (const e of units) e.angle = Math.PI / 2;
    issueOrder(
      b,
      'alice',
      units.map((e) => e.id),
      'move',
      at(25, 0),
    );
    for (const e of units) expect(e.pace).toBe(TACTICAL_UNITS.jotun.speed);
    const arrived = new Map<string, number>();
    for (let now = 1250; now <= 40000 && arrived.size < 4; now += 250) {
      tickBattle(b, now);
      for (const e of units) {
        expect(e.v ?? 0).toBeLessThanOrEqual(TACTICAL_UNITS.jotun.speed + 1e-9);
        if (!e.path.length && !arrived.has(e.id)) arrived.set(e.id, now);
      }
    }
    const times = [...arrived.values()];
    expect(times).toHaveLength(4);
    // Unpaced, the Lynxes would beat the Jotun over these 50 m by 7.5 s;
    // what remains is only the formation's own depth.
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(5000);
    // Once the column has arrived, nobody carries the pace into the next order.
    for (const e of units) expect(e.pace).toBeUndefined();
  });

  test('a small infantry squad spreads into a skirmish line across the advance', () => {
    const { at, troop } = field();
    const units = Array.from({ length: 8 }, (_, i) =>
      troop('ranger', i - 4, -20),
    );
    const slots = [...formationDestinations(units, at(0, 20), []).values()];
    const along = slots.map((p) => p.x),
      deep = slots.map((p) => p.z);
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(18);
    expect(Math.max(...deep) - Math.min(...deep)).toBeLessThan(2);
    assertSeparated(slots, 3);
  });

  test('turreted hulls hold their heading in a fight; other troops swing round at their turn rate', () => {
    const { b, at, troop } = field();
    const tank = troop('tank', 0, 0),
      mortar = troop('mortar', 4, 0);
    const foe = makeEntity(b, 'ranger', 'enemy', 'red', at(15, 8));
    b.entities.push(foe);
    for (const e of [tank, mortar])
      Object.assign(e, { angle: 0, order: 'hold' });
    tickBattle(b, 1250);
    expect(tank.angle).toBe(0);
    expect(tank.firedAt).toBe(1250);
    // The mortar's hull turns no faster than its rated yaw per quarter second.
    expect(mortar.angle).toBeCloseTo(TACTICAL_UNITS.mortar.turn * 0.25);
  });
});

test('a mixed column slogging into marsh gets past the troops that arrived first', () => {
  const b = newBattle(1000, { seed: 0, mapId: 'nordlys' });
  b.entities = b.entities.filter((e) => e.team === 'red' && e.kind === 'hq');
  const kinds: UnitKind[] = [
    'ranger', 'ranger', 'ranger', 'ranger', 'militia', 'militia',
    'lynx', 'lynx', 'tank', 'tank', 'raider', 'howitzer',
  ];
  // South of Jernbrua, into the western marsh of Nordlys Valley.
  const units = kinds.map((kind, i) =>
    makeEntity(b, kind, 'alice', 'blue', {
      x: -126 + (i % 4) * 4,
      z: 35 + Math.floor(i / 4) * 4,
    }),
  );
  b.entities.push(...units);
  const marsh = { x: -125, z: 12 };
  expect(terrainFor(b).terrainAt(marsh.x, marsh.z)).toBe('marsh');
  b.tickAt = 1000;
  issueOrder(b, 'alice', units.map((u) => u.id), 'move', marsh, undefined, 1000);
  for (let now = 1250; now <= 31000; now += 250) tickBattle(b, now);
  expect(units.filter((u) => u.path.length).map((u) => u.kind)).toEqual([]);
});
