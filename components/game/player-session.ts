'use client';

import { useSyncExternalStore } from 'react';
import { isPlayerKey } from '../../lib/player-identity';

const STORAGE_KEY = 'noordheim-session';
const SESSION_EVENT = 'noordheim-player-changed';
let temporarySession = '';
let storageUnavailable = false;

function readSession() {
  if (storageUnavailable) return temporarySession;
  try {
    const token = localStorage.getItem(STORAGE_KEY) ?? '';
    return isPlayerKey(token) ? token : '';
  } catch {
    return temporarySession;
  }
}
function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SESSION_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SESSION_EVENT, onChange);
  };
}
export function rememberPlayer(token: string) {
  if (token && !isPlayerKey(token)) throw new Error('Invalid recovery key.');
  temporarySession = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    // Private browsing can disallow storage; the player can still copy a recovery key.
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function usePlayerSession() {
  return useSyncExternalStore(subscribe, readSession, () => null);
}
