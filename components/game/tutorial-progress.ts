'use client';

import { useSyncExternalStore } from 'react';
import {
  NEW_TUTORIAL,
  parseTutorial,
  type TutorialProgress,
} from '@/lib/tutorial';

/** First-match tutorial progress, kept so it shows once and resumes after a reload. */
const STORAGE_KEY = 'noordheim.tutorial.v1';
const CHANGE_EVENT = 'noordheim-tutorial';
let temporary = NEW_TUTORIAL;
let storageUnavailable = false;
let cached: { raw: string | null; value: TutorialProgress } | null = null;

function readProgress() {
  if (storageUnavailable) return temporary;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Keep the snapshot stable between reads so React does not loop.
    if (cached?.raw !== raw) cached = { raw, value: parseTutorial(raw) };
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

export function saveTutorial(next: TutorialProgress) {
  temporary = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    // Progress still holds for this visit when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useTutorialProgress() {
  return useSyncExternalStore(subscribe, readProgress, () => NEW_TUTORIAL);
}
