import { SELECTION_LIMIT, isHarvester, isUnit, type Entity } from './tactics';

/** A field unit the commander can order: their own, trained, alive and not a harvester. */
export function isSelectableTroop(entity: Entity, owner: string) {
  return (
    entity.owner === owner &&
    isUnit(entity.kind) &&
    !isHarvester(entity.kind) &&
    !entity.readyAt &&
    entity.hp > 0
  );
}

/** A projected point in normalized device coordinates lies inside the camera frustum. */
export function isInsideView(ndc: { x: number; y: number; z: number }) {
  return (
    Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1
  );
}

/**
 * Every selectable troop of the anchor's kind that passes `visible`, anchor first.
 * Returns an empty list when the anchor is not a troop the owner may select.
 */
export function sameKindTroops({
  entities,
  owner,
  anchor,
  visible = () => true,
}: {
  entities: Entity[];
  owner: string;
  anchor: Entity;
  visible?: (entity: Entity) => boolean;
}): string[] {
  if (!isSelectableTroop(anchor, owner)) return [];
  const rest = entities.filter(
    (e) =>
      e.id !== anchor.id &&
      e.kind === anchor.kind &&
      isSelectableTroop(e, owner) &&
      visible(e),
  );
  return [anchor.id, ...rest.map((e) => e.id)].slice(0, SELECTION_LIMIT);
}

/**
 * Double-clicking a roster card: a card that was already part of a wider selection
 * narrows that selection to its kind; otherwise every troop of the kind is picked.
 */
export function rosterKindSelection({
  entities,
  owner,
  anchor,
  previous,
}: {
  entities: Entity[];
  owner: string;
  anchor: Entity;
  previous: string[];
}): string[] {
  const narrowed = previous.includes(anchor.id)
    ? sameKindTroops({
        entities,
        owner,
        anchor,
        visible: (e) => previous.includes(e.id),
      })
    : [];
  return narrowed.length > 1
    ? narrowed
    : sameKindTroops({ entities, owner, anchor });
}

/** Union or replacement of a selection, capped at the order limit. */
export function mergeSelection(
  current: string[],
  ids: string[],
  additive: boolean,
) {
  return (additive ? [...new Set([...current, ...ids])] : ids).slice(
    0,
    SELECTION_LIMIT,
  );
}
