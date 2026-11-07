// The 2D UV view: the active pass as a flat texture, with the UV wireframe over it.

import * as THREE from 'three';
import { uvViewFragment, uvViewVertex, uvWireFragment } from '../shaders/paint.glsl.js';
import { uvEdges } from '../mesh/uvs.js';

export class UvView {
  constructor() {
    /** CSS pixels from the view's top-left to UV (0, 0). */
    this.panX = 0;
    this.panY = 0;
    /** CSS pixels across the whole texture. */
    this.zoom = 512;
    this.width = 1;
    this.height = 1;
    this.showWire = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.shared = {
      uPan: { value: new THREE.Vector2() },
      uZoom: { value: 512 },
      uViewSize: { value: new THREE.Vector2(1, 1) },
    };
    const quadGeometry = new THREE.BufferGeometry();
    quadGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    quadGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    quadGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new THREE.ShaderMaterial({
      vertexShader: uvViewVertex,
      fragmentShader: uvViewFragment,
      uniforms: { ...this.shared, uMap: { value: null }, uGray: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.quad = new THREE.Mesh(quadGeometry, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.wireMaterial = new THREE.ShaderMaterial({
      vertexShader: uvViewVertex,
      fragmentShader: uvWireFragment,
      uniforms: { ...this.shared, uColor: { value: new THREE.Vector4(1, 1, 1, 0.55) } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.wire = new THREE.LineSegments(new THREE.BufferGeometry(), this.wireMaterial);
    this.wire.frustumCulled = false;
    this.wire.renderOrder = 1;
    this.scene.add(this.wire);
  }

  /** Rebuilds the wireframe from a UV layout. */
  setGeometry(geometry) {
    const edges = uvEdges(geometry.index.array, geometry.attributes.uv.array);
    const wire = new THREE.BufferGeometry();
    wire.setAttribute('position', new THREE.BufferAttribute(new Float32Array((edges.length / 2) * 3), 3));
    wire.setAttribute('uv', new THREE.BufferAttribute(edges, 2));
    this.wire.geometry.dispose();
    this.wire.geometry = wire;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.#sync();
  }

  #sync() {
    this.shared.uPan.value.set(this.panX, this.panY);
    this.shared.uZoom.value = this.zoom;
    this.shared.uViewSize.value.set(this.width, this.height);
  }

  fit() {
    this.zoom = Math.max(32, Math.min(this.width, this.height) * 0.92);
    this.panX = (this.width - this.zoom) / 2;
    this.panY = (this.height - this.zoom) / 2;
    this.#sync();
  }

  pan(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.#sync();
  }

  /** Zooms keeping the UV point under the cursor in place. */
  zoomAt(x, y, amount) {
    const next = THREE.MathUtils.clamp(this.zoom * 1.15 ** amount, 32, 65536);
    const scale = next / this.zoom;
    this.panX = x - (x - this.panX) * scale;
    this.panY = y - (y - this.panY) * scale;
    this.zoom = next;
    this.#sync();
  }

  /** CSS pixels in the view to UV. */
  toUv(x, y) {
    return [(x - this.panX) / this.zoom, (y - this.panY) / this.zoom];
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Texture} map
   * @param {boolean} gray show the red channel as grayscale, for the Edge pass
   */
  render(renderer, map, gray) {
    this.material.uniforms.uMap.value = map;
    this.material.uniforms.uGray.value = gray ? 1 : 0;
    this.wire.visible = this.showWire;
    renderer.render(this.scene, this.camera);
  }
}
