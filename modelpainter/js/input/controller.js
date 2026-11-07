// All viewport input: pointers, wheel, keyboard and touch. It translates raw events into engine
// calls, and owns no painting logic of its own.

import * as THREE from 'three';
import { PALM_REJECT_MS } from '../../../splotchle/js/draw.js';
import { actionFor, bindingFor, settings } from '../core/settings.js';

const target = new THREE.Vector3();
const BTN_LEFT = 0;
const BTN_PEN_ERASER = 5;
const BUTTON_MASK = {
  0: 1, 1: 4, 2: 2, 5: 32,
};

/** True when keystrokes should go to a form control instead of the shortcuts. */
function typingInto(element) {
  if (!element) return false;
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable) return true;
  if (element.tagName !== 'INPUT') return false;
  return !['range', 'checkbox', 'radio', 'button'].includes(element.type);
}

export class InputController {
  /**
   * @param {import('../core/engine.js').Engine} engine
   * @param {object} hooks
   * @param {(action: string) => void} hooks.onAction keyboard actions the UI handles
   * @param {(color: string) => void} hooks.onPick the eyedropper found a color
   * @param {() => void} hooks.onToolChange size or opacity changed from the keyboard
   * @param {HTMLElement} hooks.brushCircle a DOM circle for when the surface ring can't show
   */
  constructor(engine, hooks) {
    this.engine = engine;
    this.hooks = hooks;
    this.canvas = engine.canvas;
    this.keys = new Set();
    this.gesture = null;
    this.lastPenAt = -Infinity;
    this.touches = new Map();
    this.touchGesture = null;
    this.pointer = null;

    const { canvas } = this;
    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    canvas.addEventListener('pointerup', (e) => this.#up(e));
    canvas.addEventListener('pointercancel', (e) => this.#up(e, true));
    canvas.addEventListener('pointerleave', () => this.#leave());
    canvas.addEventListener('wheel', (e) => this.#wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // The middle button would otherwise start the browser's autoscroll.
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    window.addEventListener('keydown', (e) => this.#keyDown(e));
    window.addEventListener('keyup', (e) => this.#keyUp(e));
    window.addEventListener('blur', () => this.#releaseAll());
    engine.frameHooks.push((dt) => this.#frame(dt));
  }

  // Pointer -------------------------------------------------------------------------------------

  #capture(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety. Gestures still work without it.
    }
  }

  #down(e) {
    const { engine } = this;
    if (!engine.project) return;
    this.canvas.focus({ preventScroll: true });
    const isPen = e.pointerType === 'pen';
    if (isPen) this.lastPenAt = performance.now();
    if (e.pointerType === 'touch') {
      this.#touchDown(e);
      return;
    }
    // A palm that landed just before the pen shouldn't leave a mark or block the stroke.
    if (isPen && this.gesture?.touch) {
      if (this.gesture.type === 'paint') engine.strokeCancel();
      this.gesture = null;
      this.touches.clear();
    }
    if (this.gesture) return;
    const view = engine.viewAt(e.clientX, e.clientY);
    if (!view) return;
    e.preventDefault();
    this.#capture(e);
    const { button } = e;
    const start = {
      id: e.pointerId, button, lastX: e.clientX, lastY: e.clientY, view,
    };

    // Held-key gestures come first, so a pen with no barrel buttons can do everything.
    if (this.keys.has(bindingFor('lightDrag')) && view.kind === '3d' && button === BTN_LEFT) {
      this.gesture = { ...start, type: 'light' };
      return;
    }
    if (settings.spaceGestures && this.keys.has('Space') && button === BTN_LEFT) {
      if (view.kind === 'uv') {
        this.gesture = { ...start, type: 'panUv' };
      } else if (e.ctrlKey || e.metaKey) {
        this.gesture = { ...start, type: 'dolly' };
      } else if (e.shiftKey) {
        this.gesture = { ...start, type: 'pan' };
      } else {
        this.#beginOrbit(start, view);
      }
      return;
    }

    if (button === settings.flyButton || button === settings.orbitButton) {
      if (view.kind === 'uv') {
        this.gesture = { ...start, type: 'panUv' };
      } else if (button === settings.flyButton) {
        this.gesture = { ...start, type: 'fly' };
        engine.hideCursor();
        this.#setCircle(null);
        if (e.pointerType === 'mouse') this.canvas.requestPointerLock?.()?.catch?.(() => {});
      } else if (e.shiftKey) {
        this.gesture = { ...start, type: 'pan' };
      } else {
        this.#beginOrbit(start, view);
      }
      return;
    }

    if (button !== BTN_LEFT && button !== BTN_PEN_ERASER) return;
    this.#beginTool(e, start, view, isPen, button === BTN_PEN_ERASER);
  }

  #beginOrbit(start, view) {
    const hit = this.engine.pick(view.x, view.y);
    if (hit) this.engine.rig.pivot.copy(hit.point);
    this.engine.showPivot(true);
    this.engine.hideCursor();
    this.gesture = { ...start, type: 'orbit' };
  }

  #beginTool(e, start, view, isPen, penEraser) {
    const { engine } = this;
    const kind = engine.tool.kind;
    if (!penEraser && (e.altKey || kind === 'eyedropper')) {
      this.gesture = { ...start, type: 'eyedrop' };
      this.#pick(view);
      return;
    }
    if (kind === 'fill' && !penEraser) {
      engine.fillAt(view);
      return;
    }
    const pressure = isPen ? e.pressure : 0.5;
    engine.strokeBegin(view, pressure, {
      pen: isPen, erase: penEraser || kind === 'eraser',
    });
    this.gesture = { ...start, type: 'paint' };
  }

  #pick(view) {
    const color = this.engine.sampleColor(view);
    if (color) this.hooks.onPick(color);
  }

  #move(e) {
    const { engine } = this;
    if (e.pointerType === 'pen') this.lastPenAt = performance.now();
    if (e.pointerType === 'touch') {
      this.#touchMove(e);
      return;
    }
    const view = engine.project ? engine.viewAt(e.clientX, e.clientY) : null;
    this.pointer = view;
    const { gesture } = this;
    if (!gesture || gesture.id !== e.pointerId) {
      if (view) this.#updateCursor(view);
      return;
    }
    // A chord can end a gesture without a pointerup, when the original button lifts first.
    if (e.buttons !== undefined && gesture.type !== 'paint' && !(e.buttons & (BUTTON_MASK[gesture.button] ?? 1))) {
      this.#finish(gesture);
      return;
    }

    const locked = document.pointerLockElement === this.canvas;
    const dx = locked ? e.movementX : e.clientX - gesture.lastX;
    const dy = locked ? e.movementY : e.clientY - gesture.lastY;
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;

    switch (gesture.type) {
      case 'paint': {
        // Coalesced events recover the samples between animation frames, which matters most for
        // fast pen strokes.
        const samples = e.getCoalescedEvents?.() ?? [];
        const { rect } = gesture.view;
        const bounds = this.canvas.getBoundingClientRect();
        for (const sample of samples.length > 0 ? samples : [e]) {
          engine.strokeAdd(
            sample.clientX - bounds.left - rect.x,
            sample.clientY - bounds.top - rect.y,
            e.pointerType === 'pen' ? sample.pressure : 0.5,
          );
        }
        if (view) this.#updateCursor(view);
        break;
      }
      case 'orbit':
        engine.rig.orbit(dx, dy);
        engine.showPivot(true);
        break;
      case 'pan':
        engine.rig.pan(dx, dy, gesture.view.rect.height);
        engine.requestRender();
        break;
      case 'dolly':
        engine.rig.dolly(-dy * 0.1);
        engine.requestRender();
        break;
      case 'panUv':
        engine.uv.pan(dx, dy);
        engine.requestRender();
        break;
      case 'fly':
        engine.rig.look(dx, dy);
        engine.requestRender();
        break;
      case 'light':
        engine.dragLight(dx, dy);
        break;
      case 'eyedrop':
        if (view) this.#pick(view);
        break;
      default:
        break;
    }
  }

  #up(e, cancelled = false) {
    if (e.pointerType === 'pen') this.lastPenAt = performance.now();
    if (e.pointerType === 'touch') {
      this.#touchUp(e, cancelled);
      return;
    }
    if (!this.gesture || this.gesture.id !== e.pointerId) return;
    this.#finish(this.gesture, cancelled);
  }

  #finish(gesture, cancelled = false) {
    const { engine } = this;
    this.gesture = null;
    switch (gesture.type) {
      case 'paint':
        if (cancelled) engine.strokeCancel();
        else engine.strokeEnd();
        break;
      case 'orbit':
        engine.showPivot(false);
        break;
      case 'fly':
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        break;
      default:
        break;
    }
    engine.requestRender();
  }

  #leave() {
    if (this.gesture) return;
    this.pointer = null;
    this.engine.hideCursor();
    this.#setCircle(null);
  }

  // Brush cursor --------------------------------------------------------------------------------

  /** Shows the brush size: on the surface in 3D, or as a flat circle where there's no surface. */
  #updateCursor(view) {
    const { engine } = this;
    const { kind } = engine.tool;
    const brushTool = kind === 'brush' || kind === 'eraser';
    if (!brushTool) {
      engine.hideCursor();
      this.#setCircle(null);
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    this.canvas.style.cursor = 'none';
    if (view.kind === '3d' && engine.placeCursor(view.x, view.y)) {
      this.#setCircle(null);
      return;
    }
    engine.hideCursor();
    this.#setCircle(view);
  }

  #setCircle(view) {
    const { brushCircle } = this.hooks;
    if (!view) {
      brushCircle.hidden = true;
      return;
    }
    const size = this.engine.brushPixels();
    brushCircle.hidden = false;
    brushCircle.style.width = `${size}px`;
    brushCircle.style.height = `${size}px`;
    brushCircle.style.transform = `translate(${view.rect.x + view.x - size / 2}px, ${view.rect.y + view.y - size / 2}px)`;
  }

  refreshCursor() {
    if (this.pointer && !this.gesture) this.#updateCursor(this.pointer);
  }

  // Wheel ---------------------------------------------------------------------------------------

  #wheel(e) {
    const { engine } = this;
    if (!engine.project) return;
    e.preventDefault();
    const view = engine.viewAt(e.clientX, e.clientY);
    if (!view) return;
    // Mice step by about 100, trackpads by small amounts. This treats them the same.
    const amount = -Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 + 0.2);
    if (this.gesture?.type === 'fly') {
      engine.rig.changeFlySpeed(amount);
      return;
    }
    if (this.gesture) return;
    if (view.kind === 'uv') {
      engine.uv.zoomAt(view.x, view.y, amount);
    } else {
      engine.zoomTarget(view.x, view.y, target);
      engine.rig.zoomToward(target, amount);
      this.#updateCursor(view);
    }
    engine.requestRender();
  }

  // Touch ---------------------------------------------------------------------------------------

  #touchDown(e) {
    const { engine } = this;
    // A hand resting on a tablet registers as touch, so ignore touch just after the pen was seen.
    if (performance.now() - this.lastPenAt < PALM_REJECT_MS) return;
    this.#capture(e);
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now() });
    if (this.touches.size === 1) {
      const view = engine.viewAt(e.clientX, e.clientY);
      if (view) {
        const start = {
          id: e.pointerId, button: BTN_LEFT, lastX: e.clientX, lastY: e.clientY, view, touch: true,
        };
        this.#beginTool(e, start, view, false, false);
      }
      return;
    }
    // A second finger means this was a camera gesture all along.
    if (this.gesture?.type === 'paint') engine.strokeCancel();
    this.gesture = null;
    this.touchGesture = null;
  }

  #touchMove(e) {
    const { engine } = this;
    const touch = this.touches.get(e.pointerId);
    if (!touch) return;
    if (this.touches.size === 1) {
      touch.x = e.clientX;
      touch.y = e.clientY;
      if (this.gesture) this.#move({ ...this.#plain(e), pointerType: 'mouse-from-touch' });
      return;
    }
    touch.x = e.clientX;
    touch.y = e.clientY;
    const points = [...this.touches.values()];
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const spread = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const view = engine.viewAt(cx, cy);
    const last = this.touchGesture;
    this.touchGesture = { cx, cy, spread };
    if (!last || !view) return;
    const dx = cx - last.cx;
    const dy = cy - last.cy;
    if (view.kind === 'uv') {
      engine.uv.pan(dx, dy);
      if (last.spread > 0) engine.uv.zoomAt(view.x, view.y, Math.log(spread / last.spread) / Math.log(1.15));
    } else if (points.length >= 3) {
      engine.rig.pan(dx, dy, view.rect.height);
    } else {
      engine.rig.orbit(dx, dy);
      if (last.spread > 0 && spread > 0) {
        engine.zoomTarget(view.x, view.y, target);
        engine.rig.zoomToward(target, Math.log(spread / last.spread) / Math.log(1 / 0.85));
      }
    }
    engine.requestRender();
  }

  #plain(e) {
    return {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      movementX: e.movementX,
      movementY: e.movementY,
      buttons: 1,
      pressure: e.pressure,
      getCoalescedEvents: () => (e.getCoalescedEvents?.() ?? []),
    };
  }

  #touchUp(e, cancelled) {
    if (!this.touches.delete(e.pointerId)) return;
    this.touchGesture = null;
    if (this.gesture?.id === e.pointerId) this.#finish(this.gesture, cancelled);
  }

  // Keyboard ------------------------------------------------------------------------------------

  #keyDown(e) {
    const { engine } = this;
    if (typingInto(document.activeElement) || document.querySelector('dialog[open]')) return;
    if (!engine.project) return;
    this.keys.add(e.code);
    // Windows opens the menu bar on Alt. Space would scroll the page or press a focused button, so
    // only claim it when focus isn't on a control someone might be working with the keyboard.
    if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
    if (e.code === 'Space' && (document.activeElement === this.canvas || document.activeElement === document.body)) e.preventDefault();

    if (e.code === bindingFor('lightDrag') && !e.repeat) engine.showLightMarker(true);
    if (this.gesture?.type === 'fly') {
      e.preventDefault();
      return;
    }
    const action = actionFor(e);
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !['undo', 'redo', 'redoAlt', 'sizeDown', 'sizeUp', 'opacityDown', 'opacityUp'].includes(action)) return;
    this.#run(action);
  }

  #keyUp(e) {
    this.keys.delete(e.code);
    if (this.engine.project && e.code === bindingFor('lightDrag')) this.engine.showLightMarker(false);
  }

  #releaseAll() {
    this.keys.clear();
    if (this.gesture && this.gesture.type !== 'paint') this.#finish(this.gesture);
    if (this.engine.project) this.engine.showLightMarker(false);
  }

  #run(action) {
    const { engine } = this;
    const brush = engine.brushSettings;
    switch (action) {
      case 'passLit': engine.setPass('lit'); break;
      case 'passShadow': engine.setPass('shadow'); break;
      case 'passEdge': engine.setPass('edge'); break;
      case 'previewCycle': engine.cyclePreview(); break;
      case 'viewToggle': engine.setViewMode(engine.viewMode === '3d' ? 'uv' : '3d'); break;
      case 'viewSplit': engine.setViewMode(engine.viewMode === 'split' ? '3d' : 'split'); break;
      case 'frame': engine.frame(this.pointer?.kind ?? null); break;
      case 'wire':
        engine.uv.showWire = !engine.uv.showWire;
        engine.requestRender();
        break;
      case 'undo': engine.undo(); break;
      case 'redo':
      case 'redoAlt': engine.redo(); break;
      case 'sizeDown':
        brush.size = Math.max(1, brush.size - Math.max(1, Math.round(brush.size * 0.1)));
        this.#toolChanged();
        break;
      case 'sizeUp':
        brush.size = Math.min(600, brush.size + Math.max(1, Math.round(brush.size * 0.1)));
        this.#toolChanged();
        break;
      case 'opacityDown':
        brush.opacity = Math.max(0.05, Math.round((brush.opacity - 0.05) * 100) / 100);
        this.#toolChanged();
        break;
      case 'opacityUp':
        brush.opacity = Math.min(1, Math.round((brush.opacity + 0.05) * 100) / 100);
        this.#toolChanged();
        break;
      default:
        this.hooks.onAction(action);
    }
  }

  #toolChanged() {
    this.hooks.onToolChange();
    this.refreshCursor();
  }

  // Free-fly ------------------------------------------------------------------------------------

  #frame(dt) {
    if (this.gesture?.type !== 'fly') return;
    const held = (id) => (this.keys.has(bindingFor(id)) ? 1 : 0);
    const input = {
      x: held('flyRight') - held('flyLeft'),
      y: held('flyUp') - held('flyDown'),
      z: held('flyForward') - held('flyBack'),
    };
    if (input.x === 0 && input.y === 0 && input.z === 0) return;
    this.engine.rig.fly(dt, input, this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    this.engine.requestRender();
  }
}

