// Automatic UV unwrapping with xatlas, which runs in its own worker so the UI never stalls.

import * as THREE from 'three';
import { proxy, wrap } from '../../vendor/comlink/comlink.mjs';

// xatlas's web wrapper hands back 16-bit indices, and unwrapping adds vertices along seams. Keeping
// each chunk well under the limit leaves room for that. Larger models get split into several chunks,
// which only adds a seam where chunks meet.
const CHUNK_VERTICES = 30000;

/**
 * Splits a mesh into chunks small enough for 16-bit indices.
 * @param {ArrayLike<number>} index
 * @param {number} limit most vertices per chunk
 * @returns {{ vertices: number[], indices: number[] }[]} vertices lists original vertex numbers,
 *   and indices point into that list
 */
export function chunkMesh(index, limit = CHUNK_VERTICES) {
  const chunks = [];
  let map = new Map();
  let chunk = { vertices: [], indices: [] };
  for (let t = 0; t + 2 < index.length; t += 3) {
    let extra = 0;
    for (let k = 0; k < 3; k++) if (!map.has(index[t + k])) extra++;
    if (chunk.vertices.length + extra > limit) {
      chunks.push(chunk);
      chunk = { vertices: [], indices: [] };
      map = new Map();
    }
    for (let k = 0; k < 3; k++) {
      const v = index[t + k];
      let local = map.get(v);
      if (local === undefined) {
        local = chunk.vertices.length;
        map.set(v, local);
        chunk.vertices.push(v);
      }
      chunk.indices.push(local);
    }
  }
  if (chunk.indices.length > 0) chunks.push(chunk);
  return chunks;
}

/**
 * Generates a new UV layout. The result carries the old UVs as `uvOld` for the paint transfer.
 * @param {THREE.BufferGeometry} geometry
 * @param {{ res: number, padding: number, density?: number, onProgress?: (label: string, percent: number) => void }} options
 *   padding is in texels at res. density is texels per world unit, with 0 meaning fit the texture.
 * @returns {Promise<THREE.BufferGeometry>}
 */
export async function unwrapGeometry(geometry, {
  res, padding, density = 0, onProgress = () => {},
}) {
  const worker = new Worker(new URL('../../vendor/xatlas/xatlas.js', import.meta.url));
  try {
    const Api = wrap(worker);
    const atlas = await new Api(
      undefined,
      undefined,
      proxy((mode, progress) => onProgress(String(mode), progress)),
    );
    for (let tries = 0; !(await atlas.loaded); tries++) {
      if (tries > 200) throw new Error('The unwrapper didn\'t load.');
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    await atlas.createAtlas();

    const index = geometry.index.array;
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    const uv = geometry.attributes.uv.array;
    const chunks = chunkMesh(index);
    for (let c = 0; c < chunks.length; c++) {
      const { vertices, indices } = chunks[c];
      const pos = new Float32Array(vertices.length * 3);
      const nor = new Float32Array(vertices.length * 3);
      for (let i = 0; i < vertices.length; i++) {
        for (let k = 0; k < 3; k++) {
          pos[i * 3 + k] = position[vertices[i] * 3 + k];
          nor[i * 3 + k] = normal[vertices[i] * 3 + k];
        }
      }
      const added = await atlas.addMesh(new Uint16Array(indices), pos, nor, null, c, true, false, 1);
      if (!added) throw new Error('The unwrapper rejected this mesh. It may have broken triangles.');
    }

    const result = await atlas.generateAtlas(
      {},
      {
        padding: Math.max(1, Math.round(padding)),
        resolution: density > 0 ? 0 : res,
        texelsPerUnit: density,
        bilinear: true,
        rotateCharts: true,
      },
      true,
    );
    const output = buildGeometry(result, chunks, { position, normal, uv });
    await atlas.destroyAtlas();
    return output;
  } finally {
    worker.terminate();
  }
}

/** Joins the unwrapped chunks back into one geometry. */
function buildGeometry(result, chunks, source) {
  if (result.atlasCount > 1) throw new Error('That density needs more than one texture. Lower it, or leave it at 0.');
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const mesh of result.meshes) {
    vertexTotal += mesh.vertexCount;
    indexTotal += mesh.index.length;
  }
  const position = new Float32Array(vertexTotal * 3);
  const normal = new Float32Array(vertexTotal * 3);
  const uv = new Float32Array(vertexTotal * 2);
  const uvOld = new Float32Array(vertexTotal * 2);
  const index = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of result.meshes) {
    const { vertices } = chunks[mesh.mesh];
    if (mesh.vertexCount > 65535) throw new Error('This mesh grew too large while unwrapping. Try decimating it first.');
    const { coords1 } = mesh.vertex;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const original = vertices[mesh.oldIndexes[i]];
      const at = vertexOffset + i;
      for (let k = 0; k < 3; k++) {
        position[at * 3 + k] = source.position[original * 3 + k];
        normal[at * 3 + k] = source.normal[original * 3 + k];
      }
      uv[at * 2] = coords1[i * 2];
      uv[at * 2 + 1] = coords1[i * 2 + 1];
      uvOld[at * 2] = source.uv[original * 2];
      uvOld[at * 2 + 1] = source.uv[original * 2 + 1];
    }
    for (let i = 0; i < mesh.index.length; i++) index[indexOffset++] = mesh.index[i] + vertexOffset;
    vertexOffset += mesh.vertexCount;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('uvOld', new THREE.BufferAttribute(uvOld, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}
