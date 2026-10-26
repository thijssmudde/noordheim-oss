import {
  isHarvester,
  isProducer,
  isUnit,
  type Entity,
  type Point,
  type UnitCategory,
} from './tactics';

type BattlefieldClick =
  | { type: 'select'; ids: string[]; additive: boolean }
  | { type: 'ground'; point: Point }
  | { type: 'attack'; id: string }
  | { type: 'rally'; id: string; point: Point }
  | { type: 'rallyCategory'; category: UnitCategory; point: Point }
  | { type: 'none' };

export function resolveBattlefieldClick({
  entities,
  selected,
  owner,
  entity,
  ground,
  button,
  shift,
  armed,
  rallyCategory = null,
}: {
  entities: Entity[];
  selected: string[];
  owner: string;
  entity?: Entity;
  ground: Point | null;
  button: number;
  shift: boolean;
  armed: boolean;
  /** Open troop tab: with nothing of ours selected, land sets that category's rally point. */
  rallyCategory?: UnitCategory | null;
}): BattlefieldClick {
  if (button !== 0 && button !== 2) return { type: 'none' };
  const own = entities.filter(
    (e) =>
      selected.includes(e.id) && e.owner === owner && !e.readyAt && e.hp > 0,
  );
  const troops = own.filter((e) => isUnit(e.kind));
  if (entity?.team === 'red') return { type: 'attack', id: entity.id };
  // Harvesters work the ore on their own; clicking one is a click on the ground.
  if (
    button === 0 &&
    !armed &&
    entity?.owner === owner &&
    !isHarvester(entity.kind)
  )
    return { type: 'select', ids: [entity.id], additive: shift };
  // A lone production structure receives a rally point, by left or right click.
  const structure = own.find((e) => isProducer(e.kind));
  if (ground && structure && !troops.length && !armed && !shift)
    return { type: 'rally', id: structure.id, point: ground };
  if (ground && rallyCategory && !own.length && !armed && !shift)
    return { type: 'rallyCategory', category: rallyCategory, point: ground };
  if (ground && (button === 2 || armed || (troops.length && !shift)))
    return { type: 'ground', point: ground };
  return shift
    ? { type: 'none' }
    : { type: 'select', ids: [], additive: false };
}
