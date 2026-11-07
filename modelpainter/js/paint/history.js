// Undo history. Pure bookkeeping: each entry knows how many bytes it holds and how to swap itself
// with the current state, so undo and redo are the same operation run from different stacks.

/** Tile edge length, in texels. */
export const TILE = 64;

/** @typedef {{ bytes: number, label: string, swap: () => (void|Promise<void>) }} HistoryEntry */

export class History {
  /** @param {number} budgetBytes the oldest steps get dropped past this */
  constructor(budgetBytes = 256 * 1024 * 1024) {
    this.budget = budgetBytes;
    /** @type {HistoryEntry[]} */
    this.undoStack = [];
    /** @type {HistoryEntry[]} */
    this.redoStack = [];
    this.bytes = 0;
    this.onChange = () => {};
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** @param {HistoryEntry} entry */
  push(entry) {
    for (const old of this.redoStack) this.bytes -= old.bytes;
    this.redoStack = [];
    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    // Always keep the newest step, even if it's over budget alone.
    while (this.bytes > this.budget && this.undoStack.length > 1) {
      this.bytes -= this.undoStack.shift().bytes;
    }
    this.onChange();
  }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    await entry.swap();
    this.redoStack.push(entry);
    this.onChange();
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    await entry.swap();
    this.undoStack.push(entry);
    this.onChange();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange();
  }
}

/**
 * Bounding box in texels of a set of tiles, for one readPixels call covering them all.
 * @param {{ x: number, y: number }[]} tiles tile coordinates
 * @param {number} tileSize
 * @param {number} res
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function tileBounds(tiles, tileSize, res) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of tiles) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const x = minX * tileSize;
  const y = minY * tileSize;
  return {
    x, y, width: Math.min(res, (maxX + 1) * tileSize) - x, height: Math.min(res, (maxY + 1) * tileSize) - y,
  };
}

/**
 * Copies one tile out of a larger RGBA buffer.
 * @param {Uint8Array} source
 * @param {{ x: number, y: number, width: number }} bounds where the buffer sits in the texture
 * @param {number} tx tile x, in tiles
 * @param {number} ty tile y, in tiles
 * @param {number} tileSize
 * @returns {Uint8Array}
 */
export function sliceTile(source, bounds, tx, ty, tileSize) {
  const out = new Uint8Array(tileSize * tileSize * 4);
  const dx = tx * tileSize - bounds.x;
  const dy = ty * tileSize - bounds.y;
  for (let row = 0; row < tileSize; row++) {
    const start = ((dy + row) * bounds.width + dx) * 4;
    out.set(source.subarray(start, start + tileSize * 4), row * tileSize * 4);
  }
  return out;
}
