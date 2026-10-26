import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import {
  EARLY_BUILD_SCALE,
  availability,
  cancelResearch,
  damageAgainst,
  distance,
  fieldCount,
  groundAt,
  HARVESTER_LIMIT,
  isHarvester,
  isUnit,
  issueOrder,
  joinBattle,
  makeEntity,
  nearestDeposit,
  newBattle,
  placementError,
  powerFor,
  purchase,
  RESEARCH,
  research,
  researchAvailability,
  sellStructure,
  setRally,
  setCategoryRally,
  STARTING_CREDITS,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  tickBattle,
  tierOf,
  trainingBlockReason,
  trainingHead,
  visibleToBlue,
  type Battle,
  type Entity,
} from '../lib/tactics';
import { productionExit } from '../lib/tactical-placement';
import { terrainFor } from '../lib/tactical-terrain';
import { MAPS } from '../lib/maps';
const modules = import.meta.glob('../convex/**/*.ts');
/**
 * Alice lands at slot 0 of the default map. Positions below were laid out
 * around the old first landing at (-110, 62); `at` keeps them relative to hers.
 */
const HOME = terrainFor({}).baseAt(0);
const at = (x: number, z: number) => ({
  x: x + 110 + HOME.x,
  z: z - 62 + HOME.z,
});
export const site = {
  reactor: { position: at(-88, 60), rotation: 2 },
  refinery: { position: at(-126, 64), rotation: 2 },
  barracks: { position: at(-90, 78), rotation: 2 },
  factory: { position: at(-110, 84), rotation: 2 },
  turret: { position: at(-100, 42), rotation: 2 },
  lab: { position: at(-70, 62), rotation: 2 },
  airfield: { position: at(-70, 84), rotation: 2 },
  battery: { position: at(-100, 26), rotation: 2 },
  outpost: { position: at(-126, 32), rotation: 2 },
} as const;
function setup(credits = 20000) {
  const b = newBattle(1000, { seed: 1 });
  b.entities = b.entities.filter(
    (e) => !isUnit(e.kind) || e.kind === 'harvester',
  );
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
  b.commanders[0].credits = credits;
  return b;
}
/** Completed structure without spending: for rules that assume an established base. */
function place(b: Battle, kind: keyof typeof site, owner = 'alice') {
  const e = makeEntity(b, kind, owner, 'blue', site[kind].position);
  e.angle = Math.PI;
  b.entities.push(e);
  return e;
}
function own(b: Battle, kind: Entity['kind'], owner = 'alice') {
  return b.entities.filter((e) => e.owner === owner && e.kind === kind);
}
describe('Ore economy', () => {
  test('the sector holds finite ore seams that grow richer toward the enemy', () => {
    const b = newBattle(1000, { seed: 1 });
    const deposits = b.deposits!;
    const map = terrainFor(b);
    for (const d of deposits) {
      expect(groundAt(d.x, d.z)).toBe(true);
      expect(d.amount).toBe(d.capacity);
    }
    const home = deposits.filter((d) => d.name.startsWith('Landing zone')),
      seams = map.design.ore;
    expect(home).toHaveLength(map.design.landings.length);
    expect(Math.max(...home.map((d) => d.amount))).toBeLessThan(
      Math.min(...seams.map((d) => d.amount)),
    );
    const rich = seams.filter((d) => d.rich),
      plain = seams.filter((d) => !d.rich);
    expect(Math.min(...rich.map((d) => d.amount))).toBeGreaterThan(
      Math.max(...plain.map((d) => d.amount)),
    );
    // Rich seams lie nearer the strongholds than the ordinary ones.
    const front = (d: { x: number; z: number }) =>
      Math.min(
        ...map.design.strongholds.map((s) => Math.hypot(s.x - d.x, s.z - d.z)),
      );
    const mean = (list: { x: number; z: number }[]) =>
      list.reduce((sum, d) => sum + front(d), 0) / list.length;
    expect(mean(rich)).toBeLessThan(mean(plain));
    home.forEach((d, slot) =>
      expect(
        Math.hypot(d.x - map.baseAt(slot).x, d.z - map.baseAt(slot).z),
      ).toBeLessThan(30),
    );
    // Every rich seam is guarded.
    for (const d of rich)
      expect(
        b.entities.some(
          (e) => e.team === 'red' && Math.hypot(e.x - d.x, e.z - d.z) < 25,
        ),
      ).toBe(true);
  });
  test('seams last: a home seam holds enough for two harvesters over eight minutes', () => {
    const trip = TACTICAL_UNITS.harvester.cargo!,
      cycleSeconds = 30,
      perHarvesterPerMinute = (trip * 60) / cycleSeconds;
    const b = newBattle(1000, { seed: 1 });
    const [home] = b.deposits!.filter((d) => d.name.startsWith('Landing zone'));
    expect(home.amount).toBeGreaterThanOrEqual(2 * 8 * perHarvesterPerMinute);
    for (const seam of terrainFor(b).design.ore)
      expect(seam.amount).toBeGreaterThanOrEqual(
        3 * 15 * perHarvesterPerMinute,
      );
  });
  test('a completed refinery delivers a free harvester that mines, returns, unloads and repeats', () => {
    const b = setup();
    place(b, 'reactor');
    purchase(b, 'alice', 'refinery', 1000, site.refinery);
    const refinery = own(b, 'refinery')[0];
    expect(refinery.readyAt).toBe(
      1000 +
        Math.round(TACTICAL_BUILDINGS.refinery.seconds * EARLY_BUILD_SCALE) *
          1000,
    );
    tickBattle(b, refinery.readyAt);
    const harvester = own(b, 'harvester')[0];
    expect(harvester).toBeDefined();
    expect(harvester.order).toBe('harvest');
    expect(harvester.cargo).toBe(0);
    expect(powerFor(b, 'alice').used).toBeGreaterThanOrEqual(
      TACTICAL_UNITS.harvester.power + TACTICAL_BUILDINGS.refinery.power,
    );
    const seam = nearestDeposit(b, harvester)!;
    expect(seam.name).toBe('Landing zone 1 ore');
    const credits = b.commanders[0].credits,
      before = seam.amount;
    let delivered = 0,
      trips = 0,
      wasLoaded = false;
    for (let t = 22000; t <= 120000; t += 1000) {
      tickBattle(b, t);
      if ((harvester.cargo ?? 0) >= TACTICAL_UNITS.harvester.cargo!)
        wasLoaded = true;
      if (wasLoaded && harvester.cargo === 0) {
        trips++;
        wasLoaded = false;
      }
      delivered = b.commanders[0].harvested ?? 0;
    }
    expect(trips).toBeGreaterThanOrEqual(3);
    expect(delivered).toBeGreaterThanOrEqual(1500);
    expect(seam.amount).toBeLessThan(before);
    expect(b.commanders[0].credits).toBeGreaterThan(credits + 1400);
    expect(seam.amount + delivered + (harvester.cargo ?? 0)).toBeCloseTo(
      before,
      0,
    );
  });
  test('an exhausted seam sends harvesters to the next field, and they resume by themselves when ore returns', () => {
    const b = setup();
    place(b, 'reactor');
    const refinery = place(b, 'refinery');
    const harvester = makeEntity(
      b,
      'harvester',
      'alice',
      'blue',
      productionExit(refinery),
    );
    b.entities.push(harvester);
    const home = b.deposits!.find((d) => d.name === 'Landing zone 1 ore')!;
    home.amount = 120;
    for (let t = 2000; t <= 40000; t += 1000) tickBattle(b, t);
    expect(home.amount).toBe(0);
    expect(b.events.some((e) => e.text.includes('exhausted'))).toBe(true);
    expect(harvester.order).toBe('harvest');
    expect(harvester.target).not.toBe(home.id);
    for (const d of b.deposits!) d.amount = 0;
    harvester.cargo = 0;
    // Halt it between fields (on a larger map it may still be en route).
    harvester.path = [];
    tickBattle(b, 41000);
    expect(harvester.order).toBe('stop');
    expect(b.events[0].text).toContain('no ore remains');
    // Harvesters take no orders; once ore is within reach again they go back to work.
    expect(() =>
      issueOrder(b, 'alice', [harvester.id], 'harvest', undefined, home.id),
    ).toThrow(/on their own/);
    home.amount = 1000;
    tickBattle(b, 42000);
    expect(harvester.order).toBe('harvest');
    tickBattle(b, 43000);
    expect(harvester.target).toBe(home.id);
  });
  test('harvesters take no orders: they mine the nearest seam, never fight, and count separately from the army', () => {
    const b = setup();
    place(b, 'reactor');
    const refinery = place(b, 'refinery');
    const harvester = makeEntity(b, 'harvester', 'alice', 'blue', {
      x: refinery.x,
      z: refinery.z - 10,
    });
    b.entities.push(harvester);
    tickBattle(b, 2000);
    expect(harvester.order).toBe('harvest');
    expect(harvester.target).toBe(nearestDeposit(b, harvester)!.id);
    for (const p of harvester.path) expect(groundAt(p.x, p.z)).toBe(true);
    const shore = b.deposits!.find((d) => !d.name.startsWith('Landing'))!;
    expect(() =>
      issueOrder(b, 'alice', [harvester.id], 'harvest', undefined, shore.id),
    ).toThrow(/on their own/);
    const enemy = makeEntity(b, 'ranger', 'hostile', 'red', {
      x: harvester.x,
      z: harvester.z - 4,
    });
    b.entities.push(enemy);
    expect(() =>
      issueOrder(b, 'alice', [harvester.id], 'attack', undefined, enemy.id),
    ).toThrow(/on their own/);
    tickBattle(b, 3000);
    expect(enemy.hp).toBe(TACTICAL_UNITS.ranger.hp);
    expect(harvester.hp).toBeLessThan(TACTICAL_UNITS.harvester.hp);
    expect(fieldCount(b, 'alice')).toEqual({ units: 3, harvesters: 1 });
  });
  test('harvester production respects its own limit while the field army has its own', () => {
    const b = setup();
    place(b, 'reactor');
    place(b, 'refinery');
    place(b, 'factory');
    const addHarvester = (i: number) =>
      b.entities.push(
        makeEntity(b, 'harvester', 'alice', 'blue', at(-120 + i * 3, 100)),
      );
    for (let i = 0; i < HARVESTER_LIMIT - 1; i++) addHarvester(i);
    for (let i = 0; i < 6; i++)
      b.entities.push(
        makeEntity(b, 'reactor', 'alice', 'blue', at(-60 + i * 6, 100)),
      );
    // Orders count against the cap too: one slot is left, so a batch of two is refused.
    expect(() => purchase(b, 'alice', 'harvester', 1000, undefined, 2)).toThrow(
      /Only 1 more harvester/,
    );
    purchase(b, 'alice', 'harvester', 1000, undefined, 1);
    expect(() => purchase(b, 'alice', 'harvester', 1000, undefined, 1)).toThrow(
      /Harvester limit reached/,
    );
    purchase(b, 'alice', 'lynx', 1000, undefined, 1);
    // A refinery's free harvester fills the last slot before the order deploys.
    addHarvester(HARVESTER_LIMIT - 1);
    tickBattle(b, 40000);
    // The vehicle line pauses behind the blocked harvester, exactly as the queue panel explains.
    expect(own(b, 'harvester')).toHaveLength(HARVESTER_LIMIT);
    expect(own(b, 'lynx')).toHaveLength(1);
    expect(trainingHead(b, 'alice', 'vehicle')!.kind).toBe('harvester');
    expect(trainingBlockReason(b, 'alice', 'harvester')).toContain(
      'harvester space',
    );
    expect(trainingBlockReason(b, 'alice', 'lynx')).toBeNull();
    const parked = own(b, 'harvester')[0];
    parked.hp = 0;
    tickBattle(b, 40250);
    tickBattle(b, 57000);
    expect(own(b, 'lynx')).toHaveLength(2);
  });
});
describe('Tech tree and research', () => {
  test('production buildings gate their units and clearance gates the tiers', () => {
    const b = setup();
    expect(availability(b, 'alice', 'ranger')).toContain('Jæger hall');
    expect(availability(b, 'alice', 'refinery')).toContain('Geothermal');
    expect(availability(b, 'alice', 'barracks')).toContain('Geothermal');
    expect(availability(b, 'alice', 'outpost')).toBeNull();
    expect(() => purchase(b, 'alice', 'ranger', 1000)).toThrow('Jæger hall');
    place(b, 'reactor');
    expect(availability(b, 'alice', 'refinery')).toBeNull();
    expect(availability(b, 'alice', 'factory')).toContain('Ore refinery');
    place(b, 'refinery');
    place(b, 'barracks');
    place(b, 'factory');
    expect(availability(b, 'alice', 'ranger')).toBeNull();
    expect(availability(b, 'alice', 'rocket')).toBeNull();
    expect(availability(b, 'alice', 'lynx')).toBeNull();
    expect(availability(b, 'alice', 'tank')).toContain('Tier 2');
    expect(availability(b, 'alice', 'tank')).toContain('command station');
    expect(availability(b, 'alice', 'airfield')).toContain('Tier 2');
    expect(availability(b, 'alice', 'lab')).toContain('Tier 2');
    expect(() => purchase(b, 'alice', 'tank', 1000)).toThrow('Tier 2');
    expect(researchAvailability(b, 'alice', 'clearance2')).toBeNull();
    expect(researchAvailability(b, 'alice', 'drills')).toContain(
      'Research station',
    );
    research(b, 'alice', 'clearance2', 1000);
    expect(b.commanders[0].credits).toBe(20000 - RESEARCH.clearance2.cost);
    expect(() => research(b, 'alice', 'clearance2', 1000)).toThrow(
      'in progress',
    );
    tickBattle(b, 1000 + RESEARCH.clearance2.seconds * 1000);
    expect(tierOf(b, 'alice')).toBe(2);
    expect(b.events[0].text).toContain('Tier 2 clearance complete');
    expect(availability(b, 'alice', 'tank')).toBeNull();
    expect(availability(b, 'alice', 'howitzer')).toBeNull();
    expect(availability(b, 'alice', 'jotun')).toContain('Tier 3');
    expect(availability(b, 'alice', 'jotun')).toContain('research station');
    expect(availability(b, 'alice', 'drone')).toContain('Air base');
    expect(researchAvailability(b, 'alice', 'clearance3')).toContain(
      'Research station',
    );
    place(b, 'lab');
    place(b, 'airfield');
    expect(availability(b, 'alice', 'drone')).toBeNull();
    expect(availability(b, 'alice', 'gunship')).toContain('Tier 3');
    research(b, 'alice', 'clearance3', 50000);
    tickBattle(b, 50000 + RESEARCH.clearance3.seconds * 1000);
    expect(tierOf(b, 'alice')).toBe(3);
    expect(availability(b, 'alice', 'jotun')).toBeNull();
    expect(availability(b, 'alice', 'gunship')).toBeNull();
    expect(researchAvailability(b, 'alice', 'clearance3')).toBe('Researched');
    expect(() => research(b, 'alice', 'clearance3', 101000)).toThrow(
      'Researched',
    );
  });
  test('research costs credits once, can be abandoned for a refund, and survives outage repair', () => {
    const price = RESEARCH.clearance2.cost;
    const b = setup(price + 100);
    expect(() => research(b, 'alice', 'clearance2', 1000)).not.toThrow();
    expect(b.commanders[0].credits).toBe(100);
    expect(cancelResearch(b, 'alice')).toBe(price);
    expect(b.commanders[0].credits).toBe(price + 100);
    expect(() => cancelResearch(b, 'alice')).toThrow('Nothing');
    b.commanders[0].credits = price - 1;
    expect(() => research(b, 'alice', 'clearance2', 1000)).toThrow('credits');
    expect(b.commanders[0].research).toEqual([]);
  });
  test('upgrades change harvesting, power and damage for their owner only', () => {
    const b = setup();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'ironclad' }, 1000);
    const reactor = place(b, 'reactor');
    const basePower = powerFor(b, 'alice').capacity;
    b.commanders[0].research = ['clearance2', 'turbines'];
    expect(powerFor(b, 'alice').capacity).toBe(basePower + 6);
    expect(powerFor(b, 'bob').capacity).toBe(TACTICAL_BUILDINGS.hq.provides);
    const ranger = own(b, 'ranger')[0],
      lynx = own(b, 'lynx')[0],
      bobTank = makeEntity(b, 'tank', 'bob', 'blue', at(0, 0)),
      redTank = makeEntity(b, 'tank', 'hostile', 'red', at(0, 0)),
      redRanger = makeEntity(b, 'ranger', 'hostile', 'red', at(0, 0));
    const plain = damageAgainst(b, ranger, redTank, TACTICAL_UNITS.ranger);
    expect(plain).toBeCloseTo(22 * 0.35);
    b.commanders[0].research.push('ammunition', 'shells', 'composite');
    expect(
      damageAgainst(b, ranger, redTank, TACTICAL_UNITS.ranger),
    ).toBeCloseTo(plain * 1.2);
    expect(damageAgainst(b, lynx, redRanger, TACTICAL_UNITS.lynx)).toBeCloseTo(
      36 * 1.25 * 1.2,
    );
    expect(damageAgainst(b, redTank, lynx, TACTICAL_UNITS.tank)).toBeCloseTo(
      90 * 0.8,
    );
    expect(damageAgainst(b, redTank, bobTank, TACTICAL_UNITS.tank)).toBe(90);
    expect(reactor.owner).toBe('alice');
    const harvester = makeEntity(b, 'harvester', 'alice', 'blue', at(-130, 43));
    b.entities.push(harvester);
    b.commanders[0].research.push('drills');
    tickBattle(b, 2000);
    expect(harvester.cargo).toBeCloseTo(45 * 1.5);
  });
  test('counters: rockets beat armor, artillery cannot fire close or at aircraft, aircraft ignore tanks', () => {
    const b = setup();
    // A quiet corner of the sector, away from the shore patrols.
    const rocket = makeEntity(b, 'rocket', 'alice', 'blue', at(-140, 118)),
      drone = makeEntity(b, 'drone', 'hostile', 'red', at(-140, 112));
    b.entities.push(rocket, drone);
    tickBattle(b, 2000);
    expect(drone.hp).toBeCloseTo(TACTICAL_UNITS.drone.hp - 34 * 1.2);
    drone.hp = 0;
    const tank = makeEntity(b, 'tank', 'hostile', 'red', at(-140, 128)),
      ally = makeEntity(b, 'drone', 'alice', 'blue', at(-140, 126));
    b.entities.push(tank, ally);
    tickBattle(b, 3000);
    expect(tank.hp).toBeCloseTo(TACTICAL_UNITS.tank.hp - 34 * 1.3 - 27 * 0.6);
    // The tank cannot hit the drone above it and fires at the rocket instead.
    expect(ally.hp).toBe(TACTICAL_UNITS.drone.hp);
    // The drone returned fire before it died; the tank fires at the only target it can hit.
    expect(rocket.hp).toBeCloseTo(TACTICAL_UNITS.rocket.hp - 27 - 90 * 0.55);
    const howitzer = makeEntity(b, 'howitzer', 'alice', 'blue', at(140, 90));
    const close = makeEntity(b, 'ranger', 'hostile', 'red', at(140, 96)),
      far = makeEntity(b, 'ranger', 'hostile', 'red', at(140, 120)),
      air = makeEntity(b, 'gunship', 'hostile', 'red', at(140, 110));
    b.entities.push(howitzer, close, far, air);
    tickBattle(b, 4000);
    expect(far.hp).toBeLessThan(TACTICAL_UNITS.ranger.hp);
    expect(air.hp).toBe(TACTICAL_UNITS.gunship.hp);
    expect(close.hp).toBe(TACTICAL_UNITS.ranger.hp);
    expect(howitzer.hp).toBeLessThan(TACTICAL_UNITS.howitzer.hp);
  });
});
describe('Base building without per-kind caps', () => {
  test('several plants, refineries, factories and defenses coexist, limited by credits, power and land', () => {
    const b = setup(100000);
    place(b, 'reactor');
    place(b, 'refinery');
    place(b, 'barracks');
    const spots = [
      ['reactor', -80, 46],
      ['reactor', -60, 50],
      ['refinery', -136, 80],
      ['factory', -110, 84],
      ['factory', -70, 90],
      ['turret', -84, 30],
      ['turret', -71, 42],
    ] as const;
    spots.forEach(([kind, x, z], i) => {
      // Five foundations at a time; the rest follow once the first batch completes.
      if (i === 5) tickBattle(b, 200000);
      purchase(b, 'alice', kind, i < 5 ? 1000 : 200000, {
        position: at(x, z),
        rotation: 2,
      });
    });
    expect(own(b, 'reactor')).toHaveLength(3);
    expect(own(b, 'refinery')).toHaveLength(2);
    expect(own(b, 'factory')).toHaveLength(2);
    expect(own(b, 'turret')).toHaveLength(2);
    expect(b.commanders[0].credits).toBe(
      100000 - 160 * 2 - 450 - 600 * 2 - 200 * 2,
    );
    expect(() =>
      purchase(b, 'alice', 'turret', 1000, {
        position: at(-84, 40),
        rotation: 2,
      }),
    ).toThrow('between structures');
    expect(() =>
      purchase(b, 'alice', 'turret', 1000, {
        position: at(-130, 46),
        rotation: 2,
      }),
    ).toThrow('ore field');
    b.commanders[0].credits = 100;
    expect(() =>
      purchase(b, 'alice', 'reactor', 1000, {
        position: at(-60, 46),
        rotation: 2,
      }),
    ).toThrow('credits');
  });
  test('a forward outpost extends the build perimeter and its sight, and expands the base outward', () => {
    const b = setup();
    const far = { position: at(-128, 4), rotation: 2 } as const;
    expect(placementError(b, 'alice', 'turret', far)).toContain('outpost');
    purchase(b, 'alice', 'outpost', 1000, site.outpost);
    expect(placementError(b, 'alice', 'turret', far)).toContain('outpost');
    tickBattle(b, 16000);
    expect(placementError(b, 'alice', 'turret', far)).toBeNull();
    expect(powerFor(b, 'alice').capacity).toBe(
      TACTICAL_BUILDINGS.hq.provides + TACTICAL_BUILDINGS.outpost.provides,
    );
    // A nearby patrol is revealed by the completed outpost's expanded sight.
    const guard = makeEntity(b, 'ranger', 'hostile', 'red', at(-128, 8));
    b.entities.push(guard);
    expect(visibleToBlue(guard, b.entities)).toBe(true);
  });
  test('selling refunds half for finished structures and everything for queued ones, never the HQ', () => {
    const b = setup(5000);
    const reactor = place(b, 'reactor');
    const id = purchase(b, 'alice', 'barracks', 1000, site.barracks) as string;
    expect(b.commanders[0].credits).toBe(4700);
    expect(sellStructure(b, 'alice', id, 2000)).toBe(300);
    expect(b.commanders[0].credits).toBe(5000);
    expect(sellStructure(b, 'alice', reactor.id, 2000)).toBe(80);
    expect(own(b, 'reactor')).toHaveLength(0);
    const hq = own(b, 'hq')[0];
    expect(() => sellStructure(b, 'alice', hq.id, 2000)).toThrow('cannot');
    expect(() => sellStructure(b, 'bob', hq.id, 2000)).toThrow('your');
    expect(b.events[0].text).toContain('sold');
  });
  test('rally points route new units, may only target land, and belong to production structures', () => {
    const b = setup();
    place(b, 'reactor');
    const barracks = place(b, 'barracks');
    expect(() => setRally(b, 'alice', barracks.id, { x: 40, z: 2 })).toThrow(
      'land',
    );
    expect(() => setRally(b, 'alice', own(b, 'hq')[0].id, at(-90, 40))).toThrow(
      'production',
    );
    setRally(b, 'alice', barracks.id, at(-90, 40));
    expect(barracks.rally).toEqual(at(-90, 40));
    // A troop tab sets the rally point of every building that trains the category.
    const second = makeEntity(b, 'barracks', 'alice', 'blue', at(-60, 20));
    b.entities.push(second);
    expect(setCategoryRally(b, 'alice', 'infantry', at(-80, 30))).toBe(2);
    expect(barracks.rally).toEqual(at(-80, 30));
    expect(second.rally).toEqual(at(-80, 30));
    expect(() => setCategoryRally(b, 'alice', 'air', at(-80, 30))).toThrow(
      'production structure',
    );
    b.entities.pop();
    setRally(b, 'alice', barracks.id, at(-90, 40));
    // Every structure that trains troops takes a rally point, not just the core three.
    for (const kind of ['camp', 'armory', 'depot', 'watchtower'] as const) {
      const producer = makeEntity(b, kind, 'alice', 'blue', at(-90, 20));
      b.entities.push(producer);
      setRally(b, 'alice', producer.id, at(-90, 40));
      expect(producer.rally).toEqual(at(-90, 40));
      b.entities.pop();
    }
    purchase(b, 'alice', 'ranger', 1000);
    tickBattle(b, 9000);
    const fresh = own(b, 'ranger').find((e) => e.order === 'move')!;
    expect(fresh).toBeDefined();
    expect(fresh.path.at(-1)).toEqual(at(-90, 40));
    // Later troops fan out around the rally point rather than piling onto it.
    const veterans = new Set(own(b, 'ranger').map((e) => e.id));
    veterans.delete(fresh.id);
    purchase(b, 'alice', 'ranger', 9000, undefined, 3);
    for (let t = 10000; t <= 60000; t += 1000) tickBattle(b, t);
    const rangers = own(b, 'ranger').filter((e) => !veterans.has(e.id));
    expect(rangers).toHaveLength(4);
    expect(rangers.every((e) => e.order === 'stop')).toBe(true);
    for (const a of rangers)
      for (const z of rangers)
        if (a !== z) expect(distance(a, z)).toBeGreaterThanOrEqual(2);
    expect(rangers.every((e) => distance(e, at(-90, 40)) <= 6)).toBe(true);
  });
});
describe('Convex research, selling and rally points', () => {
  const alice = 'a'.repeat(64),
    bob = 'b'.repeat(64);
  beforeEach(() => {
    // Fixed southern landing for these construction scenarios; generated geography has its own coverage.
    vi.spyOn(Math, 'random').mockReturnValue(1000 / 4294967296);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  test('research and sales are owner-only and persist; strangers and allies are rejected', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    const sectorId = await t.mutation(api.tactics.deploy, { token: alice });
    await t.mutation(api.tactics.deploy, { token: bob });
    await t.mutation(api.tactics.research, {
      token: alice,
      sectorId,
      key: 'clearance2',
    });
    let s = (await t.query(api.tactics.state, { token: alice }))!;
    expect(s.commanders[0].researching?.key).toBe('clearance2');
    expect(s.commanders[0].credits).toBe(
      STARTING_CREDITS - RESEARCH.clearance2.cost,
    );
    expect(s.deposits).toHaveLength(
      MAPS.fjordmouth.landings.length + MAPS.fjordmouth.ore.length + 1,
    );
    await expect(
      t.mutation(api.tactics.research, {
        token: bob,
        sectorId,
        key: 'clearance3',
      }),
    ).rejects.toThrow('Research station');
    await expect(
      t.mutation(api.tactics.research, {
        token: 'bad',
        sectorId,
        key: 'clearance2',
      }),
    ).rejects.toThrow('Reconnect');
    const start = Date.now();
    vi.setSystemTime(start + RESEARCH.clearance2.seconds * 1000 + 1000);
    await t.mutation(internal.tactics.tick, { id: sectorId, expected: start });
    s = (await t.query(api.tactics.state, { token: alice }))!;
    expect(s.commanders[0].research).toEqual(['clearance2']);
    expect(s.commanders[1].research).toEqual([]);
    await t.mutation(api.tactics.produce, {
      token: alice,
      sectorId,
      kind: 'outpost',
      placement: site.outpost,
    });
    s = (await t.query(api.tactics.state, { token: alice }))!;
    const outpost = s.entities.find((e) => e.kind === 'outpost')!;
    await expect(
      t.mutation(api.tactics.sell, { token: bob, sectorId, id: outpost.id }),
    ).rejects.toThrow('your structures');
    expect(
      await t.mutation(api.tactics.sell, {
        token: alice,
        sectorId,
        id: outpost.id,
      }),
    ).toBe(250);
    s = (await t.query(api.tactics.state, { token: alice }))!;
    expect(s.entities.some((e) => e.kind === 'outpost')).toBe(false);
    expect(
      await t
        .mutation(api.tactics.abandonResearch, { token: bob, sectorId })
        .catch((e: Error) => e.message),
    ).toContain('Nothing');
  });
  test('harvester orders are refused and rally points round-trip through the shared sector', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    const sectorId = await t.mutation(api.tactics.deploy, { token: alice });
    await t.run(async (ctx) => {
      const b = (await ctx.db.get(sectorId))!;
      const reactor = makeEntity(
        b,
        'reactor',
        b.commanders[0].id,
        'blue',
        site.reactor.position,
      );
      const barracks = makeEntity(
        b,
        'barracks',
        b.commanders[0].id,
        'blue',
        site.barracks.position,
      );
      const harvester = makeEntity(
        b,
        'harvester',
        b.commanders[0].id,
        'blue',
        at(-120, 50),
      );
      harvester.order = 'stop';
      await ctx.db.patch(sectorId, {
        entities: [...b.entities, reactor, barracks, harvester],
        serial: b.serial,
      });
    });
    let s = (await t.query(api.tactics.state, { token: alice }))!;
    const harvester = s.entities.find((e) => isHarvester(e.kind))!,
      barracks = s.entities.find((e) => e.kind === 'barracks')!,
      seam = s.deposits![0];
    await expect(
      t.mutation(api.tactics.command, {
        token: alice,
        sectorId,
        ids: [harvester.id],
        order: 'harvest',
        target: seam.id,
      }),
    ).rejects.toThrow(/on their own/);
    await t.mutation(api.tactics.rally, {
      token: alice,
      sectorId,
      id: barracks.id,
      point: at(-90, 40),
    });
    s = (await t.query(api.tactics.state, { token: alice }))!;
    expect(s.entities.find((e) => e.id === harvester.id)!.order).toBe('stop');
    expect(s.entities.find((e) => e.id === barracks.id)!.rally).toEqual(
      at(-90, 40),
    );
    expect(
      s.entities.filter((e) => e.team === 'blue' && isUnit(e.kind)),
    ).toHaveLength(4);
  });
});
