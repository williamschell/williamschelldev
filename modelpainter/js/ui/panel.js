// The side panel: color, brush settings, palettes, helpers, shader, light, UVs and project options.

import { el, toast } from '../../../splotchle/js/ui.js';
import { ColorPicker } from './colorpicker.js';
import { parseHex } from './color.js';
import { swatchRow } from './swatches.js';
import { RESOLUTIONS } from '../core/project.js';
import { DEFAULT_SHADER } from '../core/engine.js';
import { extractPaletteAsync } from '../io/worker.js';
import { saveSettings, settings } from '../core/settings.js';
import { BRUSHES } from '../paint/brush.js';

const EDGE_GRAYS = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'];
const PALETTE_IMAGE = 256; // reference images get shrunk to this before k-means

/** A collapsible group. Only the few things used most start open. */
const section = (title, open, ...children) => el('details', { class: 'section', open }, el('summary', {}, title), ...children);

/**
 * A labeled slider.
 * @param {string} label
 * @param {object} options
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} options.step
 * @param {() => number} options.get
 * @param {(value: number) => void} options.set
 * @param {(value: number) => string} [options.format]
 * @returns {HTMLElement & { refresh: () => void }}
 */
function slider(label, {
  min, max, step, get, set, format = String,
}) {
  const output = el('output');
  const input = el('input', {
    type: 'range', min, max, step, value: get(),
  });
  input.addEventListener('input', () => {
    set(Number(input.value));
    output.textContent = format(Number(input.value));
  });
  const field = el('label', { class: 'field' }, label, output, input);
  field.refresh = () => {
    input.value = get();
    output.textContent = format(get());
  };
  field.refresh();
  return field;
}

const percent = (v) => `${Math.round(v * 100)}%`;

/**
 * Builds the panel.
 * @param {HTMLElement} host
 * @param {object} deps
 * @param {import('../core/engine.js').Engine} deps.engine
 * @param {import('../core/project.js').ProjectManager} deps.manager
 * @param {(label: string, work: () => Promise<any>) => Promise<any>} deps.busy
 * @param {(options?: object) => Promise<void>} deps.unwrap
 * @returns {{ refresh: () => void, refreshProject: () => void, takeImage: (source: Blob) => void }}
 */
export function buildPanel(host, {
  engine, manager, busy, unwrap,
}) {
  const { tool } = engine;
  const project = () => engine.project;
  const brush = () => engine.brushSettings;
  const refreshers = [];
  const add = (control) => {
    refreshers.push(control.refresh);
    return control;
  };

  // Color -----------------------------------------------------------------------------------------
  const pickerCanvas = el('canvas', {
    class: 'picker', tabIndex: 0, 'aria-label': 'Color wheel. Arrow keys change saturation and value, Shift and arrows change hue.',
  });
  const hexInput = el('input', {
    type: 'text', spellcheck: false, autocomplete: 'off', maxLength: 7, 'aria-label': 'Hex color',
  });
  const chip = el('span', { class: 'color-chip', 'aria-hidden': 'true' });
  const recent = el('div', { class: 'swatches' });
  const setColor = (hex) => {
    tool.color = hex;
    picker.set(hex);
    hexInput.value = hex;
    chip.style.setProperty('--swatch', hex);
    engine.emit('colorpicked', hex);
  };
  const picker = new ColorPicker(pickerCanvas, (hex) => {
    tool.color = hex;
    hexInput.value = hex;
    chip.style.setProperty('--swatch', hex);
  });
  hexInput.addEventListener('change', () => {
    const hex = parseHex(hexInput.value);
    if (hex) setColor(hex);
    else hexInput.value = tool.color;
  });
  const opacity = add(slider('Opacity', {
    min: 0.05, max: 1, step: 0.01, get: () => brush().opacity, set: (v) => { brush().opacity = v; }, format: percent,
  }));
  const edgeHint = el('div', { class: 'edge-hint' },
    el('p', {}, 'Lighter stays lit longer. Darker falls into shadow sooner. Paint with texture to make the shadow edge brushy.'),
    el('div', {
      class: 'swatches',
    }, ...EDGE_GRAYS.map((gray) => el('button', {
      type: 'button',
      class: 'swatch',
      style: `--swatch:${gray}`,
      'aria-label': `Use gray ${gray}`,
      title: gray === '#808080' ? 'Neutral: no shift' : gray,
      onclick: () => setColor(gray),
    }))));

  const renderRecent = () => {
    recent.replaceChildren(...settings.recentColors.map((color) => el('button', {
      type: 'button',
      class: 'swatch small',
      style: `--swatch:${color}`,
      'aria-label': `Use recent color ${color}`,
      title: color,
      onclick: () => setColor(color),
    })));
  };
  engine.on('colorused', (color) => {
    saveSettings({ recentColors: [color, ...settings.recentColors.filter((c) => c !== color)].slice(0, 12) });
    renderRecent();
  });

  const colorSection = el('div', { class: 'section color-section' },
    pickerCanvas,
    el('div', { class: 'row hex-row' }, chip, hexInput),
    opacity,
    edgeHint,
    el('h3', { class: 'mini-heading' }, 'Recent'),
    recent);

  // Brush -------------------------------------------------------------------------------------------
  const brushHeading = el('h3', { class: 'mini-heading' });
  const tipSelect = el('select', { 'aria-label': 'Eraser tip' },
    ...BRUSHES.map((b) => el('option', { value: b.id }, b.name)));
  tipSelect.addEventListener('change', () => {
    tool.eraser.tip = tipSelect.value;
    refresh();
  });
  const tipField = el('label', { class: 'field' }, 'Eraser tip', tipSelect);
  const size = add(slider('Size', {
    min: 1, max: 300, step: 1, get: () => brush().size, set: (v) => { brush().size = v; }, format: (v) => `${v} px`,
  }));
  const spacing = add(slider('Spacing', {
    min: 0, max: 0.5, step: 0.01, get: () => brush().spacing, set: (v) => { brush().spacing = v; }, format: percent,
  }));
  const curve = add(slider('Pressure curve', {
    min: 0.4,
    max: 2.5,
    step: 0.05,
    get: () => settings.pressureCurve,
    set: (v) => saveSettings({ pressureCurve: v }),
    format: (v) => (v < 0.95 ? `Soft ${v}` : v > 1.05 ? `Firm ${v}` : 'Linear'),
  }));
  const pressureOn = el('input', { type: 'checkbox', checked: settings.usePressure });
  pressureOn.addEventListener('change', () => saveSettings({ usePressure: pressureOn.checked }));
  const worldSize = el('input', { type: 'checkbox', checked: settings.worldSizeBrush });
  worldSize.addEventListener('change', () => saveSettings({ worldSizeBrush: worldSize.checked }));
  const brushSection = section('Brush', true,
    brushHeading,
    tipField,
    size,
    spacing,
    curve,
    el('label', { class: 'check-field' }, pressureOn, el('span', {}, 'Use pen pressure')),
    el('label', { class: 'check-field' }, worldSize, el('span', {}, 'Size in world units (keeps its size on the model when you zoom)')),
    el('p', {
      class: 'pen-status',
    }, 'No effect from your tablet on Windows? Turn on Windows Ink in its settings.'));

  // Fill ------------------------------------------------------------------------------------------
  const fillModes = [['island', 'Island'], ['connected', 'Connected'], ['whole', 'Whole']];
  const fillRadios = fillModes.map(([value, label]) => {
    const input = el('input', {
      type: 'radio', name: 'fill-mode', value, checked: tool.fillMode === value,
    });
    input.addEventListener('change', () => {
      tool.fillMode = value;
      tolerance.hidden = value !== 'connected';
    });
    return el('label', {}, input, el('span', {}, label));
  });
  const tolerance = add(slider('Color tolerance', {
    min: 0, max: 127, step: 1, get: () => tool.tolerance, set: (v) => { tool.tolerance = v; },
  }));
  tolerance.hidden = tool.fillMode !== 'connected';
  const eyedropRadios = [['texel', 'Pass texel'], ['final', 'Final pixel']].map(([value, label]) => {
    const input = el('input', {
      type: 'radio', name: 'eyedrop-source', value, checked: settings.eyedropSource === value,
    });
    input.addEventListener('change', () => saveSettings({ eyedropSource: value }));
    return el('label', {}, input, el('span', {}, label));
  });
  const fillSection = section('Fill and eyedropper', false,
    el('p', { class: 'mini-heading' }, 'Fill bucket'),
    el('div', { class: 'row segmented', role: 'radiogroup', 'aria-label': 'Fill mode' }, ...fillRadios),
    tolerance,
    el('p', { class: 'mini-heading' }, 'Eyedropper samples'),
    el('div', { class: 'row segmented', role: 'radiogroup', 'aria-label': 'Eyedropper source' }, ...eyedropRadios));

  // Palettes --------------------------------------------------------------------------------------
  const projectSwatches = el('div', { class: 'swatches' });
  const globalSwatches = el('div', { class: 'swatches' });
  const projectRow = swatchRow(projectSwatches, {
    label: 'Project palette',
    get: () => project()?.palette ?? [],
    set: (colors) => {
      project().palette = colors;
      manager.touch();
    },
    onPick: setColor,
    current: () => tool.color,
  });
  swatchRow(globalSwatches, {
    label: 'Global palette',
    get: () => settings.globalPalette,
    set: (colors) => saveSettings({ globalPalette: colors }),
    onPick: setColor,
    current: () => tool.color,
  });

  const paletteCount = { value: 8 };
  const count = slider('Colors to grab', {
    min: 4, max: 16, step: 1, get: () => paletteCount.value, set: (v) => { paletteCount.value = v; },
  });

  /** Pulls colors from pixels into the project palette. */
  const grab = async (pixels) => {
    const colors = await extractPaletteAsync(pixels, paletteCount.value);
    if (colors.length === 0) {
      toast('That image has no solid colors to grab.');
      return;
    }
    project().palette = [...new Set([...project().palette, ...colors])];
    manager.touch();
    projectRow.render();
    toast(`Added ${colors.length} colors to the palette.`);
  };

  const takeImage = async (source) => {
    try {
      const bitmap = await createImageBitmap(source);
      const scale = Math.min(1, PALETTE_IMAGE / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      await grab(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      toast('Couldn\'t read that image.');
    }
  };

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', hidden: true,
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) takeImage(fileInput.files[0]);
    fileInput.value = '';
  });
  const dropZone = el('div', {
    class: 'palette-drop',
    tabIndex: 0,
    role: 'button',
    onclick: () => fileInput.click(),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    },
    ondragover: (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    ondrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (file) takeImage(file);
    },
  }, 'Drop or paste a reference image, or click to choose one');

  const paletteSection = section('Palettes', true,
    el('h3', { class: 'mini-heading' }, 'This project'),
    projectSwatches,
    el('h3', { class: 'mini-heading' }, 'All projects'),
    globalSwatches,
    el('h3', { class: 'mini-heading' }, 'Palette grabber'),
    count,
    dropZone,
    fileInput,
    el('button', {
      type: 'button',
      class: 'button small wide',
      onclick: async () => {
        const { res } = engine.passes;
        const pixels = engine.passes.readPass(engine.pass);
        // Every sampled texel is cloned over to the worker, so thin it out first.
        const stride = Math.max(1, Math.floor(res / PALETTE_IMAGE));
        const thin = new Uint8Array(Math.ceil(res / stride) ** 2 * 4);
        let o = 0;
        for (let y = 0; y < res; y += stride) {
          for (let x = 0; x < res; x += stride) {
            thin.set(pixels.subarray((y * res + x) * 4, (y * res + x) * 4 + 4), o);
            o += 4;
          }
        }
        await grab(thin.subarray(0, o));
      },
    }, 'Grab from the current pass'));

  // Helpers ---------------------------------------------------------------------------------------
  const gen = () => project()?.shadowGen ?? {
    hueShift: 0, targetHue: 0, saturation: 1, value: 1,
  };
  const hueShift = add(slider('Hue shift', {
    min: 0, max: 90, step: 1, get: () => gen().hueShift, set: (v) => { gen().hueShift = v; manager.touch(); }, format: (v) => `${v}°`,
  }));
  const targetHue = add(slider('Toward hue', {
    min: 0, max: 359, step: 1, get: () => gen().targetHue, set: (v) => { gen().targetHue = v; manager.touch(); }, format: (v) => `${v}°`,
  }));
  const saturation = add(slider('Saturation', {
    min: 0, max: 2, step: 0.01, get: () => gen().saturation, set: (v) => { gen().saturation = v; manager.touch(); }, format: percent,
  }));
  const value = add(slider('Value', {
    min: 0, max: 1, step: 0.01, get: () => gen().value, set: (v) => { gen().value = v; manager.touch(); }, format: percent,
  }));
  const helperButton = (label, run) => el('button', {
    type: 'button',
    class: 'button small wide',
    onclick: () => {
      const changed = run();
      if (!changed) toast('Nothing changed.');
      engine.requestRender();
    },
  }, label);
  const helpersSection = section('Pass helpers', false,
    hueShift,
    targetHue,
    saturation,
    value,
    helperButton('Generate shadow from lit', () => engine.passes.generateShadow(gen())),
    el('div', { class: 'button-row' },
      helperButton('Copy lit → shadow', () => engine.passes.copyPass('lit', 'shadow', 'Copy lit to shadow')),
      helperButton('Copy shadow → lit', () => engine.passes.copyPass('shadow', 'lit', 'Copy shadow to lit'))),
    helperButton('Reset edge to gray', () => engine.passes.fillPass('edge', 0.5, 0.5, 0.5, 1, 'Reset edge')));

  // Shader ----------------------------------------------------------------------------------------
  const shader = () => project()?.shader ?? DEFAULT_SHADER;
  const shaderSlider = (label, key, min, max, step) => add(slider(label, {
    min,
    max,
    step,
    get: () => shader()[key],
    set: (v) => {
      shader()[key] = v;
      engine.syncShader();
      manager.touch();
    },
    format: (v) => Number(v).toFixed(2),
  }));
  const rimColor = el('input', { type: 'color', 'aria-label': 'Rim color' });
  rimColor.addEventListener('input', () => {
    const v = parseInt(rimColor.value.slice(1), 16);
    shader().rimColor = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    engine.syncShader();
    manager.touch();
  });
  refreshers.push(() => {
    rimColor.value = `#${shader().rimColor.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  });
  const shaderSection = section('Toon shader', false,
    shaderSlider('Threshold', 'threshold', 0, 1, 0.01),
    shaderSlider('Softness', 'softness', 0, 0.5, 0.005),
    shaderSlider('Edge strength', 'edgeStrength', 0, 1, 0.01),
    el('label', { class: 'field field-inline' }, 'Rim color', rimColor),
    shaderSlider('Rim power', 'rimPower', 0.5, 8, 0.1),
    shaderSlider('Rim strength', 'rimStrength', 0, 1, 0.01),
    el('button', {
      type: 'button',
      class: 'button small wide',
      onclick: () => {
        project().shader = { ...DEFAULT_SHADER };
        engine.syncShader();
        manager.touch();
        refresh();
      },
    }, 'Reset to defaults'));

  // Light -----------------------------------------------------------------------------------------
  const azimuth = add(slider('Around', {
    min: 0,
    max: 360,
    step: 1,
    get: () => Math.round(project()?.light.azimuth ?? 0),
    set: (v) => {
      project().light.azimuth = v;
      engine.syncLight();
      manager.touch();
    },
    format: (v) => `${v}°`,
  }));
  const elevation = add(slider('Height', {
    min: -89,
    max: 89,
    step: 1,
    get: () => Math.round(project()?.light.elevation ?? 0),
    set: (v) => {
      project().light.elevation = v;
      engine.syncLight();
      manager.touch();
    },
    format: (v) => `${v}°`,
  }));
  const autoLight = el('input', { type: 'checkbox' });
  autoLight.addEventListener('change', () => { engine.lightAuto = autoLight.checked; });
  refreshers.push(() => { autoLight.checked = engine.lightAuto; });
  const lightSection = section('Preview light', true,
    el('p', { class: 'muted small' }, 'Hold L and drag on the model to swing the light around.'),
    azimuth,
    elevation,
    el('label', { class: 'check-field' }, autoLight, el('span', {}, 'Slowly rotate')));
  engine.on('light', () => {
    azimuth.refresh();
    elevation.refresh();
    manager.touch();
  });

  // UVs -------------------------------------------------------------------------------------------
  const uvOptions = { padding: 8, density: 0 };
  const padding = slider('Padding', {
    min: 1,
    max: 32,
    step: 1,
    get: () => uvOptions.padding,
    set: (v) => { uvOptions.padding = v; },
    format: (v) => `${v} px`,
  });
  const density = slider('Texel density', {
    min: 0,
    max: 2000,
    step: 10,
    get: () => uvOptions.density,
    set: (v) => { uvOptions.density = v; },
    format: (v) => (v === 0 ? 'Fit texture' : `${v}/unit`),
  });
  const dilation = slider('Seam dilation', {
    min: 2,
    max: 16,
    step: 1,
    get: () => settings.dilation,
    set: (v) => {
      saveSettings({ dilation: v });
      const { passes } = engine;
      if (!passes) return;
      passes.dilationSetting = v;
      passes.buildLayout(project().geometry);
    },
    format: (v) => `${v} px at 2048`,
  });
  const showWire = el('input', { type: 'checkbox', checked: true });
  showWire.addEventListener('change', () => {
    engine.uv.showWire = showWire.checked;
    engine.requestRender();
  });
  refreshers.push(() => { showWire.checked = engine.uv.showWire; });
  const uvSection = section('UVs', false,
    padding,
    density,
    el('button', {
      type: 'button',
      class: 'button small wide',
      onclick: () => unwrap({ padding: uvOptions.padding, density: uvOptions.density }),
    }, 'Auto unwrap'),
    dilation,
    el('label', { class: 'check-field' }, showWire, el('span', {}, 'UV wireframe (W)')));

  // Project ---------------------------------------------------------------------------------------
  const resolution = el('select', { 'aria-label': 'Texture resolution' },
    ...RESOLUTIONS.map((res) => el('option', { value: res }, `${res} × ${res}`)));
  resolution.addEventListener('change', async () => {
    const res = Number(resolution.value);
    await busy('Resampling textures…', async () => manager.setResolution(res));
    toast('Resolution changed. Undo history was cleared.');
  });
  refreshers.push(() => {
    if (project()) resolution.value = project().res;
  });
  const projectSection = section('Project', false,
    el('label', { class: 'field' }, 'Texture resolution', resolution));

  host.replaceChildren(
    colorSection, brushSection, fillSection, paletteSection, lightSection, helpersSection, shaderSection, uvSection, projectSection,
  );

  const refresh = () => {
    for (const fn of refreshers) fn();
    const erasing = tool.kind === 'eraser';
    brushHeading.textContent = erasing ? 'Eraser' : BRUSHES.find((b) => b.id === tool.brush).name;
    tipField.hidden = !erasing;
    tipSelect.value = tool.eraser.tip;
    edgeHint.hidden = engine.pass !== 'edge';
    pickerCanvas.closest('.color-section').classList.toggle('edge-mode', engine.pass === 'edge');
  };

  const refreshProject = () => {
    projectRow.render();
    refresh();
  };

  setColor(tool.color);
  renderRecent();
  refresh();
  return {
    refresh, refreshProject, takeImage, setColor,
  };
}

