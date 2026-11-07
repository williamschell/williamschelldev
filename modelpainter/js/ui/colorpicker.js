// The color picker: a hue wheel around a saturation/value square.

import { hexToHsv, hsvToHex } from './color.js';

const SIZE = 216;
const CENTER = SIZE / 2;
const OUTER = SIZE / 2 - 2;
const INNER = OUTER - 18;
// The square's corners sit just inside the ring.
const HALF = Math.floor((INNER - 4) / Math.SQRT2);

export class ColorPicker {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(hex: string) => void} onChange
   */
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.h = 0;
    this.s = 1;
    this.v = 1;
    this.dragging = null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * ratio;
    canvas.height = SIZE * ratio;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    canvas.style.touchAction = 'none';
    this.ctx = canvas.getContext('2d');
    this.ctx.scale(ratio, ratio);
    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    canvas.addEventListener('pointerup', () => { this.dragging = null; });
    canvas.addEventListener('pointercancel', () => { this.dragging = null; });
    canvas.addEventListener('keydown', (e) => this.#key(e));
    this.draw();
  }

  /** Sets the color from outside without firing onChange. */
  set(hex) {
    if (hex === hsvToHex(this.h, this.s, this.v)) return;
    const { h, s, v } = hexToHsv(hex);
    // Grays have no hue of their own, so keep the wheel where it was.
    if (s > 0 && v > 0) this.h = h;
    this.s = s;
    this.v = v;
    this.draw();
  }

  #locate(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left - CENTER, e.clientY - rect.top - CENTER];
  }

  #down(e) {
    const [x, y] = this.#locate(e);
    const distance = Math.hypot(x, y);
    if (distance >= INNER - 2 && distance <= OUTER + 2) this.dragging = 'hue';
    else if (Math.abs(x) <= HALF + 4 && Math.abs(y) <= HALF + 4) this.dragging = 'square';
    else return;
    this.canvas.setPointerCapture(e.pointerId);
    this.#apply(x, y);
  }

  #move(e) {
    if (this.dragging) this.#apply(...this.#locate(e));
  }

  #apply(x, y) {
    if (this.dragging === 'hue') {
      this.h = ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360;
    } else {
      this.s = Math.min(1, Math.max(0, (x + HALF) / (2 * HALF)));
      this.v = Math.min(1, Math.max(0, 1 - (y + HALF) / (2 * HALF)));
    }
    this.draw();
    this.onChange(hsvToHex(this.h, this.s, this.v));
  }

  /** Arrow keys move through saturation and value; Shift + arrows turn the hue. */
  #key(e) {
    const step = 0.02;
    let handled = true;
    if (e.shiftKey && e.key === 'ArrowLeft') this.h = (this.h + 355) % 360;
    else if (e.shiftKey && e.key === 'ArrowRight') this.h = (this.h + 5) % 360;
    else if (e.key === 'ArrowLeft') this.s = Math.max(0, this.s - step);
    else if (e.key === 'ArrowRight') this.s = Math.min(1, this.s + step);
    else if (e.key === 'ArrowUp') this.v = Math.min(1, this.v + step);
    else if (e.key === 'ArrowDown') this.v = Math.max(0, this.v - step);
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    this.draw();
    this.onChange(hsvToHex(this.h, this.s, this.v));
  }

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Hue ring. A conic gradient starts at 3 o'clock, and the picker's 0 degrees is at 12.
    const wheel = ctx.createConicGradient(-Math.PI / 2, CENTER, CENTER);
    for (let i = 0; i <= 12; i++) wheel.addColorStop(i / 12, `hsl(${i * 30} 100% 50%)`);
    ctx.fillStyle = wheel;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, OUTER, 0, Math.PI * 2);
    ctx.arc(CENTER, CENTER, INNER, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    // Square: white to the hue left to right, then black over it bottom up.
    const left = CENTER - HALF;
    const top = CENTER - HALF;
    const side = HALF * 2;
    ctx.fillStyle = `hsl(${this.h} 100% 50%)`;
    ctx.fillRect(left, top, side, side);
    const white = ctx.createLinearGradient(left, 0, left + side, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = white;
    ctx.fillRect(left, top, side, side);
    const black = ctx.createLinearGradient(0, top + side, 0, top);
    black.addColorStop(0, '#000');
    black.addColorStop(1, 'rgb(0 0 0 / 0)');
    ctx.fillStyle = black;
    ctx.fillRect(left, top, side, side);

    // Markers
    const angle = ((this.h - 90) * Math.PI) / 180;
    const mid = (OUTER + INNER) / 2;
    this.#marker(CENTER + Math.cos(angle) * mid, CENTER + Math.sin(angle) * mid);
    this.#marker(left + this.s * side, top + (1 - this.v) * side);
  }

  #marker(x, y) {
    const { ctx } = this;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}
