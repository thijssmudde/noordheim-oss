import { describe, expect, test } from 'vitest';
import {
  isInsideView,
  isSelectableTroop,
  mergeSelection,
  rosterKindSelection,
  sameKindTroops,
} from '../lib/tactical-selection';
import {
  SELECTION_LIMIT,
  makeEntity,
  newBattle,
  type Entity,
  type EntityKind,
} from '../lib/tactics';

function army() {
  const b = newBattle(1000);
  const add = (
    kind: EntityKind,
    x: number,
    owner = 'alice',
    readyAt = 0,
  ): Entity => {
    const e = makeEntity(
      b,
      kind,
      owner,
      owner === 'garrison' ? 'red' : 'blue',
      { x, z: 0 },
      readyAt,
    );
    b.entities.push(e);
    return e;
  };
  const rangers = [add('ranger', 0), add('ranger', 10), add('ranger', 200)];
  const lynx = add('lynx', 5);
  const harvester = add('harvester', 6);
  const training = add('ranger', 7, 'alice', 5000);
  const ally = add('ranger', 8, 'bob');
  const enemy = add('ranger', 9, 'garrison');
  return { b, rangers, lynx, harvester, training, ally, enemy };
}

describe('Select every troop of one kind', () => {
  test('picks own ready troops of the clicked kind that are on screen', () => {
    const { b, rangers } = army();
    const ids = sameKindTroops({
      entities: b.entities,
      owner: 'alice',
      anchor: rangers[1],
      visible: (e) => e.x < 100,
    });
    expect(ids).toEqual([rangers[1].id, rangers[0].id]);
  });

  test('skips other kinds, harvesters, units in production and other commanders', () => {
    const { b, rangers, lynx, harvester, training, ally, enemy } = army();
    const ids = sameKindTroops({
      entities: b.entities,
      owner: 'alice',
      anchor: rangers[0],
    });
    expect(ids).toEqual(rangers.map((r) => r.id));
    for (const other of [lynx, harvester, training, ally, enemy])
      expect(ids).not.toContain(other.id);
  });

  test('ignores anchors the commander cannot select', () => {
    const { b, harvester, training, enemy } = army();
    for (const anchor of [harvester, training, enemy])
      expect(
        sameKindTroops({ entities: b.entities, owner: 'alice', anchor }),
      ).toEqual([]);
    expect(isSelectableTroop(harvester, 'alice')).toBe(false);
    const hq = makeEntity(b, 'hq', 'alice', 'blue', { x: 0, z: 0 });
    expect(isSelectableTroop(hq, 'alice')).toBe(false);
  });

  test('never exceeds the selection limit', () => {
    const b = newBattle(1000);
    for (let i = 0; i < SELECTION_LIMIT + 20; i++)
      b.entities.push(makeEntity(b, 'ranger', 'alice', 'blue', { x: i, z: 0 }));
    const ids = sameKindTroops({
      entities: b.entities,
      owner: 'alice',
      anchor: b.entities[b.entities.length - 1],
    });
    expect(ids).toHaveLength(SELECTION_LIMIT);
    expect(ids[0]).toBe(b.entities[b.entities.length - 1].id);
    expect(
      mergeSelection(
        ['x'],
        b.entities.map((e) => e.id),
        true,
      ),
    ).toHaveLength(SELECTION_LIMIT);
  });

  test('shift adds to the selection without duplicates', () => {
    expect(mergeSelection(['a', 'b'], ['b', 'c'], true)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(mergeSelection(['a', 'b'], ['c'], false)).toEqual(['c']);
  });

  test('frustum test accepts only points inside normalized device space', () => {
    expect(isInsideView({ x: 0, y: 0, z: 0.5 })).toBe(true);
    expect(isInsideView({ x: 1, y: -1, z: 0.99 })).toBe(true);
    expect(isInsideView({ x: 1.01, y: 0, z: 0.5 })).toBe(false);
    expect(isInsideView({ x: 0, y: -1.2, z: 0.5 })).toBe(false);
    // Behind the camera, projection flips past the far plane.
    expect(isInsideView({ x: 0, y: 0, z: 1.3 })).toBe(false);
  });
});

describe('Roster double-click', () => {
  test('narrows a mixed selection to the clicked kind', () => {
    const { b, rangers, lynx } = army();
    const previous = [rangers[0].id, rangers[1].id, lynx.id];
    expect(
      rosterKindSelection({
        entities: b.entities,
        owner: 'alice',
        anchor: rangers[1],
        previous,
      }),
    ).toEqual([rangers[1].id, rangers[0].id]);
  });

  test('picks every troop of the kind when the card was not selected', () => {
    const { b, rangers, lynx } = army();
    expect(
      rosterKindSelection({
        entities: b.entities,
        owner: 'alice',
        anchor: rangers[2],
        previous: [lynx.id],
      }),
    ).toEqual([rangers[2].id, rangers[0].id, rangers[1].id]);
  });
});
