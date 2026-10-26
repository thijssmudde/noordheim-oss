'use client';
import {
  useCallback,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  groupStorageKey,
  parseGroups,
  type ControlGroups,
} from '@/lib/control-groups';

const EMPTY: ControlGroups = {};
const cache = new Map<string, ControlGroups>();
const listeners = new Set<() => void>();

function read(key: string, persist: boolean): ControlGroups {
  let groups = cache.get(key);
  if (!groups) {
    try {
      groups = persist ? parseGroups(sessionStorage.getItem(key)) : EMPTY;
    } catch {
      groups = EMPTY;
    }
    cache.set(key, groups);
  }
  return groups;
}

function write(key: string, groups: ControlGroups, persist: boolean) {
  cache.set(key, groups);
  if (persist)
    try {
      if (Object.keys(groups).length)
        sessionStorage.setItem(key, JSON.stringify(groups));
      else sessionStorage.removeItem(key);
    } catch {
      // Private windows may refuse storage; the groups still live for this page.
    }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The commander's control groups for one operation, kept in sessionStorage so a
 * reload keeps them. Without `persist` (the interface fixture) they live only in memory.
 */
export function useControlGroups(
  sectorId: string | undefined,
  owner: string,
  persist = true,
): [ControlGroups, (groups: ControlGroups) => void] {
  const key = sectorId ? groupStorageKey(sectorId, owner) : null;
  const groups = useSyncExternalStore(
    subscribe,
    () => (key ? read(key, persist) : EMPTY),
    () => EMPTY,
  );
  const commit = useCallback(
    (next: ControlGroups) => {
      if (key && next !== groups) write(key, next, persist);
    },
    [key, groups, persist],
  );
  return [groups, commit];
}

export function ControlGroupStrip({ children }: { children: ReactNode }) {
  return (
    <div
      className="tac-control-groups"
      role="toolbar"
      aria-label="Control groups"
    >
      {children}
    </div>
  );
}

export function ControlGroupChip({
  slot,
  count,
  active,
  label,
  onRecall,
  onCentre,
  children,
}: {
  slot: number;
  count: number;
  active: boolean;
  label: string;
  onRecall: (event: MouseEvent<HTMLButtonElement>) => void;
  onCentre: () => void;
  /** The portrait of the group's most common troop. */
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tac-control-group"
      data-active={active || undefined}
      title={`Group ${slot}: ${label} · press ${slot} to select, twice to centre`}
      aria-label={`Control group ${slot}, ${count} ${count === 1 ? 'troop' : 'troops'}`}
      aria-pressed={active}
      onClick={onRecall}
      onDoubleClick={onCentre}
    >
      <kbd>{slot}</kbd>
      <span className="tac-control-group-icon" aria-hidden="true">
        {children}
      </span>
      <span className="tac-control-group-count">{count}</span>
    </button>
  );
}
