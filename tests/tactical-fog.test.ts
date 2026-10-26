import { describe, expect, test } from 'vitest';
import {
  FOG_COLUMNS,
  FOG_FEATHER,
  FOG_ROWS,
  FogGrid,
} from '../lib/tactical-fog';
import {
  baseAt,
  isUnit,
  joinBattle,
  makeEntity,
  newBattle,
  visibleTo,
  visibleToBlue,
  visionOf,
  type Entity,
} from '../lib/tactics';
import { buildRadius } from '../lib/tactical-placement';

function setup() {
  const b = newBattle(0);
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 0);
  joinBattle(b, { id: 'bob', name: 'Bob', culture: 'ironclad' }, 0);
  return b;
}
describe('fog of war', () => {
  test('a completed forward outpost reveals the full build radius', () => {
    const b = setup(),
      fog = new FogGrid();
    const outpost = makeEntity(
      b,
      'outpost',
      'alice',
      'blue',
      { x: 0, z: 40 },
      10000,
    );
    const radius = buildRadius('outpost');
    const edge = { x: outpost.x + radius, z: outpost.z };
    fog.update([outpost], 'alice', 1);
    expect(fog.sight(edge)).toBe('hidden');
    outpost.readyAt = 0;
    fog.update([outpost], 'alice', 1);
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      expect(
        fog.sight({
          x: outpost.x + Math.cos(angle) * radius,
          z: outpost.z + Math.sin(angle) * radius,
        }),
      ).toBe('visible');
    }
    outpost.hp = 0;
    fog.update([outpost], 'alice', 1);
    expect(fog.sight(edge)).toBe('explored');
  });
  test('a commander lights only the ground around their own finished forces', () => {
    const b = setup(),
      fog = new FogGrid();
    const home = baseAt(b.commanders.find((c) => c.id === 'alice')!.slot),
      allied = baseAt(b.commanders.find((c) => c.id === 'bob')!.slot);
    fog.update(b.entities, 'alice', 1);
    expect(fog.sight(home)).toBe('visible');
    expect(fog.sight(allied)).toBe('hidden');
    expect(fog.sight({ x: 0, z: -100 })).toBe('hidden');
    expect(fog.sight({ x: 400, z: 0 })).toBe('hidden');
  });
  test('ground goes dark again once no troops watch it, but stays remembered', () => {
    const b = setup(),
      fog = new FogGrid();
    const scout = b.entities.find(
      (e) => e.owner === 'alice' && isUnit(e.kind) && e.kind !== 'harvester',
    )!;
    const far = { x: 20, z: -100 };
    scout.x = far.x;
    scout.z = far.z;
    fog.update(b.entities, 'alice', 1);
    expect(fog.sight(far)).toBe('visible');
    scout.hp = 0;
    fog.update(b.entities, 'alice', 1);
    expect(fog.sight(far)).toBe('explored');
    expect(
      fog.sight({
        x: far.x + visionOf(scout.kind) + FOG_FEATHER + 4,
        z: far.z,
      }),
    ).toBe('hidden');
  });
  test('vision glides toward the authoritative position instead of jumping', () => {
    const b = setup(),
      fog = new FogGrid();
    const scout = b.entities.find(
      (e) => e.owner === 'alice' && isUnit(e.kind),
    )!;
    fog.update(b.entities, 'alice', 1);
    const start = { x: scout.x, z: scout.z };
    scout.x = start.x + 120;
    fog.update(b.entities, 'alice', 0.01);
    expect(fog.sight(start)).toBe('visible');
    expect(fog.sight({ x: scout.x, z: scout.z })).toBe('hidden');
    fog.update(b.entities, 'alice', 5);
    expect(fog.sight({ x: scout.x, z: scout.z })).toBe('visible');
  });
  test('unfinished structures and dead troops see nothing', () => {
    const b = setup(),
      fog = new FogGrid();
    for (const e of b.entities)
      if (e.owner === 'alice') {
        if (isUnit(e.kind)) e.hp = 0;
        else e.readyAt = 5000;
      }
    fog.update(b.entities, 'alice', 1);
    const home = baseAt(b.commanders.find((c) => c.id === 'alice')!.slot);
    expect(fog.sight(home)).toBe('hidden');
  });
  test('explored memory survives a reset through storage bytes', () => {
    const b = setup(),
      fog = new FogGrid();
    fog.update(b.entities, 'alice', 1);
    const home = baseAt(b.commanders.find((c) => c.id === 'alice')!.slot);
    const stored = fog.explored();
    expect(stored.length).toBe(FOG_COLUMNS * FOG_ROWS);
    const later = new FogGrid(stored);
    expect(later.sight(home)).toBe('explored');
    later.reset();
    expect(later.sight(home)).toBe('hidden');
  });
  test('the server reveals hostiles per commander, not per coalition', () => {
    const b = setup();
    const enemy = b.entities.find((e) => e.team === 'red')!;
    const scout = b.entities.find((e) => e.owner === 'bob' && isUnit(e.kind))!;
    scout.x = enemy.x + 5;
    scout.z = enemy.z + 5;
    expect(visibleToBlue(enemy, b.entities)).toBe(true);
    expect(visibleTo('bob', enemy, b.entities)).toBe(true);
    expect(visibleTo('alice', enemy, b.entities)).toBe(false);
    const ally: Entity = b.entities.find((e) => e.owner === 'bob')!;
    expect(visibleTo('alice', ally, b.entities)).toBe(true);
  });
});
