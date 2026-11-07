// The drawing layer: a canvas, Pointer Events input, and undo/redo.
//
// Strokes are records (points plus tool settings), not pixels. Undo replays them from
// the nearest cached snapshot, so it stays fast without keeping a bitmap per step.

import { strokePaint, hairsFor, MARKER_ALPHA } from './brushes.js';
import { floodFill } from './fill.js';

const MAX_HISTORY = 100;
const SNAPSHOT_EVERY = 20;
const BAKE_COUNT = SNAPSHOT_EVERY;

// A hand resting on a tablet registers as touch. Ignore touch for this long after the pen was
// last seen, which covers the moment before a stroke and the pauses between strokes.
const PALM_REJECT_MS = 1500;

/** How far a pixel's color can stray from the clicked pixel and still get filled. */
const FILL_TOLERANCE = 40;

/**
 * @typedef {object} Stroke
 * @property {'b'|'e'|'c'|'f'} t brush, eraser, clear or fill
 * @property {string} [c] color
 * @property {number} [s] size in artboard units
 * @property {boolean} [pen] whether width follows pressure
 * @property {number[]} [p] flat list of x, y, pressure
 * @property {'pencil'|'marker'|'paint'} [b] brush texture. Left out for the pen.
 * @property {number} [k] fill only: canvas pixels per artboard unit when it was made
 * @property {number[]} [r] fill only: the filled pixels, as a flat list of x, y, length
 * @property {number[]} [d] fill only: the fringe that goes under existing art
 */

// Pressure 0.5 is a normal press, so it gives exactly the chosen size. The range runs from
// 20% of the size at the lightest touch to 180% at full pressure.
const widthAt = (stroke, i) => (stroke.pen ? stroke.s * (0.2 + 1.6 * stroke.p[i * 3 + 2]) : stroke.s);

/**
 * Draws one curve piece of a pressure stroke. A canvas path has a single line width, so the
 * curve is cut into short lines with the width interpolated along them. Without this, width
 * changes as a visible step at every input sample.
 * The curve is the quadratic Bézier B(t) = (1-t)^2 S + 2(1-t)t C + t^2 E.
 */
function drawTaperedCurve(ctx, [sx, sy], [cx, cy], [ex, ey], widthStart, widthEnd) {
  const span = Math.abs(ex - sx) + Math.abs(ey - sy);
  const steps = Math.max(1, Math.min(24, Math.ceil(Math.max(span / 3, Math.abs(widthEnd - widthStart) * 2))));
  let px = sx;
  let py = sy;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    const x = u * u * sx + 2 * u * t * cx + t * t * ex;
    const y = u * u * sy + 2 * u * t * cy + t * t * ey;
    ctx.lineWidth = widthStart + (widthEnd - widthStart) * t;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
    px = x;
    py = y;
  }
}

/** Draws one paintbrush curve piece as a separate thin curve per bristle. */
function drawBristles(ctx, stroke, [sx, sy], [cx, cy], [ex, ey], width) {
  // Round caps would poke over the neighboring bristles at every join and look like rope.
  ctx.lineCap = 'butt';
  for (const hair of hairsFor(stroke)) {
    const ox = hair.x * width;
    const oy = hair.y * width;
    ctx.strokeStyle = hair.color;
    ctx.lineWidth = Math.max(0.6, hair.w * width);
    ctx.beginPath();
    ctx.moveTo(sx + ox, sy + oy);
    ctx.quadraticCurveTo(cx + ox, cy + oy, ex + ox, ey + oy);
    ctx.stroke();
  }
}

/** Draws one curve piece in whatever way the stroke's brush needs. */
function drawSegment(ctx, stroke, start, control, end, widthStart, widthEnd) {
  if (stroke.b === 'paint') {
    drawBristles(ctx, stroke, start, control, end, (widthStart + widthEnd) / 2);
  } else if (stroke.pen) {
    drawTaperedCurve(ctx, start, control, end, widthStart, widthEnd);
  } else {
    ctx.lineWidth = widthStart;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.quadraticCurveTo(control[0], control[1], end[0], end[1]);
    ctx.stroke();
  }
}

/** Applies one stroke's tool settings to a context. */
function applyStyle(ctx, stroke) {
  ctx.globalCompositeOperation = stroke.t === 'e' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.t === 'e' ? '#000' : strokePaint(stroke);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/**
 * Draws the part of a stroke that point i adds. Curves run between the midpoints of
 * consecutive points, with the real point as the quadratic control. That keeps the
 * tangent continuous at every join, so fast strokes come out smooth instead of polygonal.
 */
function drawPoint(ctx, stroke, i) {
  const p = stroke.p;
  const x = p[i * 3];
  const y = p[i * 3 + 1];
  if (i === 0) {
    const width = widthAt(stroke, 0);
    if (stroke.b === 'paint') {
      for (const hair of hairsFor(stroke)) {
        ctx.fillStyle = hair.color;
        ctx.beginPath();
        ctx.arc(x + hair.x * width, y + hair.y * width, Math.max(0.3, (hair.w * width) / 2), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const px = p[(i - 1) * 3];
  const py = p[(i - 1) * 3 + 1];
  const mx = (px + x) / 2;
  const my = (py + y) / 2;
  const wEnd = (widthAt(stroke, i - 1) + widthAt(stroke, i)) / 2;
  if (i === 1) {
    drawSegment(ctx, stroke, [px, py], [(px + mx) / 2, (py + my) / 2], [mx, my], widthAt(stroke, 0), wEnd);
  } else {
    const ppx = p[(i - 2) * 3];
    const ppy = p[(i - 2) * 3 + 1];
    const wStart = (widthAt(stroke, i - 2) + widthAt(stroke, i - 1)) / 2;
    drawSegment(ctx, stroke, [(ppx + px) / 2, (ppy + py) / 2], [px, py], [mx, my], wStart, wEnd);
  }
}

/** Draws the last half segment, from the final midpoint to the final point. */
function drawEnd(ctx, stroke) {
  const n = stroke.p.length / 3;
  if (n < 2) return;
  const p = stroke.p;
  const x = p[(n - 1) * 3];
  const y = p[(n - 1) * 3 + 1];
  const mx = (p[(n - 2) * 3] + x) / 2;
  const my = (p[(n - 2) * 3 + 1] + y) / 2;
  const wStart = (widthAt(stroke, n - 2) + widthAt(stroke, n - 1)) / 2;
  drawSegment(ctx, stroke, [mx, my], [(mx + x) / 2, (my + y) / 2], [x, y], wStart, widthAt(stroke, n - 1));
}

/**
 * Replays a fill. It's stored as the exact pixels it covered, not the place that was clicked,
 * so it stays the same if the blob is later hidden or restyled. The filled area is cleared and
 * then everything is painted underneath ('destination-over'), which replaces an old color in
 * that area while leaving the soft edges of nearby lines on top.
 */
function drawFill(ctx, stroke) {
  const { k, c } = stroke;
  // A draft reopened at another screen density no longer lands on whole pixels, so overlap
  // the rows a little to stop gaps showing between them.
  const scale = ctx.getTransform().a;
  const extra = scale === k ? 0 : 1 / scale;
  const paint = (runs) => {
    for (let i = 0; i < runs.length; i += 3) ctx.fillRect(runs[i] / k, runs[i + 1] / k, runs[i + 2] / k, 1 / k + extra);
  };
  ctx.fillStyle = '#000';
  ctx.globalCompositeOperation = 'destination-out';
  paint(stroke.r);
  ctx.fillStyle = c;
  ctx.globalCompositeOperation = 'destination-over';
  paint(stroke.r);
  paint(stroke.d);
}

let markerScratch = null;

/**
 * Replays a marker stroke. Its pieces overlap, so drawing each one see-through would leave a
 * dark bead at every join. Instead the whole stroke goes on a scratch canvas at full strength,
 * which is then laid down once at the marker's opacity.
 */
function drawMarker(ctx, stroke) {
  const { width, height } = ctx.canvas;
  if (!markerScratch || markerScratch.width !== width || markerScratch.height !== height) {
    markerScratch = document.createElement('canvas');
    markerScratch.width = width;
    markerScratch.height = height;
  }
  const scratch = markerScratch.getContext('2d');
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, width, height);
  scratch.setTransform(ctx.getTransform());
  traceStroke(scratch, stroke);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = MARKER_ALPHA;
  ctx.drawImage(markerScratch, 0, 0);
}

/** Draws a whole stroke's path with its own style. */
function traceStroke(ctx, stroke) {
  applyStyle(ctx, stroke);
  const n = stroke.p.length / 3;
  for (let i = 0; i < n; i++) drawPoint(ctx, stroke, i);
  drawEnd(ctx, stroke);
}

/** Replays a whole stroke record. */
function drawStroke(ctx, stroke, logicalSize) {
  ctx.save();
  if (stroke.t === 'c') ctx.clearRect(0, 0, logicalSize, logicalSize);
  else if (stroke.t === 'f') drawFill(ctx, stroke);
  else if (stroke.b === 'marker') drawMarker(ctx, stroke);
  else traceStroke(ctx, stroke);
  ctx.restore();
}

export class DrawingLayer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {number} options.size
   * @param {number} [options.scale]
   * @param {() => void} [options.onChange]
   * @param {(ctx: CanvasRenderingContext2D) => void} [options.paintBackdrop] paints what's under
   *   the drawing, in artboard units, so the fill tool can stop at edges the artist can see
   */
  constructor(canvas, {
    size, scale = 1, onChange = () => {}, paintBackdrop = () => {},
  }) {
    this.canvas = canvas;
    this.size = size;
    this.scale = scale;
    this.onChange = onChange;
    this.paintBackdrop = paintBackdrop;
    canvas.width = Math.round(size * scale);
    canvas.height = Math.round(size * scale);
    this.ctx = canvas.getContext('2d');
    this.ctx.scale(scale, scale);

    /** Current tool settings. */
    this.tool = {
      tool: 'brush', brush: 'pen', color: '#1b1a17', size: 10, pressure: true,
    };
    this.lastPenAt = -Infinity;
    /** @type {Stroke[]} */
    this.strokes = [];
    /** @type {Stroke[]} */
    this.redoStack = [];
    /** Strokes that fell off the end of the history, flattened. Null while empty. */
    this.base = null;
    /** @type {Map<number, HTMLCanvasElement>} stroke count -> canvas copy at that point */
    this.snapshots = new Map();
    this.active = null;

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    canvas.addEventListener('pointerup', (e) => this.#up(e));
    canvas.addEventListener('pointercancel', (e) => this.#up(e));
  }

  /** @returns {boolean} whether anything is visibly drawn, going by the history */
  get hasArt() {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].t === 'c') return false;
      if (this.strokes[i].t === 'b' || this.strokes[i].t === 'f') return true;
    }
    // Only eraser strokes, or nothing at all: only the base can hold any art.
    return this.base !== null;
  }

  get canUndo() {
    return this.strokes.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  #toLogical(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      Math.round((((e.clientX - rect.left) / rect.width) * this.size) * 10) / 10,
      Math.round((((e.clientY - rect.top) / rect.height) * this.size) * 10) / 10,
    ];
  }

  #down(e) {
    const isPen = e.pointerType === 'pen';
    const isTouch = e.pointerType === 'touch';
    if (isPen) this.lastPenAt = performance.now();
    else if (isTouch && performance.now() - this.lastPenAt < PALM_REJECT_MS) return;
    // Button 5 is the eraser end of a pen.
    const penEraser = isPen && e.button === 5;
    if (e.button !== 0 && !penEraser) return;
    if (this.active) {
      // A palm that landed just before the pen shouldn't leave a mark or block the stroke.
      if (isPen && this.active.isTouch) this.#abandonStroke();
      else return;
    }
    e.preventDefault();
    if (this.tool.tool === 'fill' && !penEraser) {
      this.#fillAt(e);
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety. Drawing still works without it.
    }
    const [x, y] = this.#toLogical(e);
    const usePressure = isPen && this.tool.pressure;
    // Pens without a pressure sensor report 0.5 by spec, so 0 really does mean a very light
    // touch and must not be treated as missing.
    const pressure = usePressure ? e.pressure : 0.5;
    const eraser = this.tool.tool === 'eraser' || penEraser;
    const stroke = {
      t: eraser ? 'e' : 'b',
      c: this.tool.color,
      s: this.tool.size,
      pen: usePressure,
      p: [x, y, pressure],
    };
    if (!eraser && this.tool.brush !== 'pen') stroke.b = this.tool.brush;
    this.active = {
      id: e.pointerId, stroke, pressure, isTouch, target: this.ctx,
    };
    this.ctx.save();
    if (stroke.b === 'marker') {
      // See drawMarker. While drawing, the stroke builds up on a buffer that's shown over a
      // copy of the canvas from before it started.
      const buffer = this.#newCanvas();
      this.active.buffer = buffer;
      this.active.before = this.#copy();
      this.active.target = buffer.getContext('2d');
      this.active.target.scale(this.scale, this.scale);
    }
    applyStyle(this.active.target, stroke);
    drawPoint(this.active.target, stroke, 0);
    this.#presentMarker(0);
  }

  /**
   * Shows a marker stroke in progress. Only the area around the newest points is repainted,
   * since repainting a whole 2048 px canvas on every pointer move is too slow on phones.
   * @param {number} fromPoint index of the first point added since the last call
   */
  #presentMarker(fromPoint) {
    const { buffer, before, stroke } = this.active;
    if (!buffer) return;
    const p = stroke.p;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = Math.max(0, fromPoint - 2); i < p.length / 3; i++) {
      minX = Math.min(minX, p[i * 3]);
      maxX = Math.max(maxX, p[i * 3]);
      minY = Math.min(minY, p[i * 3 + 1]);
      maxY = Math.max(maxY, p[i * 3 + 1]);
    }
    const margin = stroke.s + 2; // pressure can make the line almost twice the set size
    const x = Math.floor((minX - margin) * this.scale);
    const y = Math.floor((minY - margin) * this.scale);
    const w = Math.ceil((maxX - minX + margin * 2) * this.scale);
    const h = Math.ceil((maxY - minY + margin * 2) * this.scale);
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.clearRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.drawImage(before, 0, 0);
    ctx.globalAlpha = MARKER_ALPHA;
    ctx.drawImage(buffer, 0, 0);
    ctx.restore();
  }

  /**
   * Fills from the clicked point, going by what the artist sees: the paper and blob with the
   * drawing on top. So a click can fill the blob up to its edge as well as a drawn outline.
   */
  #fillAt(e) {
    const scratch = this.#newCanvas();
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.scale(this.scale, this.scale);
    this.paintBackdrop(ctx);
    ctx.restore();
    ctx.drawImage(this.canvas, 0, 0);
    const { width, height } = scratch;
    const { data } = ctx.getImageData(0, 0, width, height);
    const [lx, ly] = this.#toLogical(e);
    const x = Math.max(0, Math.min(width - 1, Math.floor(lx * this.scale)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(ly * this.scale)));

    // Filling an area with the color it already is would only add an empty undo step.
    const value = parseInt(this.tool.color.slice(1), 16);
    const seed = (y * width + x) * 4;
    if (data[seed] === (value >> 16) && data[seed + 1] === ((value >> 8) & 255) && data[seed + 2] === (value & 255)) return;

    const { runs, fringe } = floodFill(data, width, height, x, y, {
      tolerance: FILL_TOLERANCE,
      fringe: Math.max(1, Math.round(this.scale)),
    });
    const stroke = {
      t: 'f', c: this.tool.color, k: this.scale, r: runs, d: fringe,
    };
    drawStroke(this.ctx, stroke, this.size);
    this.#commit(stroke);
  }

  /** @returns {ImageData} the drawing's pixels, read from a copy to keep this canvas GPU-backed */
  readPixels() {
    const scratch = this.#newCanvas();
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.canvas, 0, 0);
    return ctx.getImageData(0, 0, scratch.width, scratch.height);
  }

  /** Drops the stroke in progress and redraws without it. */
  #abandonStroke() {
    this.ctx.restore();
    this.active = null;
    this.#rebuild();
  }

  #move(e) {
    // A pen hovering near the screen counts as seen, since the hand is usually down by then.
    if (e.pointerType === 'pen') this.lastPenAt = performance.now();
    if (!this.active || e.pointerId !== this.active.id) return;
    // Coalesced events recover the samples that arrived between animation frames,
    // which matters most for fast pen strokes.
    const events = e.getCoalescedEvents?.() ?? [];
    const before = this.active.stroke.p.length / 3;
    for (const ev of events.length > 0 ? events : [e]) this.#addPoint(ev);
    this.#presentMarker(before);
  }

  #addPoint(e) {
    const { stroke } = this.active;
    const [x, y] = this.#toLogical(e);
    const p = stroke.p;
    const n = p.length / 3;
    if (Math.abs(p[(n - 1) * 3] - x) < 0.5 && Math.abs(p[(n - 1) * 3 + 1] - y) < 0.5) return;
    // Pressure jitters from sample to sample, so ease toward each new value.
    if (stroke.pen) this.active.pressure = this.active.pressure * 0.6 + e.pressure * 0.4;
    p.push(x, y, Math.round(this.active.pressure * 100) / 100);
    drawPoint(this.active.target, stroke, n);
  }

  #up(e) {
    if (e.pointerType === 'pen') this.lastPenAt = performance.now();
    if (!this.active || e.pointerId !== this.active.id) return;
    const { stroke, target } = this.active;
    drawEnd(target, stroke);
    this.#presentMarker(stroke.p.length / 3 - 1);
    this.ctx.restore();
    this.active = null;
    this.#commit(stroke);
  }

  #commit(stroke) {
    this.redoStack = [];
    for (const key of this.snapshots.keys()) {
      if (key > this.strokes.length) this.snapshots.delete(key);
    }
    this.strokes.push(stroke);
    this.#trimHistory();
    if (this.strokes.length % SNAPSHOT_EVERY === 0) this.snapshots.set(this.strokes.length, this.#copy());
    this.onChange();
  }

  /** Past the cap, flatten the oldest strokes into the base. Those can't be undone any more. */
  #trimHistory() {
    if (this.strokes.length <= MAX_HISTORY) return;
    const scratch = this.#newCanvas();
    const ctx = scratch.getContext('2d');
    if (this.base) ctx.drawImage(this.base, 0, 0);
    ctx.scale(this.scale, this.scale);
    for (const stroke of this.strokes.splice(0, BAKE_COUNT)) drawStroke(ctx, stroke, this.size);
    this.base = scratch;
    this.baseVersion = (this.baseVersion ?? 0) + 1;
    const shifted = new Map();
    for (const [key, snap] of this.snapshots) {
      if (key > BAKE_COUNT) shifted.set(key - BAKE_COUNT, snap);
    }
    this.snapshots = shifted;
  }

  #newCanvas() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    return c;
  }

  #copy() {
    const c = this.#newCanvas();
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c;
  }

  /** Redraws the visible canvas from the best snapshot plus the strokes after it. */
  #rebuild() {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let start = 0;
    let bestSnap = null;
    for (const [key, snap] of this.snapshots) {
      if (key <= this.strokes.length && key > start) {
        start = key;
        bestSnap = snap;
      }
    }
    if (bestSnap) ctx.drawImage(bestSnap, 0, 0);
    else if (this.base) ctx.drawImage(this.base, 0, 0);
    ctx.restore();
    for (let i = start; i < this.strokes.length; i++) drawStroke(ctx, this.strokes[i], this.size);
  }

  undo() {
    if (!this.canUndo || this.active) return;
    this.redoStack.push(this.strokes.pop());
    this.#rebuild();
    this.onChange();
  }

  redo() {
    if (!this.canRedo || this.active) return;
    const stroke = this.redoStack.pop();
    this.strokes.push(stroke);
    drawStroke(this.ctx, stroke, this.size);
    this.onChange();
  }

  /** Clears the canvas as an undoable step. */
  clear() {
    if (!this.hasArt || this.active) return;
    const stroke = { t: 'c' };
    drawStroke(this.ctx, stroke, this.size);
    this.#commit(stroke);
  }

  /** Wipes everything, history included, without firing onChange. */
  reset() {
    if (this.active) this.ctx.restore(); // balances the save from the unfinished stroke
    this.active = null;
    this.strokes = [];
    this.redoStack = [];
    this.base = null;
    this.baseVersion = 0;
    this.baseBlob = null;
    this.snapshots.clear();
    this.#rebuild();
  }

  /**
   * Restores saved state without firing onChange.
   * @param {{ strokes?: Stroke[], baseBlob?: Blob|null }} state
   */
  async load({ strokes = [], baseBlob = null }) {
    this.reset();
    if (baseBlob) {
      const bitmap = await createImageBitmap(baseBlob);
      const base = this.#newCanvas();
      base.getContext('2d').drawImage(bitmap, 0, 0, base.width, base.height);
      bitmap.close();
      this.base = base;
      this.baseBlob = baseBlob;
      this.baseBlobVersion = this.baseVersion;
    }
    this.strokes = strokes;
    this.#rebuild();
  }

  /**
   * State for autosaving: the stroke list, plus the flattened base as a PNG if there is one.
   * @returns {Promise<{ strokes: Stroke[], baseBlob: Blob|null }>}
   */
  async getState() {
    if (!this.base) return { strokes: this.strokes, baseBlob: null };
    if (!this.baseBlob || this.baseBlobVersion !== this.baseVersion) {
      this.baseBlob = await new Promise((resolve) => { this.base.toBlob(resolve, 'image/png'); });
      this.baseBlobVersion = this.baseVersion;
    }
    return { strokes: this.strokes, baseBlob: this.baseBlob };
  }
}
