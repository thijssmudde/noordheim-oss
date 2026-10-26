import { describe, expect, test } from 'vitest';
import {
  availability,
  damageAgainst,
  isUnit,
  joinBattle,
  makeEntity,
  newBattle,
  powerFor,
  sellStructure,
  signatureOf,
  speedScaleFor,
  SUPERWEAPON_HQ_CAP,
  SUPERWEAPONS,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  tickBattle,
  visibleTo,
  type Battle,
  type EntityKind,
  type Point,
} from '../lib/tactics';
import {
  blizzardTarget,
  chargeMs,
  chargeRemaining,
  launchSuperweapon,
  ownWeapon,
  scouted,
  superweaponNotices,
  superweaponOf,
  targetError,
} from '../lib/tactical-superweapons';
import { BattleAudioDirector, CUE_RULES } from '../lib/audio-policy';
import { FogGrid } from '../lib/tactical-fog';
import { cultureKeys } from '../lib/cultures';
import { DIFFICULTIES } from '../lib/tactical-difficulty';
import { terrainFor } from '../lib/tactical-terrain';
import { BUILDING_FOOTPRINTS } from '../lib/tactical-placement';
import { superweaponKind } from '../convex/tacticalValues';

/** A commander with Tier 3 clearance and a quiet garrison: only its command station stands. */
function setup(culture: string, difficulty: Battle['difficulty'] = 'normal') {
  const b = newBattle(1000, { seed: 947, difficulty });
  joinBattle(b, { id: 'a', name: 'Alice', culture }, 1000);
  b.commanders[0].research = ['clearance2', 'clearance3'];
  b.entities = b.entities.filter(
    (e) => e.team === 'blue' || e.kind === 'hq' || e.kind === 'weathermast',
  );
  b.hostileTraining = [];
  b.nextWaveAt = 1e12;
  return b;
}
const home = (b: Battle) => terrainFor(b).baseAt(b.commanders[0].slot);
const enemyHq = (b: Battle) =>
  b.entities.find((e) => e.team === 'red' && e.kind === 'hq')!;
function place(
  b: Battle,
  kind: EntityKind,
  p: Point,
  owner = 'a',
  team: 'blue' | 'red' = 'blue',
) {
  const e = makeEntity(b, kind, owner, team, p);
  b.entities.push(e);
  return e;
}
/** A completed superweapon beside the command station, with power to spare. */
function armed(culture: string, difficulty?: Battle['difficulty']) {
  const b = setup(culture, difficulty);
  const h = home(b);
  place(b, 'plant', { x: h.x - 24, z: h.z });
  const kind = superweaponOf(culture)!;
  const weapon = place(b, kind, { x: h.x + 24, z: h.z });
  tickBattle(b, 2000);
  return { b, weapon, kind };
}
function charge(b: Battle, now = b.tickAt) {
  const s = ownWeapon(b, 'a')!;
  s.charge = chargeMs(b, s.kind);
  return now;
}
function run(b: Battle, from: number, seconds: number, step = 250) {
  let now = from;
  for (let t = 0; t < seconds * 1000; t += step) tickBattle(b, (now += step));
  return now;
}
/** A friendly troop holding 30m from `p`: it sees the point but cannot shoot it. */
function spotter(b: Battle, p: Point, kind: EntityKind = 'ranger') {
  const e = place(b, kind, { x: p.x, z: p.z + 30 });
  e.order = 'hold';
  return e;
}

describe('Superweapon structures', () => {
  test('each faction owns exactly one Tier 3 superweapon, locked to it', () => {
    for (const culture of cultureKeys) {
      const kind = superweaponOf(culture)!;
      expect(signatureOf(culture).superweapon).toBe(kind);
      expect(TACTICAL_BUILDINGS[kind].tier).toBe(3);
      expect(TACTICAL_BUILDINGS[kind].cost).toBeGreaterThanOrEqual(2500);
      expect(TACTICAL_BUILDINGS[kind].cost).toBeLessThanOrEqual(3000);
      expect(TACTICAL_BUILDINGS[kind].power).toBeGreaterThanOrEqual(8);
      expect(BUILDING_FOOTPRINTS[kind]).toBeDefined();
      for (const other of cultureKeys.filter((c) => c !== culture))
        expect(availability(setup(other), 'a', kind)).toMatch(
          /signature equipment$/,
        );
    }
    expect(new Set(cultureKeys.map(superweaponOf)).size).toBe(4);
    const b = setup('ironclad');
    expect(availability(b, 'a', 'weathermast')).toBe(
      'Raised only by the garrison',
    );
  });

  test('Tier 3 clearance gates the superweapon, and each commander raises one', () => {
    const b = setup('ironclad');
    const h = home(b);
    place(b, 'lab', { x: h.x - 24, z: h.z + 20 });
    b.commanders[0].research = ['clearance2'];
    expect(availability(b, 'a', 'cannon')).toMatch(/Tier 3 clearance/);
    b.commanders[0].research = ['clearance2', 'clearance3'];
    expect(availability(b, 'a', 'cannon')).toBeNull();
    // A construction site already counts.
    const site = place(b, 'cannon', { x: h.x + 24, z: h.z });
    site.readyAt = 1e12;
    expect(availability(b, 'a', 'cannon')).toBe(
      'One superweapon per commander',
    );
  });

  test('Convex validators list every superweapon kind', () => {
    const literals = (
      superweaponKind as unknown as { members: { value: string }[] }
    ).members.map((m) => m.value);
    expect(literals.sort()).toEqual(Object.keys(SUPERWEAPONS).sort());
  });
});

describe('Charging', () => {
  test('charge starts when built, pauses on low power, warns a minute out and resets on launch', () => {
    const { b, kind } = armed('ironclad');
    const s = ownWeapon(b, 'a')!;
    expect(s.kind).toBe(kind);
    expect(
      b.events.some((e) => e.text === "Alice's Mountain Gun online. Charging."),
    ).toBe(true);
    // One second charged on completion, then a minute more.
    let now = run(b, 2000, 60, 1000);
    expect(s.charge).toBe(61000);
    // Raid the grid: the plant falls and the gun stops charging.
    b.entities = b.entities.filter((e) => e.kind !== 'plant');
    place(b, 'radar', { x: home(b).x - 24, z: home(b).z + 20 });
    expect(powerFor(b, 'a').used).toBeGreaterThan(powerFor(b, 'a').capacity);
    const before = s.charge;
    now = run(b, now, 30, 1000);
    expect(s.paused).toBe(true);
    expect(s.charge).toBe(before);
    // The countdown a client derives from its clock holds still too.
    expect(chargeRemaining(b, s, now + 20000)).toBe(chargeMs(b, kind) - before);
    place(b, 'plant', { x: home(b).x - 24, z: home(b).z });
    now = run(b, now, 1, 1000);
    expect(s.paused).toBe(false);
    expect(chargeRemaining(b, s, now + 5000)).toBe(
      chargeMs(b, kind) - s.charge - 5000,
    );
    // Run to a minute out: every commander gets the warning.
    s.charge = chargeMs(b, kind) - 61000;
    now = run(b, now, 2, 1000);
    expect(s.warned).toBe(true);
    expect(b.events.some((e) => e.text.includes('ready in 60 seconds'))).toBe(
      true,
    );
    expect(() => launchSuperweapon(b, 'a', enemyHq(b), now)).toThrow(
      /still charging/,
    );
    now = run(b, now, 60, 1000);
    expect(chargeRemaining(b, s)).toBe(0);
    expect(
      b.events.some((e) => e.text.includes('ready. Choose a target')),
    ).toBe(true);
    spotter(b, enemyHq(b));
    launchSuperweapon(b, 'a', enemyHq(b), now);
    expect(s.charge).toBe(0);
    expect(s.warned).toBe(false);
    expect(b.strikes).toHaveLength(1);
  });

  test('each superweapon is ready after exactly its powered charge time, and not before', () => {
    // About three minutes each, in this order.
    const charges = {
      boathouse: SUPERWEAPONS.boathouse.chargeSeconds,
      cannon: SUPERWEAPONS.cannon.chargeSeconds,
      airstrip: SUPERWEAPONS.airstrip.chargeSeconds,
      launcher: SUPERWEAPONS.launcher.chargeSeconds,
    };
    expect(charges).toEqual({
      boathouse: 195,
      cannon: 210,
      airstrip: 180,
      launcher: 200,
    });
    for (const culture of cultureKeys) {
      const { b, kind } = armed(culture);
      const s = ownWeapon(b, 'a')!;
      const seconds = charges[kind as keyof typeof charges];
      expect(chargeMs(b, kind)).toBe(seconds * 1000);
      s.charge = 0;
      let now = run(b, b.tickAt, seconds - 1, 1000);
      expect(chargeRemaining(b, s)).toBe(1000);
      now = run(b, now, 1, 1000);
      expect(chargeRemaining(b, s)).toBe(0);
      expect(s.charge).toBe(seconds * 1000);
    }
  });

  test('a superweapon lost or sold takes its charge with it', () => {
    const { b, weapon } = armed('hearthkin');
    run(b, 2000, 10, 1000);
    sellStructure(b, 'a', weapon.id, b.tickAt);
    tickBattle(b, b.tickAt + 1000);
    expect(b.superweapons!.filter((s) => s.team === 'blue')).toHaveLength(0);
    expect(b.events[0].text).toBe("Alice's Winter Convoy offline.");
  });
});

describe('Targeting', () => {
  test('a target must be in sight, except scouted ground for the Mountain Gun', () => {
    const { b } = armed('ashwalkers');
    const now = charge(b);
    const hq = enemyHq(b);
    expect(targetError(b, 'a', 'launcher', hq)).toMatch(/can see/);
    expect(() => launchSuperweapon(b, 'a', hq, now)).toThrow(/can see/);
    const gun = armed('ironclad').b;
    const target = enemyHq(gun);
    expect(targetError(gun, 'a', 'cannon', target)).toMatch(/scouted/);
    // A scout passes by and leaves: the gun remembers the ground.
    const scout = spotter(gun, target, 'fenrir');
    run(gun, gun.tickAt, 3, 1000);
    expect(scouted(gun, 'a', target)).toBe(true);
    gun.entities = gun.entities.filter((e) => e.id !== scout.id);
    expect(targetError(gun, 'a', 'cannon', target)).toBeNull();
    expect(targetError(gun, 'a', 'cannon', { x: 1e5, z: 0 })).toMatch(
      /inside the sector/,
    );
  });

  test('every strike is telegraphed before it lands', () => {
    const { b } = armed('ironclad');
    const hq = enemyHq(b);
    spotter(b, hq);
    let now = charge(b);
    launchSuperweapon(b, 'a', hq, now);
    const hp = hq.hp;
    now = run(b, now, SUPERWEAPONS.cannon.telegraphSeconds - 0.5);
    expect(hq.hp).toBe(hp);
    expect(b.strikes![0].landed).toBeUndefined();
    run(b, now, 1);
    expect(b.strikes![0].landed).toBe(true);
    expect(hq.hp).toBeLessThan(hp);
  });
});

describe('Effects', () => {
  test('Mountain Gun: heavy damage falling off to the rim, never on the coalition, capped on a command station', () => {
    const { b } = armed('ironclad');
    const hq = enemyHq(b);
    const target = { x: hq.x, z: hq.z };
    const near = place(b, 'plant', { x: hq.x + 22, z: hq.z }, hq.owner, 'red');
    spotter(b, target);
    const ally = place(b, 'reactor', { x: hq.x - 12, z: hq.z });
    const now = charge(b);
    launchSuperweapon(b, 'a', target, now);
    run(b, now, SUPERWEAPONS.cannon.telegraphSeconds + 0.5);
    expect(hq.hp).toBeCloseTo(
      TACTICAL_BUILDINGS.hq.hp * (1 - SUPERWEAPON_HQ_CAP),
      0,
    );
    const { damage, edge, radius } = SUPERWEAPONS.cannon;
    expect(TACTICAL_BUILDINGS.plant.hp - near.hp).toBeCloseTo(
      damage * (1 - ((1 - edge) * 22) / radius),
      -1,
    );
    expect(ally.hp).toBe(TACTICAL_BUILDINGS.reactor.hp);
  });

  test('Skerry Strike: a veteran raiding party comes ashore at the target', () => {
    const { b } = armed('fjordborn');
    const h = home(b);
    const target = { x: h.x, z: h.z - 40 };
    spotter(b, target);
    const now = charge(b);
    launchSuperweapon(b, 'a', target, now);
    run(b, now, SUPERWEAPONS.boathouse.telegraphSeconds + 0.5);
    const party = b.entities.filter((e) => e.veteran);
    const kinds = party.map((e) => e.kind).sort();
    expect(kinds).toEqual(
      Object.entries(SUPERWEAPONS.boathouse.party)
        .flatMap(([k, n]) => Array<string>(n).fill(k))
        .sort(),
    );
    for (const e of party) {
      expect(e.owner).toBe('a');
      expect(Math.hypot(e.x - target.x, e.z - target.z)).toBeLessThan(28);
      expect(terrainFor(b).groundAt(e.x, e.z)).toBe(true);
    }
    // Veterans hit harder and take less.
    const red = makeEntity(b, 'ranger', 'r', 'red', target);
    expect(damageAgainst(b, party[0], red, TACTICAL_UNITS.raider)).toBeCloseTo(
      TACTICAL_UNITS.raider.damage *
        TACTICAL_UNITS.raider.versus.infantry *
        SUPERWEAPONS.boathouse.veteranDamage,
    );
    expect(damageAgainst(b, red, party[0], TACTICAL_UNITS.ranger)).toBeCloseTo(
      TACTICAL_UNITS.ranger.damage * SUPERWEAPONS.boathouse.veteranArmor,
    );
  });

  test('Winter Convoy: full repairs, credits and a speed and fire-rate boost for the coalition', () => {
    const { b } = armed('hearthkin');
    const h = home(b);
    const tank = place(b, 'tank', { x: h.x, z: h.z - 20 });
    const ally = makeEntity(b, 'lynx', 'b', 'blue', {
      x: h.x + 6,
      z: h.z - 20,
    });
    joinBattle(b, { id: 'b', name: 'Bob', culture: 'fjordborn' }, b.tickAt);
    b.entities.push(ally);
    tank.hp = 200;
    ally.hp = 100;
    const hq = b.entities.find((e) => e.owner === 'a' && e.kind === 'hq')!;
    hq.hp = 900;
    const credits = b.commanders[0].credits;
    const plain = speedScaleFor(b, tank);
    const now = charge(b);
    launchSuperweapon(b, 'a', { x: h.x, z: h.z - 12 }, now);
    run(b, now, SUPERWEAPONS.airstrip.telegraphSeconds + 0.25);
    expect(tank.hp).toBe(TACTICAL_UNITS.tank.hp);
    expect(ally.hp).toBe(TACTICAL_UNITS.lynx.hp);
    expect(hq.hp).toBe(TACTICAL_BUILDINGS.hq.hp);
    expect(b.commanders[0].credits).toBeGreaterThanOrEqual(
      credits + SUPERWEAPONS.airstrip.credits,
    );
    expect(speedScaleFor(b, tank)).toBeCloseTo(
      plain * SUPERWEAPONS.airstrip.boost,
    );
    const red = makeEntity(b, 'tank', 'r', 'red', tank);
    expect(damageAgainst(b, tank, red, TACTICAL_UNITS.tank)).toBeCloseTo(
      TACTICAL_UNITS.tank.damage * SUPERWEAPONS.airstrip.boost,
    );
    run(b, b.tickAt, SUPERWEAPONS.airstrip.boostSeconds + 1, 1000);
    expect(tank.boostUntil).toBeUndefined();
    expect(speedScaleFor(b, tank)).toBeCloseTo(plain);
  });

  test('Firestorm: reveals a wide area, burns it over time and bogs hostile infantry down', () => {
    const { b } = armed('ashwalkers');
    const rules = SUPERWEAPONS.launcher;
    // A headless garrison raises no troops to muddle the arithmetic.
    const hq = enemyHq(b);
    const target = { x: hq.x, z: hq.z };
    b.entities = b.entities.filter((e) => e !== hq);
    const depot = place(b, 'plant', target, hq.owner, 'red');
    const eye = spotter(b, target);
    const infantry = place(
      b,
      'ranger',
      { x: hq.x - 14, z: hq.z - 14 },
      hq.owner,
      'red',
    );
    infantry.order = 'hold';
    const far = place(b, 'reactor', { x: hq.x + 56, z: hq.z }, hq.owner, 'red');
    const ally = place(b, 'ranger', { x: hq.x + 14, z: hq.z + 14 });
    ally.order = 'hold';
    let now = charge(b);
    launchSuperweapon(b, 'a', target, now);
    // The spotter leaves; the fire keeps the ground lit.
    b.entities = b.entities.filter((e) => e.id !== eye.id);
    expect(visibleTo('a', far, b.entities, b)).toBe(false);
    now = run(b, now, rules.telegraphSeconds + 0.25);
    expect(visibleTo('a', far, b.entities, b)).toBe(true);
    // The barrage, then the first quarter second of fire.
    const struck = TACTICAL_BUILDINGS.plant.hp - depot.hp;
    expect(struck).toBeGreaterThanOrEqual(rules.damage);
    expect(struck).toBeLessThanOrEqual(rules.damage + rules.burnDps * 0.25);
    expect(speedScaleFor(b, infantry)).toBeCloseTo(rules.infantrySlow);
    expect(speedScaleFor(b, ally)).toBeCloseTo(1);
    now = run(b, now, 10, 1000);
    expect(TACTICAL_BUILDINGS.plant.hp - depot.hp - struck).toBeCloseTo(
      rules.burnDps * 10,
      0,
    );
    expect(ally.hp).toBe(TACTICAL_UNITS.ranger.hp);
    run(b, now, rules.revealSeconds, 1000);
    expect(visibleTo('a', far, b.entities, b)).toBe(false);
    expect(b.strikes).toHaveLength(0);
  });

  test('the command station cap holds across a burning strike', () => {
    const { b } = armed('ashwalkers');
    const hq = enemyHq(b);
    spotter(b, hq);
    // A station already burnt down by a third keeps 30% of the strike's reach.
    let now = charge(b);
    launchSuperweapon(b, 'a', hq, now);
    now = run(b, now, SUPERWEAPONS.launcher.telegraphSeconds + 0.25);
    const at = hq.hp;
    // Make the burn lethal: the cap, not the fire, decides.
    (SUPERWEAPONS.launcher as { burnDps: number }).burnDps = 500;
    try {
      run(b, now, 20, 1000);
    } finally {
      (SUPERWEAPONS.launcher as { burnDps: number }).burnDps = 30;
    }
    expect(at).toBeLessThan(TACTICAL_BUILDINGS.hq.hp);
    expect(hq.hp).toBeCloseTo(
      TACTICAL_BUILDINGS.hq.hp * (1 - SUPERWEAPON_HQ_CAP),
      0,
    );
  });
});

describe('The garrison Weather Mast', () => {
  test('raised beside every hostile station from Normal up, none on Easy', () => {
    for (const difficulty of ['easy', 'normal', 'brutal'] as const) {
      const b = newBattle(1000, { seed: 947, difficulty, enemyCount: 2 });
      const masts = b.entities.filter((e) => e.kind === 'weathermast');
      expect(masts).toHaveLength(DIFFICULTIES[difficulty].mast ? 2 : 0);
      expect(b.superweapons ?? []).toHaveLength(masts.length);
      for (const m of masts) expect(m.team).toBe('red');
    }
    expect(chargeMs({ difficulty: 'brutal' }, 'weathermast')).toBeLessThan(
      chargeMs({ difficulty: 'normal' }, 'weathermast'),
    );
  });

  test('charges on its own, aims at the strongest allied cluster and freezes it', () => {
    const b = setup('fjordborn');
    const h = home(b);
    const lone = place(b, 'ranger', { x: h.x + 60, z: h.z - 30 });
    const column = [0, 1, 2, 3, 4].map((i) =>
      place(b, 'tank', { x: h.x - 10 + i * 4, z: h.z - 30 }),
    );
    for (const e of [lone, ...column]) e.order = 'hold';
    // The tank column outweighs a lone patrol.
    const target = blizzardTarget(b)!;
    expect(
      Math.hypot(target.x - (h.x - 2), target.z - (h.z - 30)),
    ).toBeLessThan(15);
    const mast = b.superweapons!.find((s) => s.team === 'red')!;
    expect(mast.kind).toBe('weathermast');
    // It charges whatever the garrison's power.
    let now = run(b, 1000, 10, 1000);
    expect(mast.charge).toBeCloseTo(10000, -3);
    mast.charge = chargeMs(b, 'weathermast') - 500;
    now = run(b, now, 1, 1000);
    expect(b.strikes).toHaveLength(1);
    expect(b.strikes![0]).toMatchObject({ team: 'red', kind: 'weathermast' });
    expect(mast.charge).toBeLessThan(2000);
    now = run(b, now, SUPERWEAPONS.weathermast.telegraphSeconds + 0.5);
    for (const tank of column) {
      expect(tank.frozenUntil).toBeGreaterThan(now);
      expect(tank.hp).toBeLessThan(TACTICAL_UNITS.tank.hp);
    }
    expect(lone.frozenUntil).toBeUndefined();
    // A frozen troop neither moves nor fires.
    const tank = column[0];
    const enemy = place(b, 'ranger', { x: tank.x, z: tank.z - 8 }, 'r', 'red');
    enemy.order = 'hold';
    const hp = enemy.hp;
    tank.path = [{ x: tank.x, z: tank.z + 30 }];
    tank.order = 'move';
    const at = { x: tank.x, z: tank.z };
    now = run(b, now, 2, 250);
    expect(enemy.hp).toBe(hp);
    expect(tank.x).toBe(at.x);
    expect(tank.z).toBe(at.z);
    run(b, now, SUPERWEAPONS.weathermast.freezeSeconds, 1000);
    expect(tank.frozenUntil).toBeUndefined();
  });

  test('the blizzard never touches the garrison, and destroying the mast stops it', () => {
    const b = setup('fjordborn');
    // Only the allied base stands; a garrison shed sits right inside it.
    b.entities = b.entities.filter((e) => e.team === 'red' || !isUnit(e.kind));
    const h = home(b);
    const shed = place(
      b,
      'reactor',
      { x: h.x + 14, z: h.z },
      'hostile-1',
      'red',
    );
    const mast = b.superweapons!.find((s) => s.team === 'red')!;
    mast.charge = chargeMs(b, 'weathermast');
    run(b, 1000, SUPERWEAPONS.weathermast.telegraphSeconds + 1, 1000);
    const hq = b.entities.find((e) => e.owner === 'a' && e.kind === 'hq')!;
    expect(hq.hp).toBeLessThan(TACTICAL_BUILDINGS.hq.hp);
    expect(shed.hp).toBe(TACTICAL_BUILDINGS.reactor.hp);
    const structure = b.entities.find((e) => e.id === mast.id)!;
    structure.hp = 0;
    tickBattle(b, b.tickAt + 1000);
    expect(b.superweapons!.some((s) => s.id === mast.id)).toBe(false);
    expect(b.events.some((e) => /Weather Mast destroyed/.test(e.text))).toBe(
      true,
    );
  });
});

describe('Global warnings', () => {
  test('every commander is warned when a weapon is built, a minute from ready and launched, on existing voice cues', () => {
    const { b } = armed('ironclad');
    joinBattle(b, { id: 'b', name: 'Bob', culture: 'hearthkin' }, b.tickAt);
    const snapshot = () => structuredClone(b);
    const empty = { ...snapshot(), superweapons: [], strikes: [] };
    const built = superweaponNotices(empty, snapshot(), 'b');
    expect(built.map((n) => [n.kind, n.team, n.text])).toContainEqual([
      'built',
      'blue',
      "Alice's Mountain Gun online",
    ]);
    const s = ownWeapon(b, 'a')!;
    s.charge = chargeMs(b, 'cannon') - 61000;
    let before = snapshot();
    let now = run(b, b.tickAt, 2, 1000);
    expect(superweaponNotices(before, snapshot(), 'b')).toMatchObject([
      { kind: 'warning', text: "Alice's Mountain Gun ready in 60 s" },
    ]);
    now = run(b, now, 60, 1000);
    before = snapshot();
    spotter(b, enemyHq(b));
    launchSuperweapon(b, 'a', enemyHq(b), now);
    const launched = superweaponNotices(before, snapshot(), 'b');
    expect(launched).toMatchObject([{ kind: 'launch', team: 'blue' }]);
    // The garrison's mast warns with hostile cues.
    const mast = b.superweapons!.find((m) => m.team === 'red')!;
    mast.charge = chargeMs(b, 'weathermast') - 61000;
    before = snapshot();
    run(b, now, 2, 1000);
    const hostile = superweaponNotices(before, snapshot(), 'b');
    expect(hostile).toMatchObject([
      { kind: 'warning', team: 'red', cue: 'wave' },
    ]);
    for (const n of [...built, ...launched, ...hostile])
      if (n.cue) expect(n.cue in CUE_RULES).toBe(true);
  });
});

test('superweapon structures stay out of everyone else`s way', () => {
  const b = newBattle(1000, { seed: 947, difficulty: 'brutal', enemyCount: 2 });
  for (const mast of b.entities.filter((e) => e.kind === 'weathermast'))
    expect(
      b.entities.filter(
        (e) =>
          !isUnit(e.kind) &&
          e.id !== mast.id &&
          Math.hypot(e.x - mast.x, e.z - mast.z) < 6,
      ),
    ).toHaveLength(0);
});

test('the commander hears the garrison mast a minute out, and a Firestorm lights the fog', () => {
  const b = { ...setup('ashwalkers'), id: 'sector' };
  const director = new BattleAudioDirector();
  director.update(structuredClone(b), 'a');
  const mast = b.superweapons!.find((s) => s.team === 'red')!;
  mast.charge = chargeMs(b, 'weathermast') - 61000;
  tickBattle(b, b.tickAt + 2000);
  expect(director.update(structuredClone(b), 'a').cues).toContain('wave');
  const fog = new FogGrid(null, terrainFor(b).bounds);
  const far = enemyHq(b);
  fog.update(b.entities, 'a', 1);
  expect(fog.sight(far)).toBe('hidden');
  fog.update(b.entities, 'a', 1, 1, [{ x: far.x, z: far.z, radius: 20 }]);
  expect(fog.sight(far)).toBe('visible');
});
