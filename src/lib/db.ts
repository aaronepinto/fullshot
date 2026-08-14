import type { CaptureRecord, Strip, Tile } from './types';

const DB_NAME = 'fullshot';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const captures = db.createObjectStore('captures', { keyPath: 'id' });
      captures.createIndex('createdAt', 'createdAt');
      db.createObjectStore('tiles', { keyPath: 'key' }).createIndex('capId', 'capId');
      db.createObjectStore('strips', { keyPath: 'key' }).createIndex('capId', 'capId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest<T> | Promise<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        t.onerror = () => reject(t.error);
        const out = run(t);
        if (out instanceof IDBRequest) {
          out.onsuccess = () => resolve(out.result);
          out.onerror = () => reject(out.error);
        } else {
          out.then(resolve, reject);
        }
      })
  );
}

export const putCapture = (c: CaptureRecord) =>
  tx<IDBValidKey>(['captures'], 'readwrite', (t) => t.objectStore('captures').put(c));

export const getCapture = (id: string) =>
  tx<CaptureRecord | undefined>(['captures'], 'readonly', (t) => t.objectStore('captures').get(id));

export const listCaptures = async (): Promise<CaptureRecord[]> => {
  const all = await tx<CaptureRecord[]>(['captures'], 'readonly', (t) =>
    t.objectStore('captures').getAll()
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
};

export const putTile = (tile: Tile) =>
  tx<IDBValidKey>(['tiles'], 'readwrite', (t) => t.objectStore('tiles').put(tile));

export const getTiles = async (capId: string): Promise<Tile[]> => {
  const tiles = await tx<Tile[]>(['tiles'], 'readonly', (t) =>
    t.objectStore('tiles').index('capId').getAll(capId)
  );
  return tiles.sort((a, b) => a.index - b.index);
};

export const putStrip = (strip: Strip) =>
  tx<IDBValidKey>(['strips'], 'readwrite', (t) => t.objectStore('strips').put(strip));

export const getStrips = async (capId: string): Promise<Strip[]> => {
  const strips = await tx<Strip[]>(['strips'], 'readonly', (t) =>
    t.objectStore('strips').index('capId').getAll(capId)
  );
  return strips.sort((a, b) => a.index - b.index);
};

async function deleteByIndex(store: string, capId: string): Promise<void> {
  await tx<void>([store], 'readwrite', async (t) => {
    const idx = t.objectStore(store).index('capId');
    await new Promise<void>((resolve, reject) => {
      const req = idx.openCursor(capId);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export const deleteTiles = (capId: string) => deleteByIndex('tiles', capId);
export const deleteStrips = (capId: string) => deleteByIndex('strips', capId);

export async function deleteCapture(capId: string): Promise<void> {
  await tx<undefined>(['captures'], 'readwrite', (t) => t.objectStore('captures').delete(capId));
  await deleteTiles(capId);
  await deleteStrips(capId);
}

/** Drop the oldest captures beyond `limit`. */
export async function pruneHistory(limit: number): Promise<void> {
  const all = await listCaptures();
  for (const old of all.slice(Math.max(1, limit))) {
    await deleteCapture(old.id);
  }
}
