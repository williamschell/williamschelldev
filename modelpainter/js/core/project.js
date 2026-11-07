// Project lifecycle: creating from an import, autosaving, the .splotch3d file format, exporting and
// re-unwrapping.

import { newId } from '../../../splotchle/js/ui.js';
import { DEFAULT_SHADER } from './engine.js';
import { PASSES } from '../paint/passes.js';
import { bakeMaterials, bakeTexture, transferPaint } from '../paint/bake.js';
import { importFiles, importGltf } from '../mesh/import.js';
import { analyzeUvs } from '../mesh/uvs.js';
import { unwrapGeometry } from '../mesh/unwrap.js';
import { writeGlb } from '../io/glb.js';
import { encodePng, unzipFiles, zipFiles } from '../io/worker.js';
import * as db from '../io/db.js';

export const RESOLUTIONS = [512, 1024, 2048, 4096];
export const DEFAULT_RES = 2048;
export const PROJECT_EXTENSION = '.splotch3d';

/** Defaults for the Generate Shadow helper: a value drop with a nudge toward blue-purple. */
export const DEFAULT_SHADOW = {
  hueShift: 18, targetHue: 255, saturation: 1.05, value: 0.58,
};

const AUTOSAVE_DELAY = 2500;

/** Fresh project fields that aren't specific to any model. */
function baseProject(model, res) {
  const now = Date.now();
  return {
    id: newId(),
    name: model.name,
    createdAt: now,
    updatedAt: now,
    geometry: model.geometry,
    res,
    doubleSided: model.doubleSided,
    palette: [],
    shader: { ...DEFAULT_SHADER, ...(model.toon?.settings ?? {}) },
    light: { azimuth: 320, elevation: 45 },
    shadowGen: { ...DEFAULT_SHADOW },
  };
}

export class ProjectManager {
  /** @param {import('./engine.js').Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.dirty = new Set();
    this.meshDirty = false;
    this.metaDirty = false;
    this.timer = null;
    this.saving = false;
    this.onSaved = () => {};
    this.onError = () => {};

    engine.on('painted', (pass) => {
      if (pass) this.dirty.add(pass);
      else PASSES.forEach((p) => this.dirty.add(p));
      this.schedule();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    });
    window.addEventListener('pagehide', () => { this.saveNow(); });
  }

  /** Records that settings (not paint) changed. */
  touch() {
    this.metaDirty = true;
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), AUTOSAVE_DELAY);
  }

  // Creating and opening ------------------------------------------------------------------------

  /**
   * Starts a project from dropped model files.
   * @param {File[]} files
   * @returns {Promise<{ uvNote: string|null, needsUnwrap: boolean, analysis: object }>}
   */
  async createFromFiles(files) {
    const model = await importFiles(files);
    return this.#createFromModel(model);
  }

  /** Starts a project from a model at a URL. Used for the sample models. */
  async createFromUrl(url, name) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load ${name}.`);
    const blob = await response.blob();
    const model = await importGltf(blob, [], name);
    model.name = name;
    return this.#createFromModel(model);
  }

  async #createFromModel(model) {
    const { engine } = this;
    const project = baseProject(model, DEFAULT_RES);
    const analysis = model.hasUvs
      ? analyzeUvs(model.geometry.index.array, model.geometry.attributes.uv.array)
      : {
        overlap: 1, outside: 0, empty: true, usable: false,
      };
    project.sources = model.sources; // kept so unwrapping can rebake them cleanly
    // Nothing's been painted yet, so an unwrap can rebake from the originals. A file exported from
    // this app already holds painted passes, so it has to be resampled like any painted project.
    project.pristine = !model.toon;
    engine.attach(project);
    this.#seedPasses(model);
    this.dirty = new Set(PASSES);
    this.meshDirty = true;
    this.metaDirty = true;
    await this.saveNow();
    return { analysis, needsUnwrap: !analysis.usable };
  }

  /** Fills a new project's passes from the imported model. */
  #seedPasses(model) {
    const { engine } = this;
    const { passes, project } = engine;
    bakeMaterials(passes, project.geometry, model.sources);
    if (model.toon?.shadow) bakeTexture(passes, project.geometry, 'shadow', model.toon.shadow);
    else passes.generateShadow(project.shadowGen, false);
    if (model.toon?.edge) bakeTexture(passes, project.geometry, 'edge', model.toon.edge);
    engine.requestRender();
  }

  /**
   * Opens an autosaved project.
   * @param {string} id
   */
  async openSaved(id) {
    const meta = await db.getProject(id);
    if (!meta) throw new Error('That project is gone.');
    const blobs = {};
    for (const key of ['mesh', ...PASSES]) {
      blobs[key] = await db.getBlob(id, key);
      if (!blobs[key]) throw new Error(`That project is missing its ${key} data.`);
    }
    await this.#open(meta.data, blobs.mesh, blobs, id, meta);
  }

  /**
   * Opens a .splotch3d file.
   * @param {File} file
   */
  async openFile(file) {
    const entries = await unzipFiles(new Uint8Array(await file.arrayBuffer()));
    if (!entries['project.json'] || !entries['mesh.glb']) throw new Error('That isn\'t a Splotchle 3D project file.');
    const data = JSON.parse(new TextDecoder().decode(entries['project.json']));
    if (entries['palette.json']) data.palette = JSON.parse(new TextDecoder().decode(entries['palette.json']));
    const blobs = {};
    for (const pass of PASSES) {
      if (!entries[`${pass}.png`]) throw new Error(`That project file is missing ${pass}.png.`);
      blobs[pass] = new Blob([entries[`${pass}.png`]], { type: 'image/png' });
    }
    const mesh = new Blob([entries['mesh.glb']], { type: 'model/gltf-binary' });
    // A new id, so opening a file never overwrites the autosaved copy it came from.
    await this.#open(data, mesh, blobs, newId(), { name: data.name, createdAt: data.createdAt });
    this.dirty = new Set(PASSES);
    this.meshDirty = true;
    this.metaDirty = true;
    await this.saveNow();
  }

  async #open(data, meshBlob, blobs, id, meta) {
    const { engine } = this;
    const model = await importGltf(meshBlob, [], `${data.name}.glb`);
    const project = {
      ...data,
      id,
      name: meta.name ?? data.name,
      createdAt: meta.createdAt ?? Date.now(),
      updatedAt: meta.updatedAt ?? Date.now(),
      geometry: model.geometry,
      shader: { ...DEFAULT_SHADER, ...(data.shader ?? {}) },
      light: { azimuth: 320, elevation: 45, ...(data.light ?? {}) },
      shadowGen: { ...DEFAULT_SHADOW, ...(data.shadowGen ?? {}) },
      palette: data.palette ?? [],
    };
    engine.attach(project);
    if (data.camera) engine.rig.fromJSON(data.camera);
    for (const pass of PASSES) {
      const bitmap = await createImageBitmap(blobs[pass], {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
        resizeWidth: project.res,
        resizeHeight: project.res,
      });
      engine.passes.loadPixels(pass, bitmap);
      bitmap.close();
    }
    this.dirty.clear();
    this.meshDirty = false;
    this.metaDirty = false;
    engine.requestRender();
  }

  /** Saves and closes the current project. */
  async close() {
    await this.saveNow();
    clearTimeout(this.timer);
    this.engine.detach();
  }

  // Saving --------------------------------------------------------------------------------------

  /** The project's settings as plain data. */
  #data() {
    const { project, rig } = this.engine;
    return {
      version: 1,
      name: project.name,
      createdAt: project.createdAt,
      res: project.res,
      doubleSided: project.doubleSided,
      palette: project.palette,
      shader: project.shader,
      light: project.light,
      shadowGen: project.shadowGen,
      camera: rig.toJSON(),
    };
  }

  /** The geometry as GLB bytes, with no textures. */
  #meshBytes() {
    const { project } = this.engine;
    const g = project.geometry;
    return writeGlb({
      name: project.name,
      position: g.attributes.position.array,
      normal: g.attributes.normal.array,
      uv: g.attributes.uv.array,
      index: g.index.array,
    });
  }

  /** @returns {Promise<Uint8Array>} one pass as PNG, encoded off the main thread */
  async #passPng(pass) {
    const { passes } = this.engine;
    const pixels = await passes.readPassAsync(pass);
    return encodePng(pixels, passes.res, passes.res);
  }

  /** Writes whatever changed to IndexedDB. Safe to call at any time. */
  async saveNow() {
    const { engine } = this;
    const { project } = engine;
    if (!project || this.saving || engine.painter?.painting) return;
    if (this.dirty.size === 0 && !this.meshDirty && !this.metaDirty) return;
    this.saving = true;
    clearTimeout(this.timer);
    const passes = [...this.dirty];
    const meshDirty = this.meshDirty;
    this.dirty.clear();
    this.meshDirty = false;
    this.metaDirty = false;
    try {
      const blobs = {};
      for (const pass of passes) blobs[pass] = new Blob([await this.#passPng(pass)], { type: 'image/png' });
      if (meshDirty) blobs.mesh = new Blob([this.#meshBytes()], { type: 'model/gltf-binary' });
      project.updatedAt = Date.now();
      const thumb = await engine.thumbnail();
      if (engine.project !== project) return; // closed while saving
      await db.saveProject({
        id: project.id, name: project.name, updatedAt: project.updatedAt, thumb, data: this.#data(),
      }, blobs);
      this.onSaved();
    } catch (error) {
      // Put the work back so the next attempt still covers it.
      for (const pass of passes) this.dirty.add(pass);
      if (meshDirty) this.meshDirty = true;
      this.onError(error);
    } finally {
      this.saving = false;
      if (this.dirty.size > 0 || this.meshDirty || this.metaDirty) this.schedule();
    }
  }

  // Files and exports ---------------------------------------------------------------------------

  /** @returns {Promise<Blob>} a .splotch3d project file */
  async projectFile() {
    const data = this.#data();
    const files = {
      'project.json': new TextEncoder().encode(JSON.stringify(data, null, 2)),
      'palette.json': new TextEncoder().encode(JSON.stringify(data.palette)),
      'mesh.glb': new Uint8Array(this.#meshBytes()),
    };
    for (const pass of PASSES) files[`${pass}.png`] = await this.#passPng(pass);
    return new Blob([await zipFiles(files)], { type: 'application/zip' });
  }

  /** @returns {Promise<Blob>} the GLB for the game, with the toon extension */
  async exportGlb() {
    const { project } = this.engine;
    const g = project.geometry;
    const [litPng, shadowPng, edgePng] = await Promise.all(PASSES.map((pass) => this.#passPng(pass)));
    const bytes = writeGlb({
      name: project.name,
      position: g.attributes.position.array,
      normal: g.attributes.normal.array,
      uv: g.attributes.uv.array,
      index: g.index.array,
      litPng,
      shadowPng,
      edgePng,
      toon: project.shader,
    });
    return new Blob([bytes], { type: 'model/gltf-binary' });
  }

  /** @returns {Promise<Blob>} one pass as a PNG */
  async exportPng(pass) {
    return new Blob([await this.#passPng(pass)], { type: 'image/png' });
  }

  // Unwrapping ----------------------------------------------------------------------------------

  /**
   * Generates a new UV layout and carries the paint across, as one undoable step.
   * @param {{ padding: number, density: number, onProgress?: Function }} options
   */
  async unwrap({ padding, density, onProgress }) {
    const { engine } = this;
    const { project, passes } = engine;
    const oldGeometry = project.geometry;
    const geometry = await unwrapGeometry(oldGeometry, {
      res: project.res, padding, density, onProgress,
    });
    if (engine.project !== project) return;

    let snapshot = passes.snapshotAll();
    let other = oldGeometry;
    engine.setGeometry(geometry);
    if (project.pristine) {
      // Nothing painted yet, so bake from the original materials instead of resampling. This is what
      // merges a multi-material model onto one atlas with no overlap damage. xatlas keeps triangle
      // order, so each material's index range still holds.
      bakeMaterials(passes, geometry, project.sources);
      passes.generateShadow(project.shadowGen, false);
    } else {
      transferPaint(passes, geometry);
    }
    project.pristine = false;
    geometry.deleteAttribute('uvOld');

    engine.history.push({
      label: 'Unwrap',
      bytes: project.res * project.res * 4 * 3,
      swap: () => {
        const current = passes.snapshotAll();
        const currentGeometry = project.geometry;
        engine.setGeometry(other);
        passes.restoreAll(snapshot);
        other = currentGeometry;
        snapshot = current;
        this.meshDirty = true;
        this.schedule();
      },
    });
    PASSES.forEach((p) => this.dirty.add(p));
    this.meshDirty = true;
    this.schedule();
    engine.requestRender();
  }

  /** Changes the texture resolution, resampling all three passes. */
  setResolution(res) {
    const { engine } = this;
    const { project, passes } = engine;
    if (project.res === res) return;
    project.res = res;
    passes.resize(res, project.geometry);
    engine.painter.dropSurfaces();
    engine.islandMap.invalidate();
    PASSES.forEach((p) => this.dirty.add(p));
    this.touch();
    engine.requestRender();
  }
}
