import { describe, expect, test } from 'vitest';
import { CULTURES, cultureKeys } from '../lib/cultures';
import {
  availability,
  buildingKinds,
  factionOf,
  inRoster,
  joinBattle,
  newBattle,
  purchase,
  rosterOf,
  signatureOf,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  tickBattle,
  unitKinds,
  type Battle,
} from '../lib/tactics';
import {
  BUILDING_FOOTPRINTS,
  PRODUCTION_EXITS,
} from '../lib/tactical-placement';
import { entityKind, unitKind } from '../convex/tacticalValues';
import { terrainFor } from '../lib/tactical-terrain';

/** Laid out around the old first landing at (-110, 62), kept relative to Alice's. */
const HOME = terrainFor({}).baseAt(0);
const at = (x: number, z: number) => ({
  x: x + 110 + HOME.x,
  z: z - 62 + HOME.z,
});
function battleWith(culture: string) {
  const b = newBattle(1000);
  joinBattle(b, { id: 'a', name: 'Alice', culture }, 1000);
  return b;
}
function run(b: Battle, from: number, seconds: number) {
  let now = from;
  for (let i = 0; i < seconds; i++) tickBattle(b, (now += 1000));
  return now;
}
const literals = (validator: unknown): string[] => {
  const v = validator as {
    kind: string;
    value?: string;
    members?: unknown[];
  };
  return v.kind === 'union'
    ? v.members!.flatMap(literals)
    : v.kind === 'literal'
      ? [v.value!]
      : [];
};

describe('Faction signature equipment', () => {
  test('every faction owns one structure and the two troops that train there', () => {
    for (const culture of cultureKeys) {
      const s = signatureOf(culture);
      expect(factionOf(s.structure)).toBe(culture);
      expect(
        (TACTICAL_BUILDINGS[s.structure] as { requires?: string }).requires,
      ).toBe('reactor');
      expect(s.troops).toHaveLength(2);
      for (const troop of s.troops) {
        expect(factionOf(troop)).toBe(culture);
        expect(TACTICAL_UNITS[troop].producer).toBe(s.structure);
      }
      expect(s.troops.map((t) => TACTICAL_UNITS[t].category).sort()).toEqual([
        'infantry',
        'vehicle',
      ]);
      expect(PRODUCTION_EXITS[s.structure]).toBeGreaterThan(0);
      expect(BUILDING_FOOTPRINTS[s.structure]).toBeDefined();
    }
    // ...plus one superweapon each.
    const bound = [...buildingKinds, ...unitKinds].filter(factionOf);
    expect(bound).toHaveLength(cultureKeys.length * 4);
  });

  test('a commander sees the shared roster plus only their own kit', () => {
    // The garrison's Weather Mast is on nobody's roster.
    const shared =
      buildingKinds.length + unitKinds.length - cultureKeys.length * 4 - 1;
    expect(rosterOf('neutral')).toHaveLength(shared);
    expect(rosterOf(undefined)).toHaveLength(shared);
    for (const culture of cultureKeys) {
      const roster = rosterOf(culture),
        s = signatureOf(culture);
      expect(roster).toHaveLength(shared + 4);
      expect(roster).toContain(s.structure);
      expect(roster).toContain(s.superweapon);
      expect(roster).not.toContain('weathermast');
      for (const troop of s.troops) expect(roster).toContain(troop);
      for (const other of cultureKeys.filter((c) => c !== culture))
        expect(roster).not.toContain(signatureOf(other).structure);
    }
  });

  test('other factions cannot build or train signature equipment', () => {
    const b = battleWith('ironclad');
    expect(inRoster(b, 'a', 'armory')).toBe(true);
    expect(inRoster(b, 'a', 'camp')).toBe(false);
    expect(availability(b, 'a', 'camp')).toBe(
      `${CULTURES.fjordborn.name} signature equipment`,
    );
    expect(availability(b, 'a', 'raider')).toBe(
      `${CULTURES.fjordborn.name} signature equipment`,
    );
    expect(() => purchase(b, 'a', 'raider', 1000)).toThrow(
      /Fjordborn signature equipment/,
    );
    expect(() =>
      purchase(b, 'a', 'depot', 1000, {
        position: at(-90, 78),
        rotation: 2,
      }),
    ).toThrow(/Hearthkin signature equipment/);
    // A commander's own kit is gated only by the ordinary tech tree.
    expect(availability(b, 'a', 'armory')).toBe(
      `Requires ${TACTICAL_BUILDINGS.reactor.name}`,
    );
    expect(availability(b, 'a', 'sapper')).toBe(
      `Requires ${TACTICAL_BUILDINGS.armory.name}`,
    );
    const neutral = battleWith('neutral');
    for (const culture of cultureKeys)
      expect(
        availability(neutral, 'a', signatureOf(culture).structure),
      ).toMatch(/signature equipment$/);
  });

  test('signature troops train at the faction structure and deploy from it', () => {
    const b = battleWith('ironclad');
    let now = 1000;
    purchase(b, 'a', 'reactor', now, {
      position: at(-88, 60),
      rotation: 2,
    });
    now = run(b, now, TACTICAL_BUILDINGS.reactor.seconds + 2);
    purchase(b, 'a', 'armory', now, {
      position: at(-90, 78),
      rotation: 2,
    });
    now = run(b, now, TACTICAL_BUILDINGS.armory.seconds + 2);
    expect(availability(b, 'a', 'sapper')).toBeNull();
    expect(availability(b, 'a', 'mortar')).toMatch(/Tier 2 clearance/);
    purchase(b, 'a', 'sapper', now);
    run(b, now, TACTICAL_UNITS.sapper.seconds + 3);
    const sapper = b.entities.find(
      (e) => e.owner === 'a' && e.kind === 'sapper' && !e.readyAt,
    );
    expect(sapper).toBeDefined();
    const armory = b.entities.find((e) => e.kind === 'armory')!;
    expect(Math.hypot(sapper!.x - armory.x, sapper!.z - armory.z)).toBeLessThan(
      30,
    );
  });

  test('Convex validators accept every unit and structure kind', () => {
    const units = literals(unitKind),
      entities = literals(entityKind);
    for (const kind of unitKinds) expect(units).toContain(kind);
    for (const kind of [...unitKinds, ...buildingKinds])
      expect(entities).toContain(kind);
  });
});
