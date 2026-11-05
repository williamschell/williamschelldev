// IndexedDB and localStorage wrappers. Private browsing or a full quota shouldn't break
// the app, so nothing here throws: failures return null or false and tell the listener.

const DB_NAME = 'splotchio';
const DB_VERSION = 1;
const PREFIX = 'splotchio:';

let dbPromise = null;
let errorListener = () => {};

/**
 * Sets the function that hears about storage failures.
 * @param {(message: string) => void} listener
 */
export function onStorageError(listener) {
  errorListener = listener;
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('artworks')) db.createObjectStore('artworks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'slot' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function run(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function guarded(action, fallback, message) {
  try {
    return await action();
  } catch (err) {
    console.warn('Splotchio storage:', err);
    errorListener(message);
    return fallback;
  }
}

const SAVE_FAILED = "Couldn't save on this device. Private browsing or a full disk can cause this.";
const READ_FAILED = "Couldn't read your saved art on this device.";

/**
 * @param {object} artwork a record with an id
 * @returns {Promise<boolean>} whether it was saved
 */
export function putArtwork(artwork) {
  return guarded(async () => {
    await run('artworks', 'readwrite', (s) => s.put(artwork));
    return true;
  }, false, SAVE_FAILED);
}

/**
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export function getArtwork(id) {
  return guarded(async () => (await run('artworks', 'readonly', (s) => s.get(id))) ?? null, null, READ_FAILED);
}

/** @returns {Promise<object[]>} all artworks, newest first */
export function getAllArtworks() {
  return guarded(async () => {
    const all = await run('artworks', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }, [], READ_FAILED);
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export function deleteArtwork(id) {
  return guarded(async () => {
    await run('artworks', 'readwrite', (s) => s.delete(id));
    return true;
  }, false, SAVE_FAILED);
}

/**
 * @param {string} slot 'daily' or 'free'
 * @param {object} draft
 * @returns {Promise<boolean>}
 */
export function putDraft(slot, draft) {
  return guarded(async () => {
    await run('drafts', 'readwrite', (s) => s.put({ ...draft, slot }));
    return true;
  }, false, SAVE_FAILED);
}

/**
 * @param {string} slot
 * @returns {Promise<object|null>}
 */
export function getDraft(slot) {
  return guarded(async () => (await run('drafts', 'readonly', (s) => s.get(slot))) ?? null, null, READ_FAILED);
}

/**
 * @param {string} slot
 * @returns {Promise<boolean>}
 */
export function deleteDraft(slot) {
  return guarded(async () => {
    await run('drafts', 'readwrite', (s) => s.delete(slot));
    return true;
  }, false, SAVE_FAILED);
}

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function readSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
export function writeSetting(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
