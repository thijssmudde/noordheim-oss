import { expect, test } from 'vitest';
import {
  CombatPresentation,
  weaponFamily,
  WEAPON_PROFILES,
} from '../lib/combat-presentation';
import { newBattle, joinBattle, makeEntity, type Battle } from '../lib/tactics';

function fixture() {
  const b = newBattle(1000, { seed: 947 });
  joinBattle(b, { id: 'p', name: 'P', culture: 'fjordborn' }, 1000);
  const e = makeEntity(b, 'tank', 'p', 'blue', { x: -100, z: 65 });
  b.entities = [e];
  return { b, e };
}
function fire(b: Battle, at: number) {
  b.tickAt = at;
  b.entities[0].firedAt = at;
  b.entities[0].shotX = -90;
  b.entities[0].shotZ = 65;
}
test('reconnects, duplicate snapshots and clock regressions never replay old fire', () => {
  const { b } = fixture(),
    tracker = new CombatPresentation();
  fire(b, 2000);
  expect(tracker.update(b)).toEqual([]);
  fire(b, 2250);
  expect(tracker.update(b)).toHaveLength(1);
  expect(tracker.update(b)).toEqual([]);
  fire(b, 2100);
  expect(tracker.update(b)).toEqual([]);
  fire(b, 9000);
  expect(tracker.update(b)).toEqual([]);
  fire(b, 9250);
  expect(tracker.update(b)).toHaveLength(1);
});
test('weapon cadence is independent per shooter and hidden shots are discarded', () => {
  const { b } = fixture(),
    tracker = new CombatPresentation();
  tracker.update(b);
  fire(b, 1250);
  expect(tracker.update(b, () => false)).toEqual([]);
  expect(tracker.update(b, () => true)).toEqual([]);
  fire(b, 1500);
  expect(tracker.update(b)).toHaveLength(1);
  fire(b, 1750);
  expect(tracker.update(b)).toEqual([]);
  fire(b, 2750);
  expect(tracker.update(b)).toHaveLength(1);
});
test('newly visible enemies and unarmed equipment cannot create phantom shots', () => {
  const { b, e } = fixture(),
    tracker = new CombatPresentation();
  tracker.update(b);
  b.entities = [];
  b.tickAt = 1250;
  tracker.update(b);
  e.firedAt = 1500;
  b.entities = [e];
  b.tickAt = 1500;
  expect(tracker.update(b)).toEqual([]);
  expect(weaponFamily('harvester')).toBeNull();
  expect(weaponFamily('hq')).toBeNull();
  expect(WEAPON_PROFILES.artillery.interval).toBeGreaterThan(
    WEAPON_PROFILES.rifle.interval,
  );
});
test('presentation never changes authoritative damage, orders, positions or fire timestamps', () => {
  const { b } = fixture(),
    tracker = new CombatPresentation();
  tracker.update(b);
  fire(b, 1250);
  const before = structuredClone(b);
  tracker.update(b);
  expect(b).toEqual(before);
});

test('the review skirmish exercises real rifle, armor, rocket and artillery damage through restart', async () => {
  const { combatFixture } = await import('../components/dev/combat-fixture');
  const { tickBattle } = await import('../lib/tactics');
  const tracker = new CombatPresentation();
  for (const startedAt of [1000, 21000]) {
    const battle = combatFixture(947, 'glaciercrown', startedAt);
    const before = new Map(battle.entities.map((e) => [e.id, e.hp]));
    tracker.update(battle);
    const families = new Set<string>();
    for (let tick = 0; tick < 16; tick++) {
      tickBattle(battle, battle.tickAt + 250);
      for (const event of tracker.update(battle)) families.add(event.family);
    }
    expect([...families].sort()).toEqual([
      'artillery',
      'cannon',
      'machine',
      'rifle',
      'rocket',
    ]);
    expect(battle.entities.some((e) => e.hp < before.get(e.id)!)).toBe(true);
  }
});
