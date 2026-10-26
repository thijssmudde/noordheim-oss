import { describe, expect, test } from 'vitest';
import {
  CULTURES,
  cultureKeys,
  doctrineOf,
  NEUTRAL_DOCTRINE,
} from '../lib/cultures';
import {
  buildSeconds,
  damageAgainst,
  EARLY_BUILD_SCALE,
  doctrineFor,
  harvesterCapacity,
  joinBattle,
  makeEntity,
  newBattle,
  priceOf,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  visionOf,
} from '../lib/tactics';

function battleWith(culture: string) {
  const b = newBattle(1000);
  joinBattle(b, { id: 'c', name: 'Commander', culture }, 1000);
  return b;
}
const roundedToFive = (value: number) => Math.round(value / 5) * 5;

describe('Faction doctrines', () => {
  test('unknown and legacy cultures play by the neutral rules', () => {
    expect(doctrineOf('neutral')).toBe(NEUTRAL_DOCTRINE);
    expect(doctrineOf(undefined)).toBe(NEUTRAL_DOCTRINE);
    const b = battleWith('neutral');
    expect(doctrineFor(b, 'garrison')).toBe(NEUTRAL_DOCTRINE);
    expect(priceOf(b, 'c', 'reactor')).toBe(TACTICAL_BUILDINGS.reactor.cost);
    expect(priceOf(b, 'c', 'ranger')).toBe(TACTICAL_UNITS.ranger.cost);
    expect(buildSeconds(b, 'c', 'ranger')).toBe(TACTICAL_UNITS.ranger.seconds);
    expect(buildSeconds(b, 'c', 'reactor')).toBe(
      Math.round(TACTICAL_BUILDINGS.reactor.seconds * EARLY_BUILD_SCALE),
    );
    expect(harvesterCapacity(b, 'c')).toBe(TACTICAL_UNITS.harvester.cargo);
  });

  test('Fjordborn muster troops faster and move faster, at the same prices', () => {
    const b = battleWith('fjordborn');
    expect(buildSeconds(b, 'c', 'ranger')).toBe(
      Math.round(TACTICAL_UNITS.ranger.seconds * 0.8),
    );
    expect(buildSeconds(b, 'c', 'reactor')).toBe(
      Math.round(TACTICAL_BUILDINGS.reactor.seconds * EARLY_BUILD_SCALE),
    );
    expect(doctrineFor(b, 'c').speed).toBe(1.1);
    expect(priceOf(b, 'c', 'ranger')).toBe(TACTICAL_UNITS.ranger.cost);
    expect(priceOf(b, 'c', 'reactor')).toBe(TACTICAL_BUILDINGS.reactor.cost);
  });

  test('Ironclad pay less for structures and their defenses hit harder', () => {
    const b = battleWith('ironclad'),
      neutral = battleWith('neutral');
    expect(priceOf(b, 'c', 'reactor')).toBe(
      roundedToFive(TACTICAL_BUILDINGS.reactor.cost * 0.85),
    );
    expect(priceOf(b, 'c', 'ranger')).toBe(TACTICAL_UNITS.ranger.cost);
    const shot = (battle: typeof b, attacker: 'turret' | 'tank') =>
      damageAgainst(
        battle,
        makeEntity(battle, attacker, 'c', 'blue', { x: 0, z: 0 }),
        makeEntity(battle, 'ranger', 'garrison', 'red', { x: 6, z: 0 }),
        TACTICAL_BUILDINGS.turret.attack!,
      );
    expect(shot(b, 'turret')).toBeCloseTo(shot(neutral, 'turret') * 1.2);
    expect(shot(b, 'tank')).toBeCloseTo(shot(neutral, 'tank'));
  });

  test('Hearthkin harvesters carry more ore per trip', () => {
    expect(harvesterCapacity(battleWith('hearthkin'), 'c')).toBe(
      Math.round(TACTICAL_UNITS.harvester.cargo! * 1.3),
    );
    expect(doctrineFor(battleWith('hearthkin'), 'c').load).toBe(1.2);
  });

  test('Ashwalkers see further and field cheaper infantry only', () => {
    const b = battleWith('ashwalkers');
    expect(visionOf('ranger', doctrineFor(b, 'c').vision)).toBeCloseTo(
      visionOf('ranger') * 1.3,
    );
    expect(priceOf(b, 'c', 'ranger')).toBe(
      roundedToFive(TACTICAL_UNITS.ranger.cost * 0.85),
    );
    expect(priceOf(b, 'c', 'lynx')).toBe(TACTICAL_UNITS.lynx.cost);
    expect(priceOf(b, 'c', 'reactor')).toBe(TACTICAL_BUILDINGS.reactor.cost);
  });

  test('every faction advertises exactly the rules it bends', () => {
    for (const key of cultureKeys) {
      const doctrine = CULTURES[key].doctrine;
      const bent = (Object.keys(NEUTRAL_DOCTRINE) as (keyof typeof doctrine)[])
        .filter((rule) => typeof NEUTRAL_DOCTRINE[rule] === 'number')
        .filter((rule) => doctrine[rule] !== NEUTRAL_DOCTRINE[rule]);
      expect(bent, `${key} perks`).toHaveLength(doctrine.perks.length);
      expect(doctrine.perks.length).toBeGreaterThan(0);
    }
  });
});
