// Baking into texture space: an imported model's materials into the Lit pass, and old paint into a
// new UV layout.

import * as THREE from 'three';
import { clearTarget } from '../gl/util.js';
import {
  bakeFragment, transferFragment, transferVertex, uvSpaceVertex,
} from '../shaders/paint.glsl.js';

/** Clay color for a model that came with nothing painted on it. */
const CLAY = [0.91, 0.885, 0.84];
const isPlainWhite = ([r, g, b]) => r > 0.99 && g > 0.99 && b > 0.99;

function drawInto(renderer, target, mesh) {
  const scene = new THREE.Scene();
  scene.add(mesh);
  mesh.frustumCulled = false;
  const previous = renderer.getRenderTarget();
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(previous);
  renderer.autoClear = autoClear;
  scene.remove(mesh);
}

/**
 * Draws each imported material into the Lit pass using the geometry's current UVs.
 * @param {import('./passes.js').PassStore} passes
 * @param {THREE.BufferGeometry} geometry
 * @param {import('../mesh/import.js').ImportedModel['sources']} sources
 * @returns {boolean} whether the model brought any colors or textures of its own
 */
export function bakeMaterials(passes, geometry, sources) {
  const { renderer } = passes;
  const brought = sources.some((s) => s.map || !isPlainWhite(s.color));
  clearTarget(renderer, passes.work, CLAY[0], CLAY[1], CLAY[2], 1);
  // After an unwrap the textures still match the old UVs, so that's where they get read.
  const reader = geometry.attributes.uvOld
    ? transferVertex.replace('varying vec2 vUvOld;', 'varying vec2 vUv;').replace('vUvOld = uvOld;', 'vUv = uvOld;')
    : uvSpaceVertex;
  const material = new THREE.ShaderMaterial({
    vertexShader: reader,
    fragmentShader: bakeFragment,
    uniforms: {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uColor: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const view = geometry.clone();
  for (const source of sources) {
    if (source.map) {
      source.map.colorSpace = THREE.NoColorSpace;
      source.map.needsUpdate = true;
    }
    material.uniforms.uMap.value = source.map;
    material.uniforms.uHasMap.value = source.map ? 1 : 0;
    const color = !source.map && isPlainWhite(source.color) ? CLAY : source.color;
    material.uniforms.uColor.value.set(color[0], color[1], color[2]);
    material.uniformsNeedUpdate = true;
    view.setDrawRange(source.start, source.count);
    drawInto(renderer, passes.work, new THREE.Mesh(view, material));
  }
  passes.loadFrom('lit', passes.work.texture);
  view.dispose();
  material.dispose();
  return brought;
}

/**
 * Bakes a stored texture into a pass. The image already matches the UVs, so it's a straight copy,
 * with the padding rebuilt afterward for this layout.
 * @param {import('./passes.js').PassStore} passes
 * @param {THREE.BufferGeometry} geometry
 * @param {string} pass
 * @param {THREE.Texture} texture
 */
export function bakeTexture(passes, geometry, pass, texture) {
  const { renderer } = passes;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  clearTarget(renderer, passes.work, 0.5, 0.5, 0.5, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader: uvSpaceVertex,
    fragmentShader: 'uniform sampler2D uMap; varying vec2 vUv; void main() { gl_FragColor = texture2D(uMap, vUv); }',
    uniforms: { uMap: { value: texture } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  drawInto(renderer, passes.work, new THREE.Mesh(geometry, material));
  passes.loadFrom(pass, passes.work.texture);
  material.dispose();
}

/**
 * Carries paint over to a new UV layout: draws the mesh in its new layout, reading each pass at the
 * old UVs. Each result goes into a new texture set, since the sources are read until the last pass.
 * @param {import('./passes.js').PassStore} passes
 * @param {THREE.BufferGeometry} geometry must have uvOld
 */
export function transferPaint(passes, geometry) {
  const { renderer } = passes;
  const material = new THREE.ShaderMaterial({
    vertexShader: transferVertex,
    fragmentShader: transferFragment,
    uniforms: { uSource: { value: null } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  for (const pass of ['lit', 'shadow', 'edge']) {
    const clay = pass === 'edge' ? [0.5, 0.5, 0.5, 1] : [0, 0, 0, 0];
    clearTarget(renderer, passes.work, ...clay);
    material.uniforms.uSource.value = passes.targets[pass].texture;
    material.uniformsNeedUpdate = true;
    drawInto(renderer, passes.work, new THREE.Mesh(geometry, material));
    passes.loadFrom(pass, passes.work.texture);
  }
  material.dispose();
}
