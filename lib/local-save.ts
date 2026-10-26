import type { SectorSave } from './local-sector';

/**
 * Local operations persist in IndexedDB as structured clones: no JSON pass,
 * no localStorage quota, and readable from the simulation worker. One record
 * per operation, keyed by its id.
 */
const DATABASE = 'noordheim-local';
const STORE = 'sectors';

let database: Promise<IDBDatabase> | null = null;
function open() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error('Local saves are unavailable.'));
    };
  });
  return database;
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error('Local save failed.'));
  });
}

export const saveSector = (save: SectorSave) =>
  transact('readwrite', (s) => s.put(save, save.id));
export const loadSector = (id: string) =>
  transact<SectorSave | undefined>('readonly', (s) => s.get(id));
export const clearSector = (id: string) =>
  transact('readwrite', (s) => s.delete(id));
