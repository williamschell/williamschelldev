// Turns a model file into what the painter works on: one geometry in world space (one texture set
// per project), plus the materials it came with so they can be baked into the Lit pass.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const TOON_EXTENSION = 'WSCHELL_toon_paint';

/**
 * @typedef {object} ImportedModel
 * @property {string} name
 * @property {THREE.BufferGeometry} geometry has index, position, normal and uv
 * @property {boolean} hasUvs false if any part of the model came without UVs
 * @property {boolean} doubleSided
 * @property {{ start: number, count: number, map: THREE.Texture|null, color: [number, number, number] }[]} sources
 *   index ranges and their materials, with color in sRGB
 * @property {{ shadow: THREE.Texture|null, edge: THREE.Texture|null, settings: object }|null} toon
 *   painted data, when the file was exported from this app
 */

/** Strips the extension and any folders from a file name. */
export const baseName = (name) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Untitled';

/**
 * Loads a model from dropped files. Accepts .glb, .obj, or .gltf with its resources dropped alongside.
 * @param {File[]} files
 * @returns {Promise<ImportedModel>}
 */
export async function importFiles(files) {
  const main = files.find((f) => /\.(glb|gltf)$/i.test(f.name)) ?? files.find((f) => /\.obj$/i.test(f.name));
  if (!main) throw new Error('Drop a .glb, .gltf or .obj file.');
  if (/\.obj$/i.test(main.name)) {
    const group = new OBJLoader().parse(await main.text());
    return { name: baseName(main.name), ...flatten(group, { flipV: true }), toon: null };
  }
  return importGltf(main, files);
}

/**
 * @param {File|Blob} main
 * @param {File[]} [files] the other dropped files, which a .gltf may point at
 * @param {string} [name]
 * @returns {Promise<ImportedModel>}
 */
export async function importGltf(main, files = [], name = main.name) {
  const manager = new THREE.LoadingManager();
  const urls = new Map();
  for (const file of files) {
    if (file !== main) urls.set(file.name.toLowerCase(), URL.createObjectURL(file));
  }
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const file = decodeURIComponent(url).replace(/^.*[\\/]/, '').toLowerCase();
    return urls.get(file) ?? url;
  });
  const loader = new GLTFLoader(manager);
  try {
    const buffer = await main.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, (error) => reject(explainGltfError(error)));
    });
    const flat = flatten(gltf.scene, { flipV: false });
    return { name: baseName(name), ...flat, toon: await readToonExtension(gltf) };
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

function explainGltfError(error) {
  const message = String(error?.message ?? error);
  if (/DRACO/i.test(message)) return new Error('This file uses Draco compression, which the painter can\'t read yet. Re-export it without compression.');
  if (/meshopt/i.test(message)) return new Error('This file uses Meshopt compression, which the painter can\'t read yet. Re-export it without compression.');
  return new Error(`Couldn't read that glTF file: ${message}`);
}

/** Reads the painted passes and shader settings back out of a file this app exported. */
async function readToonExtension(gltf) {
  const definition = gltf.parser.json.materials?.[0]?.extensions?.[TOON_EXTENSION];
  if (!definition) return null;
  const load = async (ref) => {
    if (!ref) return null;
    const texture = await gltf.parser.getDependency('texture', ref.index);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  };
  return {
    shadow: await load(definition.shadowTexture),
    edge: await load(definition.edgeTexture),
    settings: {
      threshold: definition.threshold,
      softness: definition.softness,
      edgeStrength: definition.edgeStrength,
      rimColor: definition.rimColor,
      rimPower: definition.rimPower,
      rimStrength: definition.rimStrength,
    },
  };
}

/**
 * Bakes every mesh in a scene into one geometry in world space.
 * @param {THREE.Object3D} root
 * @param {{ flipV: boolean }} options flipV moves OBJ UVs (v = 0 at the bottom) to glTF's convention
 * @returns {Omit<ImportedModel, 'name'|'toon'>}
 */
export function flatten(root, { flipV }) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((node) => {
    if (node.isMesh && node.geometry?.attributes.position) parts.push(node);
  });
  if (parts.length === 0) throw new Error('That file has no meshes in it.');

  let vertexTotal = 0;
  let indexTotal = 0;
  for (const part of parts) {
    const geometry = part.geometry;
    vertexTotal += geometry.attributes.position.count;
    indexTotal += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }
  if (indexTotal === 0) throw new Error('That file\'s meshes have no triangles.');

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const indices = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

  const sources = [];
  let hasUvs = true;
  let doubleSided = false;
  let vertexOffset = 0;
  let indexOffset = 0;
  const point = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  for (const part of parts) {
    let { geometry } = part;
    if (!geometry.attributes.normal) {
      geometry = geometry.clone();
      geometry.computeVertexNormals();
    }
    const {
      position, normal, uv,
    } = geometry.attributes;
    normalMatrix.getNormalMatrix(part.matrixWorld);
    if (!uv) hasUvs = false;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld);
      point.toArray(positions, (vertexOffset + i) * 3);
      point.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      point.toArray(normals, (vertexOffset + i) * 3);
      if (uv) {
        uvs[(vertexOffset + i) * 2] = uv.getX(i);
        uvs[(vertexOffset + i) * 2 + 1] = flipV ? 1 - uv.getY(i) : uv.getY(i);
      }
    }

    // A mirrored transform turns triangles inside out, so their winding has to flip back.
    const mirrored = part.matrixWorld.determinant() < 0;
    const count = geometry.index ? geometry.index.count : position.count;
    const start = indexOffset;
    for (let i = 0; i < count; i += 3) {
      const a = geometry.index ? geometry.index.getX(i) : i;
      const b = geometry.index ? geometry.index.getX(i + 1) : i + 1;
      const c = geometry.index ? geometry.index.getX(i + 2) : i + 2;
      indices[indexOffset++] = a + vertexOffset;
      indices[indexOffset++] = (mirrored ? c : b) + vertexOffset;
      indices[indexOffset++] = (mirrored ? b : c) + vertexOffset;
    }

    const materials = Array.isArray(part.material) ? part.material : [part.material];
    if (materials.some((m) => m?.side === THREE.DoubleSide)) doubleSided = true;
    const groups = geometry.groups.length > 0 && Array.isArray(part.material)
      ? geometry.groups
      : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex] ?? materials[0];
      sources.push({
        start: start + group.start,
        count: Math.min(group.count, count - group.start),
        map: material?.map ?? null,
        color: srgbOf(material?.color),
      });
    }
    vertexOffset += position.count;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return {
    geometry, hasUvs, doubleSided, sources,
  };
}

/** Three keeps material colors linear. The painter works in sRGB. */
function srgbOf(color) {
  if (!color) return [1, 1, 1];
  const c = color.clone().convertLinearToSRGB();
  return [c.r, c.g, c.b];
}

/** Adds the ray-casting tree used by the cursor, the camera pivot and click-to-fill. */
export function prepareGeometry(geometry) {
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.disposeBoundsTree?.();
  geometry.computeBoundsTree({ indirect: true });
}
