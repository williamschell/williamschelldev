// The brush. This is Splotchle's engine, not a new one: strokes are the same records, drawn by the
// same drawPoint and drawEnd on a 2D canvas, with the same pencil grain and paintbrush bristles.
// What this file adds is what the painter's spec asks for on top: each brush's response to pressure,
// the pressure curve, spacing, stroke opacity and the marker's flat tip.
//
// The canvas a stroke lands on is the stroke buffer. Because it holds the whole stroke so far, a
// marker can't build up within a stroke, and opacity applies once to the finished shape.

import { applyStyle, drawEnd, drawPoint } from '../../../splotchle/js/draw.js';
import { MARKER_ALPHA, hairsFor } from '../../../splotchle/js/brushes.js';

/**
 * Brush tips in the order the UI lists them. `size` is the default diameter in screen pixels.
 * @type {{ id: string, name: string, size: number, opacity: number, spacing: number }[]}
 */
export const BRUSHES = [
  { id: 'pencil', name: 'Pencil', size: 6, opacity: 1, spacing: 0.02 },
  { id: 'pen', name: 'Pen', size: 10, opacity: 1, spacing: 0.02 },
  { id: 'marker', name: 'Marker', size: 34, opacity: 1, spacing: 0.02 },
  { id: 'paint', name: 'Paintbrush', size: 44, opacity: 1, spacing: 0.02 },
];

const lerp = (a, b, t) => a + (b - a) * t;

// Splotchle turns stored pressure into width as size * (0.2 + 1.6 * p). This goes the other way,
// so a brush can ask for a width factor and still draw through Splotchle's own code.
const pressureForWidth = (factor) => (factor - 0.2) / 1.6;

/**
 * How one brush answers to pressure. `width` is a factor on the set size and `alpha` is the
 * strength of the segment. The pen is left to Splotchle's own response.
 * @type {Record<string, (p: number) => { stored: number, alpha: number }>}
 */
const PRESSURE = {
  pen: (p) => ({ stored: p, alpha: 1 }),
  pencil: (p) => ({ stored: pressureForWidth(lerp(0.85, 1.15, p)), alpha: lerp(0.3, 1, p) }),
  marker: () => ({ stored: 0.5, alpha: 1 }),
  paint: (p) => ({ stored: pressureForWidth(lerp(0.45, 1.5, p)), alpha: lerp(0.5, 1, p) }),
};

/**
 * Shapes raw pen pressure. Below 1 the pen feels soft (light touches read as harder), and above 1
 * it feels firm.
 * @param {number} pressure 0..1
 * @param {number} gamma
 * @returns {number}
 */
export function applyPressureCurve(pressure, gamma) {
  return Math.min(1, Math.max(0, pressure)) ** gamma;
}

// Bristle pieces overlap by this much, in CSS pixels, so their antialiased ends can't leave hairline gaps.
const BRISTLE_OVERLAP = 0.75;
// Below this pressure, a share of the bristles lift off the surface and the stroke goes dry.
const DRY_PRESSURE = 0.55;
const GOLDEN = 0.618034;

// The marker's nib is a short slanted line. Sweeping it along the path makes strokes wide in one
// direction and thin in the other, like a real chisel tip.
const NIB_ANGLE = -Math.PI / 4;
const NIB_LENGTH = 0.7;
const NIB_THICKNESS = 0.32;

/** The canvas one stroke is drawn on, plus which part of it changed since the last upload. */
export class StrokeSurface {
  /**
   * @param {number} width canvas pixels
   * @param {number} height canvas pixels
   */
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    // Software backed on purpose: the changed rectangle is read back for upload every frame, and
    // that has to be cheap and can't touch the GPU during a stroke.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    /** Everything drawn since the last clear, in canvas pixels. */
    this.total = null;
    /** Everything drawn since the last upload, in canvas pixels. */
    this.dirty = null;
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;
  }

  /** Sets how logical units (CSS pixels) map onto this canvas. */
  setTransform(scale, originX, originY) {
    this.scale = scale;
    this.originX = originX;
    this.originY = originY;
    this.ctx.setTransform(scale, 0, 0, scale, originX, originY);
  }

  /** Records that a box given in logical units has been drawn on. */
  touch(minX, minY, maxX, maxY) {
    const x0 = Math.max(0, Math.floor(minX * this.scale + this.originX));
    const y0 = Math.max(0, Math.floor(minY * this.scale + this.originY));
    const x1 = Math.min(this.canvas.width, Math.ceil(maxX * this.scale + this.originX));
    const y1 = Math.min(this.canvas.height, Math.ceil(maxY * this.scale + this.originY));
    if (x1 <= x0 || y1 <= y0) return;
    this.dirty = unite(this.dirty, x0, y0, x1, y1);
    this.total = unite(this.total, x0, y0, x1, y1);
  }

  /**
   * Hands over the changed pixels since the last call.
   * @returns {{ x: number, y: number, image: ImageData }|null}
   */
  takeDirty() {
    if (!this.dirty) return null;
    const { x0, y0, x1, y1 } = this.dirty;
    this.dirty = null;
    return { x: x0, y: y0, image: this.ctx.getImageData(x0, y0, x1 - x0, y1 - y0) };
  }

  /** Empties the canvas. Only the used part is cleared, since a 4096 px clear isn't free. */
  clear() {
    if (this.total) {
      const { x0, y0, x1, y1 } = this.total;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      this.ctx.restore();
    }
    this.total = null;
    this.dirty = null;
  }
}

function unite(box, x0, y0, x1, y1) {
  if (!box) return { x0, y0, x1, y1 };
  return {
    x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x1), y1: Math.max(box.y1, y1),
  };
}

/** One stroke in progress. Coordinates are CSS pixels. */
export class BrushStroke {
  /**
   * @param {StrokeSurface} surface
   * @param {object} options
   * @param {'pencil'|'pen'|'marker'|'paint'} options.brush
   * @param {string} options.color '#rrggbb'
   * @param {number} options.size diameter in CSS pixels
   * @param {number} options.spacing how far apart input points must be, as a fraction of the size
   * @param {boolean} options.usePressure
   * @param {number} options.curve pressure curve gamma
   */
  constructor(surface, {
    brush, color, size, spacing, usePressure, curve,
  }) {
    this.surface = surface;
    this.brush = brush;
    this.curve = curve;
    this.minStep = Math.max(0.5, spacing * size);
    this.usePressure = usePressure;
    this.record = {
      t: 'b',
      c: color,
      s: size,
      pen: usePressure && brush !== 'marker',
      p: [],
    };
    // Splotchle leaves `b` off for its pen.
    if (brush !== 'pen') this.record.b = brush;
    this.smoothed = 0.5;
    this.ctx = surface.ctx;
    this.ctx.save();
    this.ctx.globalAlpha = 1;
    applyStyle(this.ctx, this.record);
    if (brush === 'marker') {
      this.nib = this.#makeNib();
      // The nib lines share the stroke's points, so they need no separate record of them.
      this.subRecord = { ...this.record, s: size * NIB_THICKNESS };
    }
  }

  /** How the finished stroke gets laid down, as a factor on the user's opacity. */
  get layerAlpha() {
    return this.brush === 'marker' ? MARKER_ALPHA : 1;
  }

  #makeNib() {
    const { s } = this.record;
    const count = Math.max(3, Math.ceil((NIB_LENGTH / NIB_THICKNESS) * 2));
    const nib = [];
    for (let i = 0; i < count; i++) {
      const along = (i / (count - 1) - 0.5) * NIB_LENGTH * s;
      nib.push([Math.cos(NIB_ANGLE) * along, Math.sin(NIB_ANGLE) * along]);
    }
    return nib;
  }

  #stored(pressure) {
    const shaped = applyPressureCurve(pressure, this.curve);
    return PRESSURE[this.brush](shaped);
  }

  /**
   * One piece of a paintbrush stroke. Same curve and same hairs as Splotchle's drawBristles, plus
   * the overlap between pieces and the dry-brush falloff.
   * @param {number[]} start
   * @param {number[]} control
   * @param {number[]} end
   * @param {number} width
   * @param {number} pressure shaped pressure, 0..1
   */
  #drawBristles([sx, sy], [cx, cy], [ex, ey], width, pressure) {
    const { ctx, record } = this;
    const dx = cx - sx;
    const dy = cy - sy;
    const length = Math.hypot(dx, dy) || 1;
    const backX = (dx / length) * BRISTLE_OVERLAP;
    const backY = (dy / length) * BRISTLE_OVERLAP;
    const dry = this.usePressure ? Math.max(0, DRY_PRESSURE - pressure) : 0;
    ctx.lineCap = 'butt';
    // Hairs sit at different spots along the direction of travel, so each one's next piece begins at a
    // slightly different place. Drawn in a fixed order, a piece can land over the tail of a hair that
    // should be above it, which leaves a tooth at every input sample. Drawing the furthest-ahead hairs
    // first means no piece ever overlaps the previous piece of a hair that belongs above it.
    const order = hairsFor(record)
      .map((hair, h) => ({ hair, h, along: hair.x * dx + hair.y * dy }))
      .sort((a, b) => b.along - a.along);
    for (const { hair, h } of order) {
      // A fixed share per hair, so the same bristles lift together and leave long dry streaks.
      if (((h + 1) * GOLDEN) % 1 < dry) continue;
      const ox = hair.x * width;
      const oy = hair.y * width;
      ctx.strokeStyle = hair.color;
      ctx.lineWidth = Math.max(0.6, hair.w * width);
      ctx.beginPath();
      ctx.moveTo(sx + ox - backX, sy + oy - backY);
      ctx.lineTo(sx + ox, sy + oy);
      ctx.quadraticCurveTo(cx + ox, cy + oy, ex + ox, ey + oy);
      ctx.stroke();
    }
  }

  /** Width at a point, using Splotchle's rule. */
  #widthAt(i) {
    const { record } = this;
    return record.pen ? record.s * (0.2 + 1.6 * record.p[i * 3 + 2]) : record.s;
  }

  /** Draws the bristle piece that point i adds, with midpoints as ends, as Splotchle's drawPoint does. */
  #drawBristlePoint(i, shaped) {
    const { p } = this.record;
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const px = p[(i - 1) * 3];
    const py = p[(i - 1) * 3 + 1];
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    const wEnd = (this.#widthAt(i - 1) + this.#widthAt(i)) / 2;
    if (i === 1) {
      const wStart = this.#widthAt(0);
      this.#drawBristles([px, py], [(px + mx) / 2, (py + my) / 2], [mx, my], (wStart + wEnd) / 2, shaped);
      return;
    }
    const ppx = p[(i - 2) * 3];
    const ppy = p[(i - 2) * 3 + 1];
    const wStart = (this.#widthAt(i - 2) + this.#widthAt(i - 1)) / 2;
    this.#drawBristles([(ppx + px) / 2, (ppy + py) / 2], [px, py], [mx, my], (wStart + wEnd) / 2, shaped);
  }

  #drawPoint(i, alpha, shaped) {
    const { ctx, record } = this;
    ctx.globalAlpha = alpha;
    if (record.b === 'paint' && i > 0) {
      this.#drawBristlePoint(i, shaped);
    } else if (this.nib) {
      for (const [ox, oy] of this.nib) {
        ctx.translate(ox, oy);
        drawPoint(ctx, this.subRecord, i);
        ctx.translate(-ox, -oy);
      }
    } else {
      drawPoint(ctx, record, i);
    }
  }

  #touch(fromIndex) {
    const { p, s } = this.record;
    const n = p.length / 3;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = Math.max(0, fromIndex - 2); i < n; i++) {
      minX = Math.min(minX, p[i * 3]);
      maxX = Math.max(maxX, p[i * 3]);
      minY = Math.min(minY, p[i * 3 + 1]);
      maxY = Math.max(maxY, p[i * 3 + 1]);
    }
    // Pressure can reach 180% of the set size, and the marker's nib reaches further than its line.
    const margin = s * 1.3 + 2;
    this.surface.touch(minX - margin, minY - margin, maxX + margin, maxY + margin);
  }

  /** Adds an input sample. The first one starts the stroke. */
  add(x, y, pressure) {
    const { record } = this;
    const { p } = record;
    const n = p.length / 3;
    const rx = Math.round(x * 10) / 10;
    const ry = Math.round(y * 10) / 10;
    if (n > 0) {
      const dx = p[(n - 1) * 3] - rx;
      const dy = p[(n - 1) * 3 + 1] - ry;
      if (Math.abs(dx) < this.minStep && Math.abs(dy) < this.minStep) return;
    }
    // Pressure jitters from sample to sample, so ease toward each new value (as Splotchle does).
    if (this.usePressure) this.smoothed = n === 0 ? pressure : this.smoothed * 0.6 + pressure * 0.4;
    const shaped = this.usePressure ? this.#stored(this.smoothed) : { stored: 0.5, alpha: 1 };
    p.push(rx, ry, Math.round(shaped.stored * 100) / 100);
    const curved = this.usePressure ? applyPressureCurve(this.smoothed, this.curve) : 1;
    this.#drawPoint(n, shaped.alpha, curved);
    this.lastAlpha = shaped.alpha;
    this.lastCurved = curved;
    this.#touch(n);
  }

  /** Draws the last half segment and gives the canvas settings back. */
  finish() {
    const { ctx, record } = this;
    if (record.p.length > 0) {
      ctx.globalAlpha = this.lastAlpha ?? 1;
      const n = record.p.length / 3;
      if (record.b === 'paint' && n >= 2) {
        const { p } = record;
        const x = p[(n - 1) * 3];
        const y = p[(n - 1) * 3 + 1];
        const mx = (p[(n - 2) * 3] + x) / 2;
        const my = (p[(n - 2) * 3 + 1] + y) / 2;
        const wStart = (this.#widthAt(n - 2) + this.#widthAt(n - 1)) / 2;
        this.#drawBristles([mx, my], [(mx + x) / 2, (my + y) / 2], [x, y], (wStart + this.#widthAt(n - 1)) / 2, this.lastCurved);
      } else if (this.nib) {
        for (const [ox, oy] of this.nib) {
          ctx.translate(ox, oy);
          drawEnd(ctx, this.subRecord);
          ctx.translate(-ox, -oy);
        }
      } else {
        drawEnd(ctx, record);
      }
      this.#touch(record.p.length / 3 - 1);
    }
    ctx.restore();
  }
}
