export const normalizePlayerName = (name: string) =>
  name.normalize('NFKC').replace(/\s+/g, ' ').trim();

export const playerNameKey = (name: string) =>
  normalizePlayerName(name).toLowerCase();

export const normalizeRecoveryKey = (key: string) =>
  key.replace(/[\s-]/g, '').toLowerCase();

export const isPlayerKey = (key: string) => /^[a-f0-9]{64}$/.test(key);

export function createPlayerKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
