import { terrainFor } from '../lib/tactical-terrain';
import { MAPS } from '../lib/maps';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import {
  TACTICAL_BUILDINGS,
  EARLY_BUILD_SCALE,
  findPath,
  joinBattle,
  makeEntity,
  movementObstacles,
  newBattle,
  placementError,
  purchase,
  STARTING_CREDITS,
  sellStructure,
  tickBattle,
  type Battle,
} from '../lib/tactics';
import {
  OUTPOST_BUILD_RADIUS,
  buildAreas,
  footprint,
  footprintSamples,
  insideFootprint,
  productionExit,
  segmentIntersectsFootprint,
  type Placement,
} from '../lib/tactical-placement';
const modules = import.meta.glob('../convex/**/*.ts');
/**
 * The default map's features used below. Base positions were laid out around the
 * old first landing at (-110, 62); `at` keeps them relative to Alice's landing.
 */
const MAP = terrainFor({});
const HOME = MAP.baseAt(0);
const OTHER_LANDING = MAP.baseAt(1);
const HOME_ORE = MAP.homeOreAt(0);
const at = (x: number, z: number) => ({
  x: x + 110 + HOME.x,
  z: z - 62 + HOME.z,
});
/** Open water in the Kaldelva, a cliff on the Kvitåsen rim, a marsh at Ternvik. */
const RIVER = { x: 40, z: 2 };
const CLIFF = { x: -12, z: -43 };
const MARSH = (() => {
  const m = MAPS.fjordmouth.marshes[0];
  return {
    x: m.reduce((sum, p) => sum + p.x, 0) / m.length,
    z: m.reduce((sum, p) => sum + p.z, 0) / m.length,
  };
})();
const BRIDGE = MAPS.fjordmouth.crossings.find((c) => c.id === 'kaldelva')!;
const reactor: Placement = { position: at(-88, 60), rotation: 2 };
const factory: Placement = { position: at(-110, 84), rotation: 2 };
function setup() {
  const b = newBattle(1000);
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
  return b;
}
function near(b: Battle, x: number, z: number) {
  const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
  hq.x = x;
  hq.z = z;
}
/** Established, completed structures for rules that come after the tech gates. */
function established(b: Battle, kinds: ('reactor' | 'refinery')[]) {
  for (const kind of kinds) {
    const e = makeEntity(
      b,
      kind,
      'alice',
      'blue',
      kind === 'reactor' ? reactor.position : at(-126, 64),
    );
    e.angle = Math.PI;
    b.entities.push(e);
  }
}
describe('Authoritative construction placement', () => {
  test('closed solo and co-op rosters can use empty landing zones; legacy enrollment still reserves them', () => {
    const b = setup();
    b.entities = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    );
    b.deposits = [];
    near(b, OTHER_LANDING.x - 22, OTHER_LANDING.z - 8);
    const site = {
      position: { x: OTHER_LANDING.x - 2, z: OTHER_LANDING.z - 8 },
      rotation: 0,
    };
    expect(placementError(b, 'alice', 'reactor', site)).toContain('reserved');
    b.mode = 'solo';
    expect(placementError(b, 'alice', 'reactor', site)).toBeNull();
    b.mode = 'coop';
    expect(placementError(b, 'alice', 'reactor', site)).toBeNull();
    // The legacy client receives an explicit enrollment flag, despite displaying co-op mode.
    b.openEnrollment = true;
    expect(placementError(b, 'alice', 'reactor', site)).toContain('reserved');
  });
  test('mined-out ore stops reserving invisible ground', () => {
    const b = setup();
    b.entities = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    );
    b.mode = 'solo';
    const site = { position: at(-88, 60), rotation: 0 };
    b.deposits = [
      {
        id: 'spent',
        name: 'Spent seam',
        ...site.position,
        amount: 1,
        capacity: 1000,
      },
    ];
    expect(placementError(b, 'alice', 'reactor', site)).toContain('ore field');
    b.deposits[0].amount = 0;
    expect(placementError(b, 'alice', 'reactor', site)).toBeNull();
    expect(() => purchase(b, 'alice', 'reactor', 1000, site)).not.toThrow();
  });
  test('players can prepare level marsh foundations while water and cliffs remain protected', () => {
    const b = setup();
    b.entities = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    );
    b.deposits = [];
    b.mode = 'solo';
    expect(MAP.terrainAt(MARSH.x, MARSH.z)).toBe('marsh');
    near(b, MARSH.x + 20, MARSH.z);
    expect(
      placementError(b, 'alice', 'reactor', { position: MARSH, rotation: 0 }),
    ).toBeNull();
    near(b, RIVER.x, RIVER.z + 20);
    expect(
      placementError(b, 'alice', 'reactor', { position: RIVER, rotation: 0 }),
    ).toContain('dry land');
    near(b, CLIFF.x, CLIFF.z + 20);
    expect(
      placementError(b, 'alice', 'reactor', { position: CLIFF, rotation: 0 }),
    ).toContain('dry land');
  });
  test('chosen coordinates, orientation, cost and timing survive construction completion', () => {
    const b = setup();
    const id = purchase(b, 'alice', 'reactor', 1000, {
      position: at(-87.92, 60.08),
      rotation: 1,
    });
    const e = b.entities.find((e) => e.id === id)!;
    expect(e).toMatchObject({
      ...at(-88, 60),
      angle: Math.PI / 2,
      readyAt:
        1000 +
        Math.round(TACTICAL_BUILDINGS.reactor.seconds * EARLY_BUILD_SCALE) *
          1000,
    });
    expect(b.commanders[0].credits).toBe(STARTING_CREDITS - 160);
    tickBattle(b, 17000);
    expect(e).toMatchObject({
      ...at(-88, 60),
      angle: Math.PI / 2,
      readyAt: 0,
    });
  });
  test('missing or invalid placement cannot spend credits, reserve power or create a queue entry', () => {
    for (const p of [
      undefined,
      { position: { x: NaN, z: HOME.z }, rotation: 0 },
      { position: { x: HOME.x, z: Infinity }, rotation: 0 },
      { position: at(-88, 60), rotation: 1.5 },
      { position: at(-88, 60), rotation: 4 },
    ]) {
      const b = setup(),
        before = structuredClone(b);
      expect(() => purchase(b, 'alice', 'reactor', 1000, p)).toThrow();
      expect(b).toEqual(before);
    }
  });
  test('requires proximity to a completed structure, not a queued or allied one', () => {
    const b = setup();
    expect(
      placementError(b, 'alice', 'reactor', {
        position: { x: 0, z: 40 },
        rotation: 0,
      }),
    ).toContain('outpost');
    const extra = makeEntity(
      b,
      'refinery',
      'alice',
      'blue',
      { x: 0, z: 40 },
      12000,
    );
    b.entities.push(extra);
    const site = { position: { x: 30, z: 30 }, rotation: 0 };
    expect(placementError(b, 'alice', 'reactor', site)).toContain('outpost');
    extra.readyAt = 0;
    expect(placementError(b, 'alice', 'reactor', site)).toBeNull();
    extra.owner = 'bob';
    expect(placementError(b, 'alice', 'reactor', site)).toContain('outpost');
  });
  test('a scouted forward outpost opens an independent radius only after completion', () => {
    const b = setup();
    const remote = { position: { x: 30, z: 30 }, rotation: 0 };
    const edge = { position: { x: 30 - OUTPOST_BUILD_RADIUS, z: 30 }, rotation: 0 };
    const outside = { position: { x: 29 - OUTPOST_BUILD_RADIUS, z: 30 }, rotation: 0 };
    const scout = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    scout.x = 34;
    scout.z = 40;
    expect(placementError(b, 'alice', 'reactor', remote)).toContain('outpost');
    const id = purchase(b, 'alice', 'outpost', 1000, remote) as string;
    expect(buildAreas(b.entities, 'alice').some((area) => area.id === id)).toBe(
      false,
    );
    expect(placementError(b, 'alice', 'reactor', edge)).toContain('outpost');
    Object.assign(scout, HOME);
    tickBattle(b, 16000);
    expect(
      buildAreas(b.entities, 'alice').find((area) => area.id === id),
    ).toMatchObject({
      x: 30,
      z: 30,
      radius: OUTPOST_BUILD_RADIUS,
    });
    expect(placementError(b, 'alice', 'reactor', edge)).toBeNull();
    expect(placementError(b, 'alice', 'reactor', outside)).toContain('outpost');
    expect(placementError(b, 'bob', 'reactor', edge)).not.toBeNull();
    const outpost = b.entities.find((e) => e.id === id)!;
    outpost.hp = 0;
    expect(placementError(b, 'alice', 'reactor', edge)).toContain('outpost');
    outpost.hp = 700;
    sellStructure(b, 'alice', id, 17000);
    expect(placementError(b, 'alice', 'reactor', edge)).toContain('outpost');
  });
  test('remote outposts require current sight from an owned, living and completed force', () => {
    const b = setup();
    const remote = { position: { x: 30, z: 30 }, rotation: 0 };
    const scout = makeEntity(b, 'ranger', 'bob', 'blue', { x: 34, z: 40 });
    b.entities.push(scout);
    for (const state of [
      { kind: 'ranger' as const, owner: 'bob', hp: 100, readyAt: 0 },
      { kind: 'ranger' as const, owner: 'alice', hp: 0, readyAt: 0 },
      { kind: 'outpost' as const, owner: 'alice', hp: 100, readyAt: 5000 },
    ]) {
      Object.assign(scout, state);
      const before = structuredClone(b);
      expect(() => purchase(b, 'alice', 'outpost', 1000, remote)).toThrow(
        'Scout',
      );
      expect(b).toEqual(before);
    }
    Object.assign(scout, { kind: 'ranger', readyAt: 0 });
    expect(placementError(b, 'alice', 'outpost', remote)).toBeNull();
    scout.x = -100;
    expect(placementError(b, 'alice', 'outpost', remote)).toContain('Scout');
    scout.x = 34;
    scout.z = 40;
    Object.assign(scout, RIVER);
    expect(
      placementError(b, 'alice', 'outpost', {
        position: { x: scout.x, z: scout.z },
        rotation: 0,
      }),
    ).toContain('dry land');
  });
  test('checks the full foundation, including a corner over water and the map boundary', () => {
    const b = setup();
    near(b, RIVER.x, RIVER.z + 30);
    expect(
      placementError(b, 'alice', 'refinery', {
        position: { x: RIVER.x, z: RIVER.z + 15 },
        rotation: 0,
      }),
    ).toContain('dry land');
    near(b, MAP.bounds.minX + 20, 60);
    expect(
      placementError(b, 'alice', 'reactor', {
        position: { x: MAP.bounds.minX + 1, z: 60 },
        rotation: 0,
      }),
    ).toContain('dry land');
  });
  test('bridges, approaches, ore seams and future join positions stay clear', () => {
    const b = setup();
    near(b, BRIDGE.x + 9, BRIDGE.z + 40);
    expect(
      placementError(b, 'alice', 'reactor', {
        position: { x: BRIDGE.x + 9, z: BRIDGE.z + 22 },
        rotation: 0,
      }),
    ).toContain('bridge');
    near(b, CLIFF.x, CLIFF.z + 20);
    expect(
      placementError(b, 'alice', 'reactor', { position: CLIFF, rotation: 0 }),
    ).toContain('firm, dry land');
    near(b, OTHER_LANDING.x - 22, OTHER_LANDING.z - 8);
    expect(
      placementError(b, 'alice', 'reactor', {
        position: { x: OTHER_LANDING.x - 2, z: OTHER_LANDING.z - 8 },
        rotation: 0,
      }),
    ).toContain('landing zone');
    near(b, HOME.x, HOME.z);
    expect(
      placementError(b, 'alice', 'reactor', {
        position: HOME_ORE,
        rotation: 0,
      }),
    ).toContain('ore field');
  });
  test('closely packed foundations use quarter-metre placement without overlapping', () => {
    const b = setup();
    b.entities = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    );
    b.deposits = [];
    b.mode = 'solo';
    purchase(b, 'alice', 'reactor', 1000, reactor);
    // Pack a second reactor, turned a quarter, against the east face of the first.
    const first = footprint('reactor', reactor.position, Math.PI);
    const turned = footprint('reactor', { x: 0, z: 0 }, Math.PI / 2);
    const flush = Math.ceil((first.maxX + 0.25 - turned.minX) * 4) / 4;
    // Closer than the quarter-metre gap overlaps or leaves too little room.
    for (const x of [flush - 0.5, flush - 0.25])
      expect(
        placementError(b, 'alice', 'reactor', {
          position: { x, z: reactor.position.z },
          rotation: 1,
        }),
      ).toContain('between structures');
    // Quarter-metre snapping keeps the gap.
    const close = {
      position: { x: flush - 0.03, z: reactor.position.z + 0.08 },
      rotation: 1,
    };
    expect(placementError(b, 'alice', 'reactor', close)).toBeNull();
    const id = purchase(b, 'alice', 'reactor', 1000, close);
    expect(b.entities.find((e) => e.id === id)).toMatchObject({
      x: flush,
      z: reactor.position.z,
      angle: Math.PI / 2,
    });
  });
  test('queued foundations, allied structures, and ground units occupy their space', () => {
    const b = setup();
    purchase(b, 'alice', 'reactor', 1000, reactor);
    expect(placementError(b, 'alice', 'outpost', reactor)).toContain(
      'between structures',
    );
    const existing = b.entities.at(-1)!;
    existing.owner = 'bob';
    expect(placementError(b, 'alice', 'outpost', reactor)).toContain(
      'between structures',
    );
    const c = setup(),
      u = c.entities.find((e) => e.owner === 'alice' && e.kind === 'ranger')!;
    Object.assign(u, at(-88, 60));
    expect(
      placementError(c, 'alice', 'reactor', { position: u, rotation: 0 }),
    ).toContain('ground units');
  });
  test('factory exits may use walkable banks but must clear neighboring buildings', () => {
    const b = setup();
    established(b, ['reactor', 'refinery']);
    // North of the Kaldelva: facing south, the works opens onto the river bank.
    near(b, 60, -52);
    const p = { position: { x: 60, z: -26 }, rotation: 0 };
    expect(MAP.terrainAt(60, -26 + 12.5)).toBe('bank');
    expect(placementError(b, 'alice', 'factory', p)).toBeNull();
    b.entities.push(
      makeEntity(b, 'reactor', 'bob', 'blue', { x: 60, z: -10 }),
    );
    expect(placementError(b, 'alice', 'factory', p)).toContain('vehicle exit');
    expect(
      placementError(b, 'alice', 'factory', { ...p, rotation: 2 }),
    ).toBeNull();
  });
  test('new armor spawns at the placed factory, not the old automatic pad', () => {
    const b = setup();
    established(b, ['reactor', 'refinery']);
    purchase(b, 'alice', 'factory', 1000, factory);
    tickBattle(b, 26000);
    b.commanders[0].credits = 900;
    const f = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'factory',
    )!;
    expect(f.readyAt).toBe(0);
    purchase(b, 'alice', 'lynx', 27000);
    tickBattle(b, 42000);
    // Hostile bases train troops of their own meanwhile, so look at Alice's newest vehicle.
    const lynx = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'lynx',
    );
    expect(lynx.at(-1)).toMatchObject(productionExit(f));
    expect(lynx.at(-1)!.z).not.toBe(footprint('hq', HOME, Math.PI).minZ - 6);
    expect(() => purchase(b, 'alice', 'lynx', 43000, reactor)).toThrow(
      'production building',
    );
  });
});
describe('Navigation around placed structures', () => {
  test('new orders beside a wall use a clear grid entry and reach non-grid destinations', () => {
    const box = { minX: -3.7, maxX: 3.7, minZ: 26, maxZ: 34 };
    const from = { x: -4.8, z: 30.1 },
      to = { x: 4.8, z: 30.1 };
    const path = findPath(from, to, false, [box]);
    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)).toEqual(to);
    for (let i = 0; i < path.length; i++)
      expect(
        segmentIntersectsFootprint(i ? path[i - 1] : from, path[i], box),
      ).toBe(false);
  });
  test('ground units detour around the whole foundation, while aircraft pass over it', () => {
    const box = footprint('factory', { x: -25, z: 40 }, Math.PI / 2),
      from = { x: -50, z: 40 },
      to = { x: 0, z: 40 };
    const path = findPath(from, to, false, [box]);
    expect(path.length).toBeGreaterThan(2);
    for (let i = 0; i < path.length; i++)
      expect(
        segmentIntersectsFootprint(i ? path[i - 1] : from, path[i], box),
      ).toBe(false);
    expect(findPath(from, to, true, [box])).toEqual([to]);
    expect(findPath(from, { x: -25, z: 40 }, false, [box])).toEqual([]);
  });
  test('a new foundation on an existing route triggers a detour before units enter it', () => {
    const b = setup();
    b.entities = b.entities.filter((e) => e.team === 'blue' || e.kind === 'hq');
    const unit = b.entities.find((e) => e.kind === 'lynx')!;
    unit.x = -66;
    unit.z = 60;
    unit.order = 'move';
    unit.path = [
      { x: -64, z: 60 },
      { x: -40, z: 60 },
    ];
    const structure = makeEntity(
      b,
      'reactor',
      'alice',
      'blue',
      { x: -57, z: 60 },
      50000,
    );
    b.entities.push(structure);
    const box = movementObstacles(b).at(-1)!;
    for (let now = 2000; now <= 10000; now += 1000) {
      tickBattle(b, now);
      expect(insideFootprint(unit, box, 1)).toBe(false);
    }
    expect(unit.x).toBeCloseTo(-40);
    expect(unit.z).toBeCloseTo(60);
  });
  test('rotated footprints contain every exported platform corner', () => {
    const a = footprint('factory', { x: 0, z: 0 }, 0),
      b = footprint('factory', { x: 0, z: 0 }, Math.PI / 2);
    expect(a.maxZ - a.minZ).toBeCloseTo(b.maxX - b.minX);
    expect(a.maxX - a.minX).toBeCloseTo(b.maxZ - b.minZ);
    expect(footprintSamples(b).length).toBeGreaterThan(80);
    // Gun emplacements reserve their full sweep regardless of orientation.
    expect(footprint('battery', { x: 0, z: 0 }, Math.PI / 2)).toEqual(
      footprint('battery', { x: 0, z: 0 }, 0),
    );
  });
});
describe('Shared Convex placement', () => {
  const alice = 'c'.repeat(64),
    bob = 'd'.repeat(64);
  beforeEach(() => {
    // Fixed southern landing for these construction scenarios; generated geography has its own coverage.
    vi.spyOn(Math, 'random').mockReturnValue(1000 / 4294967296);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  async function world() {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    const id = await t.mutation(api.tactics.deploy, { token: alice });
    await t.mutation(api.tactics.deploy, { token: bob });
    return { t, id };
  }
  test('the server accepts a scouted outpost, then construction in its completed radius', async () => {
    const { t, id } = await world();
    const remote = { position: { x: 30, z: 30 }, rotation: 0 };
    const edge = { position: { x: 30 - OUTPOST_BUILD_RADIUS, z: 30 }, rotation: 0 };
    const build = (
      kind: 'outpost' | 'reactor',
      placement: Placement,
      token = alice,
    ) =>
      t.mutation(api.tactics.produce, { token, sectorId: id, kind, placement });
    await expect(build('outpost', remote)).rejects.toThrow('Scout');
    const initial = (await t.query(api.tactics.state, { token: alice }))!;
    await t.run(async (ctx) => {
      const b = (await ctx.db.get(id))!;
      const scout = b.entities.find(
        (e) => e.owner === initial.viewerId && e.kind === 'ranger',
      )!;
      Object.assign(scout, { x: 34, z: 40 });
      await ctx.db.patch(id, { entities: b.entities });
    });
    await build('outpost', remote);
    await expect(build('reactor', edge)).rejects.toThrow('outpost');
    const expected = Date.now();
    vi.setSystemTime(expected + 15000);
    await t.mutation(internal.tactics.tick, { id, expected });
    await expect(build('reactor', edge, bob)).rejects.toThrow('outpost');
    await build('reactor', edge);
    const updated = (await t.query(api.tactics.state, { token: alice }))!;
    expect(updated.entities.find((e) => e.kind === 'reactor')).toMatchObject({
      ...edge.position,
      owner: initial.viewerId,
      // The outpost already stands, so this is still an early foundation.
      readyAt:
        Date.now() +
        Math.round(TACTICAL_BUILDINGS.reactor.seconds * EARLY_BUILD_SCALE) *
          1000,
    });
  });
  test('both players see the exact chosen foundation through construction and reconnects', async () => {
    const { t, id } = await world();
    await t.mutation(api.tactics.produce, {
      token: alice,
      sectorId: id,
      kind: 'reactor',
      placement: reactor,
    });
    const a = (await t.query(api.tactics.state, { token: alice }))!,
      b = (await t.query(api.tactics.state, { token: bob }))!;
    const building = a.entities.find((e) => e.kind === 'reactor')!;
    expect(building).toMatchObject({ ...at(-88, 60), angle: Math.PI });
    expect(b.entities.find((e) => e.id === building.id)).toEqual(building);
    const expected = Date.now();
    vi.setSystemTime(expected + 16000);
    await t.mutation(internal.tactics.tick, { id, expected });
    expect(
      (await t.query(api.tactics.state, { token: bob }))!.entities.find(
        (e) => e.id === building.id,
      ),
    ).toMatchObject({ ...at(-88, 60), readyAt: 0 });
  });
  test('competing placements reserve one footprint atomically and only charge the winner', async () => {
    const { t, id } = await world(),
      placement = { position: at(-75, 62), rotation: 0 };
    const results = await Promise.allSettled([
      t.mutation(api.tactics.produce, {
        token: alice,
        sectorId: id,
        kind: 'reactor',
        placement,
      }),
      t.mutation(api.tactics.produce, {
        token: bob,
        sectorId: id,
        kind: 'reactor',
        placement,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const s = (await t.query(api.tactics.state, { token: alice }))!;
    expect(s.entities.filter((e) => e.kind === 'reactor')).toHaveLength(1);
    expect(s.commanders.reduce((sum, c) => sum + c.credits, 0)).toBe(
      STARTING_CREDITS * 2 - 160,
    );
  });
  test('rejects forged remote construction, missing positions and unauthenticated commands', async () => {
    const { t, id } = await world();
    await expect(
      t.mutation(api.tactics.produce, {
        token: alice,
        sectorId: id,
        kind: 'reactor',
      }),
    ).rejects.toThrow('Choose where');
    await expect(
      t.mutation(api.tactics.produce, {
        token: alice,
        sectorId: id,
        kind: 'reactor',
        placement: { position: { x: 70, z: -60 }, rotation: 0 },
      }),
    ).rejects.toThrow('outpost');
    await expect(
      t.mutation(api.tactics.produce, {
        token: 'stranger',
        sectorId: id,
        kind: 'reactor',
        placement: reactor,
      }),
    ).rejects.toThrow('Reconnect');
    expect(
      (await t.query(api.tactics.state, { token: alice }))!.commanders.every(
        (c) => c.credits === STARTING_CREDITS,
      ),
    ).toBe(true);
  });
});
