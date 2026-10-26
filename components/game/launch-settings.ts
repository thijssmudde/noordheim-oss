'use client';

import { useSyncExternalStore } from 'react';
import { mapIds, type MapId } from '@/lib/battlefields';
import { difficultyKeys, type Difficulty } from '@/lib/tactical-difficulty';
import {
  DEFAULT_SKIRMISH_MODE,
  isSkirmishMode,
  type SkirmishMode,
} from '@/lib/skirmish-modes';

/** The launcher's last operation setup, kept so a commander returns to it. */
export type LaunchSettings = {
  mapId: MapId;
  difficulty: Difficulty;
  enemyCount: number;
  /** Solo skirmish mission; settings saved before modes default to standard. */
  mode: SkirmishMode;
};

const STORAGE_KEY = 'noordheim.launch-settings.v1';
const CHANGE_EVENT = 'noordheim-launch-settings';
const DEFAULTS: LaunchSettings = {
  mapId: 'fjordmouth',
  difficulty: 'normal',
  enemyCount: 1,
  mode: DEFAULT_SKIRMISH_MODE,
};
let temporary = DEFAULTS;
let storageUnavailable = false;
let cached: { raw: string | null; value: LaunchSettings } | null = null;

export function parseLaunchSettings(raw: string | null): LaunchSettings {
  try {
    const stored = JSON.parse(raw ?? 'null') as Partial<LaunchSettings> | null;
    if (!stored || typeof stored !== 'object') return DEFAULTS;
    return {
      mapId: mapIds.includes(stored.mapId as MapId)
        ? (stored.mapId as MapId)
        : DEFAULTS.mapId,
      difficulty: difficultyKeys.includes(stored.difficulty as Difficulty)
        ? (stored.difficulty as Difficulty)
        : DEFAULTS.difficulty,
      enemyCount:
        Number.isInteger(stored.enemyCount) && stored.enemyCount! >= 1
          ? stored.enemyCount!
          : DEFAULTS.enemyCount,
      mode: isSkirmishMode(stored.mode) ? stored.mode : DEFAULTS.mode,
    };
  } catch {
    return DEFAULTS;
  }
}

function readSettings() {
  if (storageUnavailable) return temporary;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Keep the snapshot stable between reads so React does not loop.
    if (cached?.raw !== raw) cached = { raw, value: parseLaunchSettings(raw) };
    return cached.value;
  } catch {
    return temporary;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function saveLaunchSettings(change: Partial<LaunchSettings>) {
  temporary = { ...readSettings(), ...change };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(temporary));
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    // The setup still holds for this visit when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useLaunchSettings() {
  return useSyncExternalStore(subscribe, readSettings, () => DEFAULTS);
}
