// Writes binary glTF by hand. Pure: typed arrays and PNG bytes in, one ArrayBuffer out. Writing it
// directly keeps the WSCHELL_toon_paint extension and the texture order exact, with no loader in
// between to second-guess them.

export const TOON_EXTENSION = 'WSCHELL_toon_paint';

const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'
const MAGIC = 0x46546c67; // 'glTF'

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;
const REPEAT = 10497;

const align4 = (n) => (n + 3) & ~3;

/** Min and max per component, which glTF requires for positions. */
function bounds(array, size) {
  const min = new Array(size).fill(Infinity);
  const max = new Array(size).fill(-Infinity);
  for (let i = 0; i < array.length; i += size) {
    for (let k = 0; k < size; k++) {
      if (array[i + k] < min[k]) min[k] = array[i + k];
      if (array[i + k] > max[k]) max[k] = array[i + k];
    }
  }
  return { min, max };
}

/**
 * @param {object} options
 * @param {string} options.name
 * @param {Float32Array} options.position
 * @param {Float32Array} options.normal
 * @param {Float32Array} options.uv
 * @param {Uint16Array|Uint32Array} options.index
 * @param {Uint8Array} [options.litPng] Lit pass, stored as the base color
 * @param {Uint8Array} [options.shadowPng]
 * @param {Uint8Array} [options.edgePng]
 * @param {object} [options.toon] threshold, softness, edgeStrength, rimColor, rimPower, rimStrength
 * @returns {ArrayBuffer}
 */
export function writeGlb({
  name, position, normal, uv, index, litPng, shadowPng, edgePng, toon,
}) {
  const parts = [];
  const bufferViews = [];
  const accessors = [];
  let offset = 0;

  const addView = (bytes, target) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength };
    if (target) view.target = target;
    bufferViews.push(view);
    parts.push(bytes);
    offset += align4(bytes.byteLength);
    return bufferViews.length - 1;
  };
  const addAccessor = (array, type, componentType, target, extra = {}) => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    accessors.push({
      bufferView: addView(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), target),
      componentType,
      count: array.length / size,
      type,
      ...extra,
    });
    return accessors.length - 1;
  };

  const attributes = {
    POSITION: addAccessor(position, 'VEC3', FLOAT, ARRAY_BUFFER, bounds(position, 3)),
    NORMAL: addAccessor(normal, 'VEC3', FLOAT, ARRAY_BUFFER),
    TEXCOORD_0: addAccessor(uv, 'VEC2', FLOAT, ARRAY_BUFFER),
  };
  const indices = addAccessor(
    index,
    'SCALAR',
    index instanceof Uint32Array ? UNSIGNED_INT : UNSIGNED_SHORT,
    ELEMENT_ARRAY_BUFFER,
  );

  const images = [];
  const textures = [];
  const addTexture = (png) => {
    images.push({ bufferView: addView(png), mimeType: 'image/png' });
    textures.push({ sampler: 0, source: images.length - 1 });
    return textures.length - 1;
  };

  const material = {
    name: 'toon',
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
    doubleSided: false,
  };
  if (litPng) material.pbrMetallicRoughness.baseColorTexture = { index: addTexture(litPng) };
  const hasToon = Boolean(toon && shadowPng && edgePng);
  if (hasToon) {
    material.extensions = {
      [TOON_EXTENSION]: {
        shadowTexture: { index: addTexture(shadowPng) },
        edgeTexture: { index: addTexture(edgePng) },
        threshold: toon.threshold,
        softness: toon.softness,
        edgeStrength: toon.edgeStrength,
        rimColor: toon.rimColor,
        rimPower: toon.rimPower,
        rimStrength: toon.rimStrength,
      },
    };
  }

  const json = {
    asset: { version: '2.0', generator: 'Splotchle 3D' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes, indices, material: 0 }] }],
    materials: [material],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  if (textures.length > 0) {
    json.textures = textures;
    json.images = images;
    json.samplers = [{
      magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: REPEAT, wrapT: REPEAT,
    }];
  }
  // extensionsUsed but not extensionsRequired, so other viewers still open the file.
  if (hasToon) json.extensionsUsed = [TOON_EXTENSION];

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + offset;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength); // JSON pads with spaces
  const binStart = 20 + jsonLength;
  view.setUint32(binStart, offset, true);
  view.setUint32(binStart + 4, BIN_CHUNK, true);
  let at = binStart + 8;
  for (const part of parts) {
    bytes.set(part, at);
    at += align4(part.byteLength);
  }
  return out;
}

/**
 * Reads a GLB's JSON chunk. Used by the tests and when checking files.
 * @param {ArrayBuffer} buffer
 * @returns {object}
 */
export function readGlbJson(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a GLB file.');
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
}
