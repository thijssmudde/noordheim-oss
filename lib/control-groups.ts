/**
 * Control groups: numbered squads the commander binds with Ctrl/⌘/Alt + 1–9
 * and recalls with 1–9. Client-side only; the server never sees them.
 */
export const GROUP_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** A second press of the same number within this window centres the camera. */
export const DOUBLE_TAP_MS = 350;

export type ControlGroups = Readonly<Record<number, readonly string[]>>;
export type GroupTap = { slot: number; at: number };

/** The slot a key press names, from its physical key so Shift and Alt layouts still match. */
export function groupSlot(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match ? Number(match[1]) : null;
}

function withSlot(
  groups: ControlGroups,
  slot: number,
  ids: readonly string[],
): ControlGroups {
  const next = { ...groups };
  if (ids.length) next[slot] = ids;
  else delete next[slot];
  return next;
}

/** Binds exactly these ids to the slot; an empty selection clears it. */
export function assignGroup(
  groups: ControlGroups,
  slot: number,
  ids: readonly string[],
): ControlGroups {
  return withSlot(groups, slot, [...new Set(ids)]);
}

/** Adds ids to the slot, keeping its current members first. */
export function addToGroup(
  groups: ControlGroups,
  slot: number,
  ids: readonly string[],
): ControlGroups {
  return withSlot(groups, slot, [
    ...new Set([...(groups[slot] ?? []), ...ids]),
  ]);
}

/** The members of a slot that can still take orders. */
export function recallGroup(
  groups: ControlGroups,
  slot: number,
  ready: (id: string) => boolean,
): string[] {
  return (groups[slot] ?? []).filter(ready);
}

/** Drops ids that no longer exist; returns the same object when nothing changed. */
export function pruneGroups(
  groups: ControlGroups,
  alive: (id: string) => boolean,
): ControlGroups {
  let changed = false;
  const next: Record<number, readonly string[]> = {};
  for (const [key, ids] of Object.entries(groups)) {
    const kept = ids.filter(alive);
    if (kept.length !== ids.length) changed = true;
    if (kept.length) next[Number(key)] = kept;
  }
  return changed ? next : groups;
}

/** True when this press repeats the previous one on the same slot quickly enough. */
export function isDoubleTap(
  previous: GroupTap | null,
  slot: number,
  at: number,
  window = DOUBLE_TAP_MS,
): boolean {
  return (
    !!previous &&
    previous.slot === slot &&
    at - previous.at >= 0 &&
    at - previous.at <= window
  );
}

/** Reads stored groups, ignoring anything malformed. */
export function parseGroups(raw: string | null): ControlGroups {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const groups: Record<number, string[]> = {};
    for (const [key, ids] of Object.entries(data)) {
      const slot = Number(key);
      if (!GROUP_SLOTS.includes(slot as (typeof GROUP_SLOTS)[number])) continue;
      if (!Array.isArray(ids)) continue;
      const kept = ids.filter((id): id is string => typeof id === 'string');
      if (kept.length) groups[slot] = kept;
    }
    return groups;
  } catch {
    return {};
  }
}

export function groupStorageKey(sectorId: string, owner: string): string {
  return `noordheim:control-groups:${sectorId}:${owner}`;
}
