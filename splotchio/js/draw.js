// The drawing layer: a canvas, Pointer Events input, and undo/redo.
//
// Strokes are records (points plus tool settings), not pixels. Undo replays them from
// the nearest cached snapshot, so it stays fast without keeping a bitmap per step.

const MAX_HISTORY = 100;
const SNAPSHOT_EVERY = 20;
const BAKE_COUNT = SNAPSHOT_EVERY;

// A hand resting on a tablet registers as touch. Ignore touch for this long after the pen was
// last seen, which covers the moment before a stroke and the pauses between strokes.
const PALM_REJECT_MS = 1500;

/**
 * @typedef {object} Stroke
 * @property {'b'|'e'|'c'} t brush, eraser or clear
 * @property {string} [c] color
 * @property {number} [s] size in artboard units
 * @property {boolean} [pen] whether width follows pressure
 * @property {number[]} [p] flat list of x, y, pressure
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

/** Applies one stroke's tool settings to a context. */
function applyStyle(ctx, stroke) {
  ctx.globalCompositeOperation = stroke.t === 'e' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.t === 'e' ? '#000' : stroke.c;
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
    ctx.beginPath();
    ctx.arc(x, y, widthAt(stroke, 0) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const px = p[(i - 1) * 3];
  const py = p[(i - 1) * 3 + 1];
  const mx = (px + x) / 2;
  const my = (py + y) / 2;
  if (stroke.pen) {
    const wEnd = (widthAt(stroke, i - 1) + widthAt(stroke, i)) / 2;
    if (i === 1) {
      drawTaperedCurve(ctx, [px, py], [(px + mx) / 2, (py + my) / 2], [mx, my], widthAt(stroke, 0), wEnd);
    } else {
      const ppx = p[(i - 2) * 3];
      const ppy = p[(i - 2) * 3 + 1];
      const wStart = (widthAt(stroke, i - 2) + widthAt(stroke, i - 1)) / 2;
      drawTaperedCurve(ctx, [(ppx + px) / 2, (ppy + py) / 2], [px, py], [mx, my], wStart, wEnd);
    }
    return;
  }
  ctx.lineWidth = widthAt(stroke, i - 1);
  ctx.beginPath();
  if (i === 1) {
    ctx.moveTo(px, py);
    ctx.lineTo(mx, my);
  } else {
    const ppx = p[(i - 2) * 3];
    const ppy = p[(i - 2) * 3 + 1];
    ctx.moveTo((ppx + px) / 2, (ppy + py) / 2);
    ctx.quadraticCurveTo(px, py, mx, my);
  }
  ctx.stroke();
}

/** Draws the last half segment, from the final midpoint to the final point. */
function drawEnd(ctx, stroke) {
  const n = stroke.p.length / 3;
  if (n < 2) return;
  const p = stroke.p;
  const x = p[(n - 1) * 3];
  const y = p[(n - 1) * 3 + 1];
  const px = p[(n - 2) * 3];
  const py = p[(n - 2) * 3 + 1];
  if (stroke.pen) {
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    const wStart = (widthAt(stroke, n - 2) + widthAt(stroke, n - 1)) / 2;
    drawTaperedCurve(ctx, [mx, my], [(mx + x) / 2, (my + y) / 2], [x, y], wStart, widthAt(stroke, n - 1));
    return;
  }
  ctx.lineWidth = widthAt(stroke, n - 1);
  ctx.beginPath();
  ctx.moveTo((px + x) / 2, (py + y) / 2);
  ctx.lineTo(x, y);
  ctx.stroke();
}

/** Replays a whole stroke record. */
function drawStroke(ctx, stroke, logicalSize) {
  ctx.save();
  if (stroke.t === 'c') {
    ctx.clearRect(0, 0, logicalSize, logicalSize);
  } else {
    applyStyle(ctx, stroke);
    const n = stroke.p.length / 3;
    for (let i = 0; i < n; i++) drawPoint(ctx, stroke, i);
    drawEnd(ctx, stroke);
  }
  ctx.restore();
}

export class DrawingLayer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ size: number, scale?: number, onChange?: () => void }} options
   */
  constructor(canvas, { size, scale = 1, onChange = () => {} }) {
    this.canvas = canvas;
    this.size = size;
    this.scale = scale;
    this.onChange = onChange;
    canvas.width = Math.round(size * scale);
    canvas.height = Math.round(size * scale);
    this.ctx = canvas.getContext('2d');
    this.ctx.scale(scale, scale);

    /** Current tool settings. */
    this.tool = { tool: 'brush', color: '#1b1a17', size: 10, pressure: true };
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
      if (this.strokes[i].t === 'b') return true;
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
    this.active = { id: e.pointerId, stroke, pressure, isTouch };
    this.ctx.save();
    applyStyle(this.ctx, stroke);
    drawPoint(this.ctx, stroke, 0);
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
    for (const ev of events.length > 0 ? events : [e]) this.#addPoint(ev);
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
    drawPoint(this.ctx, stroke, n);
  }

  #up(e) {
    if (e.pointerType === 'pen') this.lastPenAt = performance.now();
    if (!this.active || e.pointerId !== this.active.id) return;
    const { stroke } = this.active;
    drawEnd(this.ctx, stroke);
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
