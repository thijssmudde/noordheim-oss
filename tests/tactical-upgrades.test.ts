import { describe, expect, test } from 'vitest';
import {
  attackFor,
  AURA_RADIUS,
  availability,
  buildingKinds,
  damageAgainst,
  harvesterCapacity,
  joinBattle,
  makeEntity,
  newBattle,
  powerFor,
  RESEARCH,
  RESEARCH_TIERS,
  researchKeys,
  speedScaleFor,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  tickBattle,
  visionOf,
  visionScaleFor,
  type ResearchKey,
} from '../lib/tactics';
import { veterancyFor } from '../lib/tactical-difficulty';

/** Alice holds every clearance; Bob researches nothing, so each effect is owner-scoped. */
function battle(research: ResearchKey[] = []) {
  const b = newBattle(1000, { seed: 5 });
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
  joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
  const alice = b.commanders[0];
  alice.research = ['clearance2', 'clearance3', ...research];
  return { b, alice };
}
const red = (
  b: ReturnType<typeof battle>['b'],
  kind: 'ranger' | 'tank' | 'drone' | 'rocket',
) => makeEntity(b, kind, 'hostile-1', 'red', { x: 0, z: 0 });

describe('Research tree', () => {
  test('is a focused dozen across three tiers, priced steeply', () => {
    const listed = Object.values(RESEARCH_TIERS).flat();
    expect([...listed].sort()).toEqual([...researchKeys].sort());
    expect(listed.length).toBe(12);
    for (const [tier, keys] of Object.entries(RESEARCH_TIERS))
      for (const key of keys) expect(RESEARCH[key].tier).toBe(Number(tier));
    for (const key of researchKeys)
      expect(RESEARCH[key].cost).toBeGreaterThanOrEqual(700);
    for (const key of researchKeys) {
      const requires = (RESEARCH[key] as { requires?: string }).requires;
      if (requires) expect(researchKeys).toContain(requires);
    }
  });

  test('cargo, speed and power effects apply to the owner only', () => {
    const { b } = battle(['logistics', 'avionics', 'turbines']);
    expect(harvesterCapacity(b, 'alice')).toBe(600);
    expect(harvesterCapacity(b, 'bob')).toBe(500);
    const unit = (kind: 'harvester' | 'ranger' | 'drone', owner: string) => ({
      kind,
      owner,
    });
    expect(speedScaleFor(b, unit('harvester', 'alice'))).toBeCloseTo(1.15);
    expect(speedScaleFor(b, unit('drone', 'alice'))).toBeCloseTo(1.15);
    expect(speedScaleFor(b, unit('ranger', 'alice'))).toBe(1);
    expect(speedScaleFor(b, unit('harvester', 'bob'))).toBe(1);
    expect(visionScaleFor(b, 'alice')).toBe(1);
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    b.entities.push(
      makeEntity(b, 'reactor', 'alice', 'blue', { x: hq.x + 20, z: hq.z }),
    );
    b.entities.push(
      makeEntity(b, 'reactor', 'bob', 'blue', { x: hq.x + 40, z: hq.z }),
    );
    expect(powerFor(b, 'alice').capacity).toBe(
      TACTICAL_BUILDINGS.hq.provides! + 12 + 6,
    );
    expect(powerFor(b, 'bob').capacity).toBe(
      TACTICAL_BUILDINGS.hq.provides! + 12,
    );
  });

  test('plates, sabots and avionics change the counter matrix for the owner', () => {
    const { b } = battle([
      'plates',
      'uranium',
      'avionics',
      'shells',
      'ammunition',
    ]);
    const ranger = makeEntity(b, 'ranger', 'alice', 'blue', { x: 0, z: 0 }),
      bobRanger = makeEntity(b, 'ranger', 'bob', 'blue', { x: 0, z: 0 }),
      tank = makeEntity(b, 'tank', 'alice', 'blue', { x: 0, z: 0 }),
      drone = makeEntity(b, 'drone', 'alice', 'blue', { x: 0, z: 0 });
    const redRanger = red(b, 'ranger'),
      redTank = red(b, 'tank'),
      redRocket = red(b, 'rocket');
    expect(
      damageAgainst(b, redRanger, ranger, TACTICAL_UNITS.ranger),
    ).toBeCloseTo(22 * 0.8);
    expect(
      damageAgainst(b, redRanger, bobRanger, TACTICAL_UNITS.ranger),
    ).toBeCloseTo(22);
    expect(
      damageAgainst(b, redRocket, drone, TACTICAL_UNITS.rocket),
    ).toBeCloseTo(34 * 1.2 * 0.8);
    expect(damageAgainst(b, tank, redTank, TACTICAL_UNITS.tank)).toBeCloseTo(
      90 * 1.2 * 1.25,
    );
    expect(damageAgainst(b, tank, redRanger, TACTICAL_UNITS.tank)).toBeCloseTo(
      90 * 0.55 * 1.2,
    );
  });

  test('ballistic computers extend artillery range but nothing else', () => {
    const { b } = battle(['ballistics']);
    const howitzer = makeEntity(b, 'howitzer', 'alice', 'blue', { x: 0, z: 0 }),
      battery = makeEntity(b, 'battery', 'alice', 'blue', { x: 0, z: 0 }),
      tank = makeEntity(b, 'tank', 'alice', 'blue', { x: 0, z: 0 }),
      bobHowitzer = makeEntity(b, 'howitzer', 'bob', 'blue', { x: 0, z: 0 });
    expect(attackFor(b, howitzer)!.range).toBeCloseTo(38 * 1.15);
    expect(attackFor(b, howitzer)!.minRange).toBe(12);
    expect(attackFor(b, battery)!.range).toBeCloseTo(40 * 1.15);
    expect(attackFor(b, tank)!.range).toBe(22);
    expect(attackFor(b, bobHowitzer)!.range).toBe(38);
  });
});

describe('Expansion structures', () => {
  test('six shared structures join the tree with their own gates', () => {
    for (const kind of [
      'bunker',
      'hospital',
      'flak',
      'radar',
      'plant',
      'workshop',
    ] as const)
      expect(buildingKinds).toContain(kind);
    const b = newBattle(1000, { seed: 5 });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    expect(availability(b, 'alice', 'bunker')).toContain('Jæger hall');
    expect(availability(b, 'alice', 'hospital')).toContain('Jæger hall');
    b.entities.push(
      makeEntity(b, 'barracks', 'alice', 'blue', { x: hq.x + 20, z: hq.z }),
    );
    expect(availability(b, 'alice', 'bunker')).toBeNull();
    expect(availability(b, 'alice', 'hospital')).toBeNull();
    expect(availability(b, 'alice', 'flak')).toContain('Vehicle works');
    b.entities.push(
      makeEntity(b, 'factory', 'alice', 'blue', { x: hq.x - 20, z: hq.z }),
    );
    expect(availability(b, 'alice', 'flak')).toContain('Tier 2');
    expect(availability(b, 'alice', 'plant')).toContain('Geothermal');
    b.commanders[0].research = ['clearance2'];
    for (const kind of ['flak', 'radar', 'workshop'] as const)
      expect(availability(b, 'alice', kind)).toBeNull();
    // The bunker shreds infantry and ignores aircraft; the flak tower is the reverse.
    const bunker = TACTICAL_BUILDINGS.bunker.attack,
      flak = TACTICAL_BUILDINGS.flak.attack;
    expect(bunker.versus.infantry).toBeGreaterThan(1);
    expect(bunker.versus.air).toBe(0);
    expect(flak.versus.air).toBeGreaterThan(1);
    expect(flak.versus.structure).toBe(0);
    expect(visionOf('radar')).toBeGreaterThan(visionOf('outpost'));
    expect(TACTICAL_BUILDINGS.plant.provides).toBeGreaterThan(
      TACTICAL_BUILDINGS.reactor.provides!,
    );
  });

  test('the aid station and field workshop restore idle troops standing beside them', () => {
    const b = newBattle(1000, { seed: 4 });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    const [idle, marching] = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    );
    const lynx = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'lynx',
    )!;
    const bobRanger = b.entities.find(
      (e) => e.owner === 'bob' && e.kind === 'ranger',
    )!;
    // Nothing recovers without the structures.
    idle.hp = marching.hp = bobRanger.hp = 50;
    lynx.hp = 100;
    tickBattle(b, 2000);
    expect(idle.hp).toBe(50);
    expect(lynx.hp).toBe(100);
    b.entities.push(
      makeEntity(b, 'hospital', 'alice', 'blue', {
        x: idle.x,
        z: idle.z - AURA_RADIUS + 4,
      }),
    );
    b.entities.push(
      makeEntity(b, 'workshop', 'alice', 'blue', {
        x: lynx.x + 10,
        z: lynx.z - 8,
      }),
    );
    marching.order = 'move';
    marching.path = [{ x: marching.x, z: marching.z - 40 }];
    tickBattle(b, 3000);
    expect(idle.hp).toBeCloseTo(50 + 160 * 0.03);
    expect(lynx.hp).toBeCloseTo(100 + 460 * 0.02);
    expect(marching.hp).toBe(50);
    // Bob's patrol stands far from the aid station and stays hurt.
    expect(bobRanger.hp).toBe(50);
    // A site still under construction heals nobody; recovery never exceeds full health.
    idle.hp = 159.9;
    tickBattle(b, 5000);
    expect(idle.hp).toBe(160);
    // Troops that arrived by attack-move keep that order, and still recover.
    idle.hp = 50;
    idle.order = 'attackMove';
    idle.path = [];
    tickBattle(b, 6000);
    expect(idle.hp).toBeCloseTo(50 + 160 * 0.03);
  });
});

describe('Hostile veterancy', () => {
  test('columns launched raise hostile damage on the harder settings, capped at half again', () => {
    expect(veterancyFor({ difficulty: 'easy', wave: 20 })).toBe(1);
    expect(veterancyFor({ difficulty: 'normal', wave: 5 })).toBeCloseTo(1.15);
    expect(veterancyFor({ difficulty: 'hard', wave: 4 })).toBeCloseTo(1.2);
    expect(veterancyFor({ difficulty: 'brutal', wave: 100 })).toBe(1.5);
    const { b } = battle();
    b.difficulty = 'hard';
    b.wave = 4;
    const bobRanger = b.entities.find(
      (e) => e.owner === 'bob' && e.kind === 'ranger',
    )!;
    expect(
      damageAgainst(b, red(b, 'ranger'), bobRanger, TACTICAL_UNITS.ranger),
    ).toBeCloseTo(22 * 1.2);
    // Allied fire is unaffected by the enemy's veterancy.
    expect(
      damageAgainst(b, bobRanger, red(b, 'ranger'), TACTICAL_UNITS.ranger),
    ).toBeCloseTo(22);
  });
});
