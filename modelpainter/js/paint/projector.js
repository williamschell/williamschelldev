// Moves stroke pixels from the stroke canvas onto the texture. In 3D this is the projection pass from
// section 6 of CLAUDE.md. In the UV view the canvas already is texture space, so it's a straight copy.

import * as THREE from 'three';
import { makeTarget, passMaterial, writeTexels, FullscreenPass } from '../gl/util.js';
import { copyFragment, projectFragment, uvSpaceVertex } from '../shaders/paint.glsl.js';

const viewProjection = new THREE.Matrix4();

export class Projector {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new FullscreenPass(renderer);

    this.projectMaterial = new THREE.ShaderMaterial({
      vertexShader: uvSpaceVertex,
      fragmentShader: projectFragment,
      uniforms: {
        uStroke: { value: null },
        uDepth: { value: null },
        uViewProjection: { value: new THREE.Matrix4() },
        uCameraPos: { value: new THREE.Vector3() },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uDoubleSided: { value: 0 },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      // Max keeps the answer the same whatever order triangles draw in, which matters when UV
      // islands overlap: a hidden triangle can't erase what a visible one wrote.
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.copyMaterial = passMaterial(copyFragment, { uSource: { value: null } });

    this.uvScene = new THREE.Scene();
    this.uvCamera = new THREE.Camera();
    this.uvMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.projectMaterial);
    this.uvMesh.frustumCulled = false;
    this.uvScene.add(this.uvMesh);

    this.depthScene = new THREE.Scene();
    this.depthMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
    this.depthMesh.frustumCulled = false;
    this.depthScene.add(this.depthMesh);

    /** @type {THREE.WebGLRenderTarget|null} */
    this.depthTarget = null;
    /** @type {THREE.WebGLRenderTarget|null} canvas pixels on the GPU, in the canvas's own size */
    this.canvasTexture = null;
  }

  /** @param {THREE.BufferGeometry} geometry */
  setGeometry(geometry) {
    this.uvMesh.geometry = geometry;
    this.depthMesh.geometry = geometry;
  }

  #ensureCanvasTexture(width, height) {
    if (this.canvasTexture && this.canvasTexture.width === width && this.canvasTexture.height === height) return;
    this.canvasTexture?.dispose();
    this.canvasTexture = makeTarget(width, height);
  }

  /**
   * Starts a new stroke's canvas texture. The canvas is empty at the start of a stroke, so clearing
   * here is enough, and from then on only the changed rectangles get uploaded.
   */
  beginCanvas(width, height) {
    this.#ensureCanvasTexture(width, height);
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.canvasTexture);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(previous);
  }

  /** @param {{ x: number, y: number, image: ImageData }} part */
  uploadCanvas(part) {
    const { image, x, y } = part;
    // Premultiplied so bilinear reads don't pull dark fringes in from transparent neighbors.
    writeTexels(this.renderer, this.canvasTexture, x, y, image.width, image.height, image, { premultiply: true });
  }

  /**
   * Renders the mesh's depth from the camera. The camera holds still during a stroke, so this runs
   * once when a stroke starts.
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} width drawing buffer pixels
   * @param {number} height drawing buffer pixels
   */
  renderDepth(camera, width, height) {
    if (!this.depthTarget || this.depthTarget.width !== width || this.depthTarget.height !== height) {
      this.depthTarget?.dispose();
      this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
    }
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.depthTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.depthScene, camera);
    renderer.setRenderTarget(previous);

    const u = this.projectMaterial.uniforms;
    u.uDepth.value = this.depthTarget.depthTexture;
    u.uViewProjection.value.copy(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    u.uCameraPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
  }

  /**
   * Bakes what's on the canvas into the UV-space stroke target. The canvas holds the whole stroke
   * so far, so the target gets rebuilt from it instead of adding to it.
   * @param {THREE.WebGLRenderTarget} strokeTarget
   * @param {boolean} doubleSided
   */
  projectToUv(strokeTarget, doubleSided) {
    const { renderer } = this;
    const u = this.projectMaterial.uniforms;
    u.uStroke.value = this.canvasTexture.texture;
    u.uDoubleSided.value = doubleSided ? 1 : 0;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(strokeTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.uvScene, this.uvCamera);
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(previous);
  }

  /** The UV view's canvas already matches the texture, so this copies it across. */
  copyToUv(strokeTarget) {
    this.copyMaterial.uniforms.uSource.value = this.canvasTexture.texture;
    this.quad.run(this.copyMaterial, strokeTarget);
  }
}
