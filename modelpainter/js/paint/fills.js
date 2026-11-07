// The fill bucket's three modes. Flood fill itself is Splotchle's. Everything here runs in JS on a
// one-off read of the pass, then commits as a normal undoable edit.

import * as THREE from 'three';
import { floodFill } from '../../../splotchle/js/fill.js';
import { makeTarget } from '../gl/util.js';

const hexToBytes = (hex) => {
  const value = parseInt(hex.slice(1), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/**
 * Lays one color over one texel, straight alpha. Edge texels stay opaque and gray.
 * @param {Uint8Array|Uint8ClampedArray} pixels
 * @param {number} i byte offset
 * @param {number[]} rgb
 * @param {number} opacity 0..1
 * @param {boolean} gray Edge pass
 */
export function blendTexel(pixels, i, [r, g, b], opacity, gray) {
  if (gray) {
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const next = Math.round(pixels[i] * (1 - opacity) + value * opacity);
    pixels[i] = next;
    pixels[i + 1] = next;
    pixels[i + 2] = next;
    pixels[i + 3] = 255;
    return;
  }
  const under = pixels[i + 3] / 255;
  const a = opacity + under * (1 - opacity);
  if (a <= 0) return;
  const mix = (top, bottom) => Math.round((top * opacity + bottom * under * (1 - opacity)) / a);
  pixels[i] = mix(r, pixels[i]);
  pixels[i + 1] = mix(g, pixels[i + 1]);
  pixels[i + 2] = mix(b, pixels[i + 2]);
  pixels[i + 3] = Math.round(a * 255);
}

/**
 * Connected-color flood fill clipped to one island. Texels outside the island get an alpha that can't
 * match the start texel, so Splotchle's flood fill stops there without needing to know about islands.
 * @param {Uint8Array} pixels RGBA, left unchanged
 * @param {number} res
 * @param {Uint32Array|null} islandMap per-texel island number, or null for no clipping
 * @param {number} x
 * @param {number} y
 * @param {number} tolerance 0..127
 * @returns {{ runs: number[], fringe: number[] }}
 */
export function clippedFlood(pixels, res, islandMap, x, y, tolerance) {
  let source = pixels;
  if (islandMap) {
    source = new Uint8Array(pixels);
    const island = islandMap[y * res + x];
    const start = source[(y * res + x) * 4 + 3];
    const blocked = start > 127 ? 0 : 255;
    for (let i = 0; i < islandMap.length; i++) {
      if (islandMap[i] !== island) source[i * 4 + 3] = blocked;
    }
  }
  return floodFill(source, res, res, x, y, { tolerance: Math.min(127, tolerance), fringe: 1 });
}

/** Applies flood-fill results: runs get the color, and the fringe goes under what's already there. */
export function applyFlood(pixels, res, { runs, fringe }, rgb, opacity, gray, islandMap = null, island = 0) {
  for (let r = 0; r < runs.length; r += 3) {
    for (let i = 0; i < runs[r + 2]; i++) {
      blendTexel(pixels, ((runs[r + 1] * res + runs[r] + i) * 4), rgb, opacity, gray);
    }
  }
  if (gray) return; // Edge has no alpha for the fringe to go under
  for (let r = 0; r < fringe.length; r += 3) {
    for (let i = 0; i < fringe[r + 2]; i++) {
      const texel = fringe[r + 1] * res + fringe[r] + i;
      if (islandMap && islandMap[texel] !== island) continue;
      const o = texel * 4;
      const over = pixels[o + 3] / 255;
      if (over >= 1) continue;
      const a = over + opacity * (1 - over);
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) {
        pixels[o + c] = Math.round((pixels[o + c] * over + rgb[c] * opacity * (1 - over)) / a);
      }
      pixels[o + 3] = Math.round(a * 255);
    }
  }
}

/** Renders the layout's island numbers into a texture and reads them back. Cached per layout. */
export class IslandMap {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.map = null;
  }

  invalidate() {
    this.map = null;
  }

  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {Int32Array} triangleIsland
   * @param {number} res
   * @returns {Uint32Array} per-texel island number plus one, with 0 meaning empty space
   */
  get(geometry, triangleIsland, res) {
    if (this.map && this.map.length === res * res) return this.map;
    const { renderer } = this;
    const index = geometry.index.array;
    const uv = geometry.attributes.uv.array;
    const triangles = index.length / 3;
    const position = new Float32Array(triangles * 9);
    const color = new Float32Array(triangles * 9);
    for (let t = 0; t < triangles; t++) {
      const id = triangleIsland[t] + 1;
      for (let k = 0; k < 3; k++) {
        const v = index[t * 3 + k];
        const at = t * 9 + k * 3;
        position[at] = uv[v * 2] * 2 - 1;
        position[at + 1] = uv[v * 2 + 1] * 2 - 1;
        color[at] = (id & 255) / 255;
        color[at + 1] = ((id >> 8) & 255) / 255;
        color[at + 2] = ((id >> 16) & 255) / 255;
      }
    }
    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', new THREE.BufferAttribute(position, 3));
    flat.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: 'attribute vec3 aColor; varying vec3 vColor; void main() { vColor = aColor; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(flat, material);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const target = makeTarget(res, res, { nearest: true });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(scene, new THREE.Camera());
    renderer.setRenderTarget(previous);
    const bytes = new Uint8Array(res * res * 4);
    renderer.readRenderTargetPixels(target, 0, 0, res, res, bytes);
    target.dispose();
    flat.dispose();
    material.dispose();
    const map = new Uint32Array(res * res);
    for (let i = 0; i < map.length; i++) {
      map[i] = bytes[i * 4 + 3] === 0 ? 0 : bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16);
    }
    this.map = map;
    return map;
  }
}

export { hexToBytes };
