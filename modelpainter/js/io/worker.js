// Promise wrapper around the data worker.

let worker = null;
let nextId = 1;
const pending = new Map();

function get() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/data.worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.result);
  });
  worker.addEventListener('error', (event) => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'The worker failed.'));
    pending.clear();
    worker = null;
  });
  return worker;
}

/**
 * Runs a job in the worker.
 * @param {string} job
 * @param {object} args
 * @param {Transferable[]} [transfer]
 * @returns {Promise<any>}
 */
export function runJob(job, args, transfer = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    get().postMessage({ id, job, ...args }, transfer);
  });
}

/**
 * @param {Uint8Array} pixels RGBA. The buffer is handed over to the worker.
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8Array>} PNG bytes
 */
export function encodePng(pixels, width, height) {
  return runJob('encodePng', { pixels, width, height }, [pixels.buffer]);
}

/** @returns {Promise<Uint8Array>} zip bytes */
export function zipFiles(files) {
  return runJob('zip', { files });
}

/** @returns {Promise<Record<string, Uint8Array>>} */
export function unzipFiles(bytes) {
  return runJob('unzip', { bytes });
}

/** @returns {Promise<string[]>} hex colors */
export function extractPaletteAsync(pixels, colors) {
  return runJob('palette', { pixels, colors });
}
