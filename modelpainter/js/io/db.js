// IndexedDB storage for autosaved projects. Meta rows stay small so the project list loads quickly,
// and the heavy mesh and texture blobs live in their own store.

const DB_NAME = 'modelpainter';
const DB_VERSION = 1;

let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

const asPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Saving was interrupted.'));
});

/**
 * @typedef {object} ProjectMeta
 * @property {string} id
 * @property {string} name
 * @property {number} updatedAt
 * @property {Blob} [thumb]
 * @property {object} data settings, palette, resolution
 */

/**
 * Saves a project's meta row and whichever blobs changed, all in one transaction, so a crash can't
 * leave them disagreeing.
 * @param {ProjectMeta} meta
 * @param {Record<string, Blob>} blobs keyed by mesh, lit, shadow or edge
 */
export async function saveProject(meta, blobs = {}) {
  const db = await open();
  const tx = db.transaction(['projects', 'blobs'], 'readwrite');
  tx.objectStore('projects').put(meta);
  for (const [key, blob] of Object.entries(blobs)) tx.objectStore('blobs').put(blob, `${meta.id}/${key}`);
  await finished(tx);
}

/** @returns {Promise<ProjectMeta[]>} newest first */
export async function listProjects() {
  const db = await open();
  const all = await asPromise(db.transaction('projects').objectStore('projects').getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** @returns {Promise<ProjectMeta|undefined>} */
export async function getProject(id) {
  const db = await open();
  return asPromise(db.transaction('projects').objectStore('projects').get(id));
}

/** @returns {Promise<Blob|undefined>} */
export async function getBlob(id, key) {
  const db = await open();
  return asPromise(db.transaction('blobs').objectStore('blobs').get(`${id}/${key}`));
}

export async function deleteProject(id) {
  const db = await open();
  const tx = db.transaction(['projects', 'blobs'], 'readwrite');
  tx.objectStore('projects').delete(id);
  for (const key of ['mesh', 'lit', 'shadow', 'edge']) tx.objectStore('blobs').delete(`${id}/${key}`);
  await finished(tx);
}
