import { describe, expect, test } from 'vitest';
import { resolveBattlefieldClick } from '../lib/tactical-input';
import {
  issueOrder,
  joinBattle,
  makeEntity,
  newBattle,
  tickBattle,
} from '../lib/tactics';

function setup() {
  const battle = newBattle(1000);
  joinBattle(
    battle,
    { id: 'alice', name: 'Alice', culture: 'fjordborn' },
    1000,
  );
  const troop = battle.entities.find(
    (e) => e.owner === 'alice' && e.kind === 'ranger',
  )!;
  const hq = battle.entities.find(
    (e) => e.owner === 'alice' && e.kind === 'hq',
  )!;
  const click = {
    entities: battle.entities,
    selected: [troop.id],
    owner: 'alice',
    ground: { x: troop.x + 5, z: troop.z - 8 },
    button: 0,
    shift: false,
    armed: false,
  };
  return { battle, troop, hq, click };
}

describe('Point-and-click troop orders', () => {
  test('selecting a troop then clicking land moves it without arming Move', () => {
    const { battle, troop, click } = setup();
    const selection = resolveBattlefieldClick({
      ...click,
      selected: [],
      entity: troop,
    });
    expect(selection.type).toBe('select');
    if (selection.type !== 'select') throw new Error('Troop was not selected');
    const action = resolveBattlefieldClick({
      ...click,
      selected: selection.ids,
    });
    expect(action.type).toBe('ground');
    if (action.type !== 'ground') throw new Error('Move was not issued');
    const before = { x: troop.x, z: troop.z };
    issueOrder(battle, 'alice', selection.ids, 'move', action.point);
    expect(troop.path.at(-1)).toEqual(click.ground);
    tickBattle(battle, 2000);
    expect(Math.hypot(troop.x - before.x, troop.z - before.z)).toBeGreaterThan(
      0,
    );
    const redirected = resolveBattlefieldClick({
      ...click,
      selected: selection.ids,
      ground: before,
    });
    expect(redirected).toEqual({ type: 'ground', point: before });
  });

  test('clicking another owned troop selects it instead of moving the old selection', () => {
    const { battle, troop, click } = setup();
    const next = battle.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'lynx',
    )!;
    expect(resolveBattlefieldClick({ ...click, entity: next })).toEqual({
      type: 'select',
      ids: [next.id],
      additive: false,
    });
    expect(
      resolveBattlefieldClick({ ...click, entity: troop, shift: true }),
    ).toEqual({ type: 'select', ids: [troop.id], additive: true });
    expect(resolveBattlefieldClick({ ...click, shift: true })).toEqual({
      type: 'none',
    });
  });

  test('empty, building, unfinished, or foreign selections do not issue an implicit move', () => {
    const { troop, hq, click } = setup();
    for (const selected of [[], [hq.id], ['missing']])
      expect(resolveBattlefieldClick({ ...click, selected }).type).toBe(
        'select',
      );
    for (const changed of [
      { ...troop, readyAt: 5000 },
      { ...troop, owner: 'bob' },
    ])
      expect(
        resolveBattlefieldClick({ ...click, entities: [changed] }).type,
      ).toBe('select');
  });

  test('clicking an enemy attacks; right-click and explicit move modes still take precedence over selection', () => {
    const { battle, troop, click } = setup();
    const enemy = battle.entities.find((e) => e.team === 'red')!;
    expect(resolveBattlefieldClick({ ...click, entity: enemy })).toEqual({
      type: 'attack',
      id: enemy.id,
    });
    for (const override of [{ button: 2 }, { armed: true }])
      expect(
        resolveBattlefieldClick({ ...click, entity: troop, ...override }),
      ).toEqual({ type: 'ground', point: click.ground });
  });

  test('harvesters are never selectable and clicking one is a click on the ground', () => {
    const { battle, troop, hq, click } = setup();
    const harvester = makeEntity(battle, 'harvester', 'alice', 'blue', {
      x: hq.x + 12,
      z: hq.z,
    });
    battle.entities.push(harvester);
    // A bare click on a harvester with nothing selected clears the selection.
    expect(
      resolveBattlefieldClick({
        ...click,
        selected: [],
        entity: harvester,
        ground: { x: harvester.x, z: harvester.z },
      }),
    ).toEqual({ type: 'select', ids: [], additive: false });
    // With troops selected it moves them to the harvester's position.
    expect(
      resolveBattlefieldClick({
        ...click,
        selected: [troop.id],
        entity: harvester,
        ground: { x: harvester.x, z: harvester.z },
      }),
    ).toEqual({ type: 'ground', point: { x: harvester.x, z: harvester.z } });
    // The simulation refuses orders addressed to harvesters.
    expect(() =>
      issueOrder(battle, 'alice', [harvester.id], 'move', {
        x: harvester.x,
        z: harvester.z + 5,
      }),
    ).toThrow(/on their own/);
  });
  test('middle-click camera gestures and clicks without ground never move troops', () => {
    const { click } = setup();
    expect(resolveBattlefieldClick({ ...click, button: 1 })).toEqual({
      type: 'none',
    });
    expect(resolveBattlefieldClick({ ...click, ground: null }).type).toBe(
      'select',
    );
  });

  test('a selected production structure takes a rally point from either mouse button', () => {
    const { battle, click } = setup();
    const hq = battle.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    )!;
    for (const kind of ['barracks', 'camp', 'watchtower'] as const) {
      const producer = makeEntity(battle, kind, 'alice', 'blue', {
        x: hq.x + 20,
        z: hq.z,
      });
      producer.readyAt = 0;
      const entities = [...battle.entities, producer];
      for (const button of [0, 2])
        expect(
          resolveBattlefieldClick({
            ...click,
            entities,
            selected: [producer.id],
            button,
          }),
        ).toEqual({ type: 'rally', id: producer.id, point: click.ground });
    }
  });

  test('an open troop tab turns a land click with nothing selected into a category rally point', () => {
    const { click } = setup();
    for (const button of [0, 2])
      expect(
        resolveBattlefieldClick({
          ...click,
          selected: [],
          button,
          rallyCategory: 'vehicle',
        }),
      ).toEqual({
        type: 'rallyCategory',
        category: 'vehicle',
        point: click.ground,
      });
    // Selected troops still take the order, and shift or an armed mode never re-rallies.
    expect(
      resolveBattlefieldClick({ ...click, rallyCategory: 'vehicle' }).type,
    ).toBe('ground');
    for (const override of [{ shift: true }, { armed: true }])
      expect(
        resolveBattlefieldClick({
          ...click,
          selected: [],
          rallyCategory: 'vehicle',
          ...override,
        }).type,
      ).not.toBe('rallyCategory');
  });
});
