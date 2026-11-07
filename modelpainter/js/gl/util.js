// Small helpers over the renderer: render targets, fullscreen passes and direct texture writes.

import * as THREE from 'three';
import { fullscreenVertex } from '../shaders/paint.glsl.js';

/**
 * An RGBA8 target holding raw bytes. No color space is declared, because the textures hold sRGB
 * values and every conversion is done by hand in the toon shader.
 * @param {number} width
 * @param {number} height
 * @param {{ nearest?: boolean, mips?: boolean, anisotropy?: number }} [options]
 */
export function makeTarget(width, height, { nearest = false, mips = false, anisotropy = 1 } = {}) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: mips,
    minFilter: nearest ? THREE.NearestFilter : (mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter),
    magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
    wrapS: mips ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    wrapT: mips ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    anisotropy,
  });
  return target;
}

/** @returns {THREE.ShaderMaterial} a material for one fullscreen pass, with blending and depth off */
export function passMaterial(fragmentShader, uniforms = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    side: THREE.DoubleSide,
  });
}

/** Runs fullscreen shaders into render targets. */
export class FullscreenPass {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    const geometry = new THREE.BufferGeometry();
    // One oversized triangle covers the screen without a seam down the middle.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.Camera();
  }

  /**
   * @param {THREE.Material} material
   * @param {THREE.WebGLRenderTarget|null} target
   */
  run(material, target) {
    this.mesh.material = material;
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

/**
 * Writes pixels straight into a target's texture. Three has no call for a sub-rectangle of a
 * render target, and this is the path every stroke uses, so it needs to be quick.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.WebGLRenderTarget} target
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Uint8ClampedArray|ImageData|ImageBitmap} source
 * @param {{ premultiply?: boolean }} [options] premultiply converts straight alpha on the way in
 */
export function writeTexels(renderer, target, x, y, width, height, source, { premultiply = false } = {}) {
  const gl = renderer.getContext();
  renderer.initRenderTarget(target);
  const texture = renderer.properties.get(target.texture).__webglTexture;
  const { state } = renderer;
  state.bindTexture(gl.TEXTURE_2D, texture);
  state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (ArrayBuffer.isView(source)) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  if (target.texture.generateMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  state.unbindTexture();
}

/** Clears a render target to one color. */
export function clearTarget(renderer, target, r = 0, g = 0, b = 0, a = 0) {
  const previous = renderer.getRenderTarget();
  const color = new THREE.Color();
  renderer.getClearColor(color);
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace), a);
  renderer.clear(true, false, false);
  renderer.setClearColor(color, alpha);
  renderer.setRenderTarget(previous);
}
