// Runs one stroke from pointer down to commit. Input can arrive many times per frame, but the GPU work
// happens at most once per frame, and nothing is read back from the GPU until the stroke ends.

import { BrushStroke, StrokeSurface } from './brush.js';

// Stroke canvases are bigger than the screen so paint stays crisp when you zoom in later, up to a limit.
const MAX_CANVAS = 4096;

export class Painter {
  /**
   * @param {object} deps
   * @param {import('./passes.js').PassStore} deps.passes
   * @param {import('./projector.js').Projector} deps.projector
   */
  constructor({ passes, projector }) {
    this.passes = passes;
    this.projector = projector;
    this.stroke = null;
    this.surface3d = null;
    this.surfaceUv = null;
    this.active = null;
    this.needsFrame = false;
  }

  get painting() {
    return this.active !== null;
  }

  /** The pass being previewed through the spare target, or null when idle. */
  get previewPass() {
    return this.active?.pass ?? null;
  }

  /**
   * Starts a stroke from a 3D view.
   * @param {object} view
   * @param {import('three').PerspectiveCamera} view.camera
   * @param {number} view.width CSS pixels
   * @param {number} view.height CSS pixels
   * @param {number} view.pixelRatio
   * @param {boolean} view.doubleSided
   * @param {object} tool see #begin
   */
  begin3d(view, tool) {
    const { width, height, pixelRatio } = view;
    const k = Math.min(Math.max(pixelRatio, 1.5), MAX_CANVAS / Math.max(width, height));
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    if (!this.surface3d || this.surface3d.canvas.width !== w || this.surface3d.canvas.height !== h) {
      this.surface3d = new StrokeSurface(w, h);
    }
    this.surface3d.setTransform(k, 0, 0);
    this.projector.renderDepth(view.camera, Math.round(width * pixelRatio), Math.round(height * pixelRatio));
    this.projector.beginCanvas(w, h);
    this.#begin(this.surface3d, { kind: '3d', doubleSided: view.doubleSided }, tool);
  }

  /**
   * Starts a stroke from the UV view. Its canvas is the texture itself, with brush sizes still in
   * screen pixels: the transform carries CSS pixels straight onto texture pixels.
   * @param {import('../view/uvview.js').UvView} uv
   * @param {object} tool see #begin
   */
  beginUv(uv, tool) {
    const { res } = this.passes;
    if (!this.surfaceUv || this.surfaceUv.canvas.width !== res) this.surfaceUv = new StrokeSurface(res, res);
    const k = res / uv.zoom;
    this.surfaceUv.setTransform(k, -uv.panX * k, -uv.panY * k);
    this.projector.beginCanvas(res, res);
    this.#begin(this.surfaceUv, { kind: 'uv' }, tool);
  }

  /**
   * @param {StrokeSurface} surface
   * @param {object} target
   * @param {object} tool
   * @param {string} tool.pass lit, shadow or edge
   * @param {'pencil'|'pen'|'marker'|'paint'} tool.brush
   * @param {string} tool.color
   * @param {number} tool.size CSS pixels
   * @param {number} tool.opacity 0..1
   * @param {number} tool.spacing fraction of the size
   * @param {boolean} tool.usePressure
   * @param {number} tool.curve
   * @param {boolean} tool.erase
   */
  #begin(surface, target, tool) {
    this.stroke = new BrushStroke(surface, tool);
    this.active = {
      ...target,
      surface,
      pass: tool.pass,
      erase: tool.erase,
      opacity: tool.opacity * (tool.erase ? 1 : this.stroke.layerAlpha),
    };
  }

  /** Adds an input sample in CSS pixels. Cheap: this only draws on the 2D canvas. */
  add(x, y, pressure) {
    if (!this.stroke) return;
    this.stroke.add(x, y, pressure);
    if (this.active.surface.dirty) this.needsFrame = true;
  }

  /**
   * Sends this frame's new stroke pixels through to the preview. Called from the render loop.
   * @returns {boolean} whether anything changed on screen
   */
  frame() {
    if (!this.active || !this.needsFrame) return false;
    this.needsFrame = false;
    this.#flush();
    return true;
  }

  #flush() {
    const {
      surface, kind, pass, opacity, erase, doubleSided,
    } = this.active;
    const part = surface.takeDirty();
    if (part) this.projector.uploadCanvas(part);
    if (kind === '3d') this.projector.projectToUv(this.passes.strokeTarget, doubleSided);
    else this.projector.copyToUv(this.passes.strokeTarget);
    this.passes.composite(pass, { opacity, erase });
  }

  /** Ends the stroke and commits it as one undo step. */
  end() {
    if (!this.active) return false;
    this.stroke.finish();
    const { surface } = this.active;
    this.#flush();
    const label = this.active.erase ? 'Erase' : 'Paint';
    const changed = this.passes.commit(this.active.pass, label);
    this.#reset(surface);
    return changed;
  }

  /** Drops the stroke in progress, leaving the pass untouched. */
  cancel() {
    if (!this.active) return;
    this.stroke.finish();
    this.#reset(this.active.surface);
  }

  #reset(surface) {
    surface.clear();
    this.passes.clearStroke();
    this.active = null;
    this.stroke = null;
    this.needsFrame = false;
  }

  /** Frees the canvases, which belong to one project's size. */
  dropSurfaces() {
    this.surface3d = null;
    this.surfaceUv = null;
  }
}
