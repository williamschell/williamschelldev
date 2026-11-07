// The three painted passes and everything that changes them. Every edit ends the same way: the new
// pass is rendered into a spare target, the two are compared to find which 64x64 tiles differ, the
// old contents of those tiles go on the undo stack, and the targets swap.

import * as THREE from 'three';
import { FullscreenPass, clearTarget, makeTarget, passMaterial, writeTexels } from '../gl/util.js';
import {
  compositeFragment, copyFragment, dilateInitFragment, dilateStepFragment, diffFragment, maskFragment,
  reduceFragment, shadowFromLitFragment, uvSpaceVertex,
} from '../shaders/paint.glsl.js';
import { TILE, sliceTile, tileBounds } from './history.js';

export const PASSES = ['lit', 'shadow', 'edge'];

/** Padding around islands in texels. 8 at 2048, in proportion elsewhere, and never below 4. */
export function dilationRadius(res, setting = 8) {
  return Math.min(120, Math.max(4, Math.round((setting * res) / 2048)));
}

export class PassStore {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} res
   * @param {import('./history.js').History} history
   */
  constructor(renderer, res, history) {
    this.renderer = renderer;
    this.res = res;
    this.history = history;
    this.quad = new FullscreenPass(renderer);
    this.onChange = () => {};
    this.dilationSetting = 8;
    this.#allocate(res);

    this.compositeMaterial = passMaterial(compositeFragment, {
      uPass: { value: null },
      uStroke: { value: null },
      uDilate: { value: null },
      uOpacity: { value: 1 },
      uErase: { value: 0 },
      uIsEdge: { value: 0 },
    });
    this.copyMaterial = passMaterial(copyFragment, { uSource: { value: null } });
    this.initMaterial = passMaterial(dilateInitFragment, { uMask: { value: null } });
    this.stepMaterial = passMaterial(dilateStepFragment, { uPrev: { value: null }, uSize: { value: res } });
    this.diffMaterial = passMaterial(diffFragment, { uA: { value: null }, uB: { value: null } });
    this.reduceMaterial = passMaterial(reduceFragment, { uSource: { value: null } });
    this.shadowMaterial = passMaterial(shadowFromLitFragment, {
      uSource: { value: null },
      uHueShift: { value: 0 },
      uTargetHue: { value: 0 },
      uSaturation: { value: 1 },
      uValue: { value: 1 },
    });
    this.maskMaterial = new THREE.ShaderMaterial({
      vertexShader: uvSpaceVertex,
      fragmentShader: maskFragment,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.uvScene = new THREE.Scene();
    this.uvCamera = new THREE.Camera();
    this.uvMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.maskMaterial);
    this.uvMesh.frustumCulled = false;
    this.uvScene.add(this.uvMesh);
  }

  #allocate(res) {
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const pass = () => makeTarget(res, res, { mips: true, anisotropy });
    /** @type {Record<string, THREE.WebGLRenderTarget>} */
    this.targets = { lit: pass(), shadow: pass(), edge: pass() };
    this.scratch = pass(); // receives each edit, and doubles as the live preview during a stroke
    this.work = makeTarget(res, res, { nearest: true }); // source for edits made in JS
    this.strokeTarget = makeTarget(res, res, { nearest: true });
    this.islandMask = makeTarget(res, res, { nearest: true });
    this.dilateA = makeTarget(res, res, { nearest: true });
    this.dilateB = makeTarget(res, res, { nearest: true });
    this.dilate = this.dilateA;
    this.reduceChain = [];
    for (let size = res / 2; size >= res / TILE; size /= 2) {
      this.reduceChain.push(makeTarget(size, size, { nearest: true }));
    }
    for (const target of [this.strokeTarget, this.dilateA, this.dilateB]) clearTarget(this.renderer, target);
    clearTarget(this.renderer, this.targets.lit, 0.85, 0.83, 0.79, 1);
    clearTarget(this.renderer, this.targets.shadow, 0.45, 0.44, 0.55, 1);
    clearTarget(this.renderer, this.targets.edge, 0.5, 0.5, 0.5, 1);
  }

  #free() {
    const all = [
      ...Object.values(this.targets), this.scratch, this.work, this.strokeTarget, this.islandMask,
      this.dilateA, this.dilateB, ...this.reduceChain,
    ];
    for (const target of all) target.dispose();
  }

  dispose() {
    this.#free();
    for (const material of [
      this.compositeMaterial, this.copyMaterial, this.initMaterial, this.stepMaterial,
      this.diffMaterial, this.reduceMaterial, this.shadowMaterial, this.maskMaterial,
    ]) material.dispose();
    this.quad.dispose();
  }

  /** The texture to show for a pass. While previewing, that's the spare target. */
  textureFor(pass, previewPass = null) {
    return (pass === previewPass ? this.scratch : this.targets[pass]).texture;
  }

  /**
   * Builds the island mask and the dilation map. Needed once per UV layout.
   * @param {THREE.BufferGeometry} geometry
   */
  buildLayout(geometry) {
    const { renderer } = this;
    this.uvMesh.geometry = geometry;
    this.uvMesh.material = this.maskMaterial;
    const previous = renderer.getRenderTarget();
    clearTarget(renderer, this.islandMask);
    renderer.setRenderTarget(this.islandMask);
    const clearBefore = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.uvScene, this.uvCamera);
    renderer.autoClear = clearBefore;
    renderer.setRenderTarget(previous);

    this.initMaterial.uniforms.uMask.value = this.islandMask.texture;
    this.quad.run(this.initMaterial, this.dilateA);
    let source = this.dilateA;
    let dest = this.dilateB;
    const radius = dilationRadius(this.res, this.dilationSetting);
    this.stepMaterial.uniforms.uSize.value = this.res;
    for (let i = 0; i < radius; i++) {
      this.stepMaterial.uniforms.uPrev.value = source.texture;
      this.quad.run(this.stepMaterial, dest);
      [source, dest] = [dest, source];
    }
    this.dilate = source;
  }

  /**
   * Renders one pass with the stroke over it into the spare target.
   * @param {string} pass
   * @param {{ source?: THREE.Texture, opacity?: number, erase?: boolean, stroke?: THREE.Texture }} [options]
   */
  composite(pass, {
    source = this.targets[pass].texture, opacity = 1, erase = false, stroke = this.strokeTarget.texture,
  } = {}) {
    const u = this.compositeMaterial.uniforms;
    u.uPass.value = source;
    u.uStroke.value = stroke;
    u.uDilate.value = this.dilate.texture;
    u.uOpacity.value = opacity;
    u.uErase.value = erase ? 1 : 0;
    u.uIsEdge.value = pass === 'edge' ? 1 : 0;
    this.quad.run(this.compositeMaterial, this.scratch);
  }

  /**
   * Finds the tiles that differ between two targets. The GPU halves a changed-texel map down to one
   * texel per tile, so only that tiny map has to be read back.
   * @returns {{ x: number, y: number }[]}
   */
  changedTiles(a, b) {
    const { renderer } = this;
    this.diffMaterial.uniforms.uA.value = a.texture;
    this.diffMaterial.uniforms.uB.value = b.texture;
    this.quad.run(this.diffMaterial, this.reduceChain[0]);
    for (let i = 1; i < this.reduceChain.length; i++) {
      this.reduceMaterial.uniforms.uSource.value = this.reduceChain[i - 1].texture;
      this.quad.run(this.reduceMaterial, this.reduceChain[i]);
    }
    const last = this.reduceChain[this.reduceChain.length - 1];
    const size = last.width;
    const flags = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(last, 0, 0, size, size, flags);
    const tiles = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (flags[(y * size + x) * 4] > 0) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  /** Reads tiles out of a target. */
  #readTiles(target, tiles) {
    const bounds = tileBounds(tiles, TILE, this.res);
    const buffer = new Uint8Array(bounds.width * bounds.height * 4);
    this.renderer.readRenderTargetPixels(target, bounds.x, bounds.y, bounds.width, bounds.height, buffer);
    return tiles.map(({ x, y }) => ({ x, y, data: sliceTile(buffer, bounds, x, y, TILE) }));
  }

  /** Writes tiles and rebuilds the mipmaps once. */
  #writeTiles(target, tiles) {
    const { renderer } = this;
    const gl = renderer.getContext();
    renderer.initRenderTarget(target);
    const texture = renderer.properties.get(target.texture).__webglTexture;
    const { state } = renderer;
    state.bindTexture(gl.TEXTURE_2D, texture);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const { x, y, data } of tiles) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x * TILE, y * TILE, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    state.unbindTexture();
  }

  /**
   * Makes the spare target the pass, recording the difference for undo.
   * @param {string} pass
   * @param {string} label for the undo entry
   * @returns {boolean} whether anything changed
   */
  commit(pass, label = 'Paint') {
    const old = this.targets[pass];
    const tiles = this.changedTiles(old, this.scratch);
    if (tiles.length === 0) return false;
    let saved = this.#readTiles(old, tiles);
    this.targets[pass] = this.scratch;
    this.scratch = old;
    const coords = tiles;
    this.history.push({
      label,
      bytes: saved.length * TILE * TILE * 4,
      swap: () => {
        const target = this.targets[pass];
        const current = this.#readTiles(target, coords);
        this.#writeTiles(target, saved);
        saved = current;
        this.onChange(pass);
      },
    });
    this.onChange(pass);
    return true;
  }

  /** Empties the stroke target. */
  clearStroke() {
    clearTarget(this.renderer, this.strokeTarget);
  }

  /**
   * Replaces a pass with an array of bytes as one undoable step.
   * @param {string} pass
   * @param {Uint8Array} pixels
   * @param {string} label
   */
  commitPixels(pass, pixels, label) {
    writeTexels(this.renderer, this.work, 0, 0, this.res, this.res, pixels);
    this.clearStroke();
    this.composite(pass, { source: this.work.texture, opacity: 0 });
    return this.commit(pass, label);
  }

  /** Copies one pass into another as one undoable step. */
  copyPass(from, to, label) {
    this.clearStroke();
    this.composite(to, { source: this.targets[from].texture, opacity: 0 });
    return this.commit(to, label);
  }

  /** Sets a whole pass to one color as one undoable step. r, g, b and a are 0..1. */
  fillPass(pass, r, g, b, a, label) {
    clearTarget(this.renderer, this.work, r, g, b, a);
    this.clearStroke();
    this.composite(pass, { source: this.work.texture, opacity: 0 });
    return this.commit(pass, label);
  }

  /**
   * The Generate Shadow helper, as one undoable step.
   * @param {{ hueShift: number, targetHue: number, saturation: number, value: number }} options
   *   hueShift and targetHue are in degrees; saturation and value are multipliers
   * @param {boolean} [record] false writes without an undo step, for setting up a new project
   */
  generateShadow({
    hueShift, targetHue, saturation, value,
  }, record = true) {
    const u = this.shadowMaterial.uniforms;
    u.uSource.value = this.targets.lit.texture;
    u.uHueShift.value = hueShift / 360;
    u.uTargetHue.value = targetHue / 360;
    u.uSaturation.value = saturation;
    u.uValue.value = value;
    this.quad.run(this.shadowMaterial, this.work);
    this.clearStroke();
    this.composite('shadow', { source: this.work.texture, opacity: 0 });
    if (record) return this.commit('shadow', 'Generate shadow');
    [this.targets.shadow, this.scratch] = [this.scratch, this.targets.shadow];
    return true;
  }

  /**
   * Replaces a target outright, with no undo step. Used for setup: loading and baking.
   * @param {string} pass
   * @param {THREE.Texture} source
   */
  loadFrom(pass, source) {
    this.clearStroke();
    this.composite(pass, { source, opacity: 0 });
    [this.targets[pass], this.scratch] = [this.scratch, this.targets[pass]];
  }

  /** Writes bytes or a bitmap into a pass with no undo step, filling in island padding. */
  loadPixels(pass, source) {
    writeTexels(this.renderer, this.work, 0, 0, this.res, this.res, source);
    this.loadFrom(pass, this.work.texture);
  }

  /** @returns {Uint8Array} the pass's bytes, top row first. Blocks on the GPU. */
  readPass(pass) {
    const out = new Uint8Array(this.res * this.res * 4);
    this.renderer.readRenderTargetPixels(this.targets[pass], 0, 0, this.res, this.res, out);
    return out;
  }

  /** @returns {Promise<Uint8Array>} the pass's bytes, without stalling the GPU. For autosaves. */
  async readPassAsync(pass) {
    const out = new Uint8Array(this.res * this.res * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.targets[pass], 0, 0, this.res, this.res, out);
    return out;
  }

  /** @returns {Uint8Array} one texel's RGBA. */
  readTexel(pass, x, y) {
    const out = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(this.targets[pass], x, y, 1, 1, out);
    return out;
  }

  /**
   * Whole-pass snapshot, for steps that replace everything at once (unwrap).
   * @returns {Record<string, Uint8Array>}
   */
  snapshotAll() {
    return Object.fromEntries(PASSES.map((pass) => [pass, this.readPass(pass)]));
  }

  /** Puts a snapshot back with no undo step of its own. */
  restoreAll(snapshot) {
    for (const pass of PASSES) {
      writeTexels(this.renderer, this.targets[pass], 0, 0, this.res, this.res, snapshot[pass]);
      this.onChange(pass);
    }
  }

  /**
   * Resamples every pass to a new resolution. History is cleared, because old tiles no longer fit.
   * @param {number} res
   * @param {THREE.BufferGeometry} geometry
   */
  resize(res, geometry) {
    if (res === this.res) return;
    const old = this.targets;
    const leftovers = [
      this.scratch, this.work, this.strokeTarget, this.islandMask, this.dilateA, this.dilateB, ...this.reduceChain,
    ];
    this.res = res;
    this.#allocate(res);
    this.buildLayout(geometry);
    // A plain fetch would only pick up every Nth texel, so this draws through a filtered read.
    const blit = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ 'uniform sampler2D uSource; varying vec2 vUv; void main() { gl_FragColor = texture2D(uSource, vUv); }',
      uniforms: { uSource: { value: null } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    for (const pass of PASSES) {
      blit.uniforms.uSource.value = old[pass].texture;
      this.quad.run(blit, this.work);
      this.loadFrom(pass, this.work.texture);
    }
    blit.dispose();
    for (const target of [...Object.values(old), ...leftovers]) target.dispose();
    this.history.clear();
    for (const pass of PASSES) this.onChange(pass);
  }
}
