// Entry point: builds the app and wires the screens together.

import {
  confirmDialog, el, openDialog, toast,
} from '../splotchle/js/ui.js';
import {
  Engine, PREVIEWS, PREVIEW_NAMES,
} from './js/core/engine.js';
import { PROJECT_EXTENSION, ProjectManager } from './js/core/project.js';
import { InputController } from './js/input/controller.js';
import { buildPanel } from './js/ui/panel.js';
import { askName, renderHome } from './js/ui/home.js';
import { openSettings } from './js/ui/settingsdialog.js';
import { BRUSHES } from './js/paint/brush.js';
import { PASSES } from './js/paint/passes.js';
import { saveSettings, settings } from './js/core/settings.js';

const $ = (id) => document.getElementById(id);
const SPRITE = new URL('./assets/icons/sprite.svg', import.meta.url).href;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `${SPRITE}#${name}`);
  svg.append(use);
  return svg;
}

/** Saves a blob under a file name through the browser's download flow. */
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const safeName = (name) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project';

// WebGL2 is a hard requirement, so say so plainly rather than failing somewhere deep.
function supported() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function start() {
  const engine = new Engine($('gl'));
  const manager = new ProjectManager(engine);
  window.splotch3d = { engine, manager }; // handy from the console, and used by the end-to-end tests

  // Busy overlay ------------------------------------------------------------------------------------
  let busyDepth = 0;
  const busy = async (label, work) => {
    busyDepth++;
    $('busy-text').textContent = label;
    $('busy').hidden = false;
    // Give the overlay a chance to paint before any blocking work.
    await new Promise((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); });
    try {
      return await work();
    } finally {
      busyDepth--;
      if (busyDepth === 0) $('busy').hidden = true;
    }
  };

  // Tool rail ---------------------------------------------------------------------------------------
  const TOOL_BUTTONS = [
    ...BRUSHES.map((brush) => ({
      id: brush.id,
      icon: { pencil: 'pencil', pen: 'pen', marker: 'marker', paint: 'brush' }[brush.id],
      label: brush.name,
      key: { pencil: 'N', pen: 'P', marker: 'M', paint: 'B' }[brush.id],
      run: () => selectBrush(brush.id),
      active: () => engine.tool.kind === 'brush' && engine.tool.brush === brush.id,
    })),
    {
      id: 'eraser',
      icon: 'eraser',
      label: 'Eraser',
      key: 'E',
      run: () => setKind('eraser'),
      active: () => engine.tool.kind === 'eraser',
    },
    {
      id: 'fill',
      icon: 'fill',
      label: 'Fill bucket',
      key: 'G',
      run: () => setKind('fill'),
      active: () => engine.tool.kind === 'fill',
    },
    {
      id: 'eyedropper',
      icon: 'eyedropper',
      label: 'Eyedropper',
      key: 'I, or hold Alt',
      run: () => setKind('eyedropper'),
      active: () => engine.tool.kind === 'eyedropper',
    },
  ];
  const toolButtons = TOOL_BUTTONS.map((tool) => {
    const button = el('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': `${tool.label} (${tool.key})`,
      title: `${tool.label} (${tool.key})`,
      onclick: tool.run,
    }, icon(tool.icon));
    return { tool, button };
  });
  const undoButton = el('button', {
    type: 'button', class: 'icon-button', 'aria-label': 'Undo (Ctrl+Z)', title: 'Undo (Ctrl+Z)', onclick: () => engine.undo(),
  }, icon('undo'));
  const redoButton = el('button', {
    type: 'button', class: 'icon-button', 'aria-label': 'Redo (Ctrl+Shift+Z)', title: 'Redo (Ctrl+Shift+Z)', onclick: () => engine.redo(),
  }, icon('redo'));
  $('rail').append(
    ...toolButtons.slice(0, 5).map((t) => t.button),
    el('hr'),
    ...toolButtons.slice(5).map((t) => t.button),
    el('hr'),
    undoButton,
    redoButton,
  );

  function selectBrush(id) {
    engine.tool.brush = id;
    engine.tool.kind = 'brush';
    syncTools();
  }

  function setKind(kind) {
    engine.tool.kind = kind;
    syncTools();
  }

  function syncTools() {
    for (const { tool, button } of toolButtons) {
      button.setAttribute('aria-pressed', String(tool.active()));
    }
    panel.refresh();
    input.refreshCursor();
    updateHint();
  }

  // Pass tabs ---------------------------------------------------------------------------------------
  const PASS_NAMES = { lit: 'Lit', shadow: 'Shadow', edge: 'Edge' };
  const passTabs = PASSES.map((pass, i) => {
    const tab = el('button', {
      type: 'button',
      class: 'pass-tab',
      role: 'tab',
      'data-pass': pass,
      title: `${PASS_NAMES[pass]} pass (${i + 1})`,
      onclick: () => engine.setPass(pass),
    }, PASS_NAMES[pass], el('kbd', {}, String(i + 1)));
    return tab;
  });
  $('pass-tabs').append(...passTabs);
  // Edge is grayscale, so it remembers its own color and gives yours back when you leave it.
  const remembered = { color: engine.tool.color, edge: '#ffffff' };
  let lastPass = engine.pass;
  const syncPass = () => {
    for (const tab of passTabs) tab.setAttribute('aria-selected', String(tab.dataset.pass === engine.pass));
    if (engine.pass !== lastPass) {
      if (engine.pass === 'edge') {
        remembered.color = engine.tool.color;
        panel.setColor(remembered.edge);
      } else if (lastPass === 'edge') {
        remembered.edge = engine.tool.color;
        panel.setColor(remembered.color);
      }
      lastPass = engine.pass;
    }
    panel.refresh();
    updateHint();
  };

  // Top bar -----------------------------------------------------------------------------------------
  const previewSelect = $('preview-select');
  previewSelect.append(...PREVIEWS.map((p) => el('option', { value: p }, PREVIEW_NAMES[p])));
  previewSelect.addEventListener('change', () => {
    engine.setPreview(previewSelect.value);
    previewSelect.blur();
  });
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  for (const button of viewButtons) button.addEventListener('click', () => engine.setViewMode(button.dataset.view));
  const syncView = () => {
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === engine.viewMode));
    $('split-line').hidden = engine.viewMode !== 'split';
    updateHint();
  };

  const hints = {
    brush: 'Left-drag paints. Right-hold flies (WASD). Middle-drag orbits the point under the cursor. Scroll zooms.',
    eraser: 'Erases with the selected brush tip. On Edge it goes back to neutral gray.',
    fill: 'Click to fill. Mode is in the panel: island, connected color or the whole pass.',
    eyedropper: 'Click to sample a color. Hold Alt with any brush for the same thing.',
  };
  function updateHint() {
    const tip = engine.viewMode === 'uv'
      ? 'Drag paints the texture directly. Middle-drag pans, scroll zooms, W toggles the wireframe, F fits.'
      : hints[engine.tool.kind];
    $('hint').textContent = tip;
  }

  // Saved state -------------------------------------------------------------------------------------
  const saveState = $('save-state');
  manager.onSaved = () => {
    saveState.textContent = 'Saved';
  };
  manager.onError = (error) => {
    saveState.textContent = 'Not saved';
    console.error(error);
    toast('Autosave failed. Your work is still here, but use Save & export to keep a copy.');
  };
  engine.on('painted', () => {
    saveState.textContent = 'Saving…';
    // Any paint makes the original materials out of date for a rebake.
    if (engine.project) engine.project.pristine = false;
  });

  // Screens -----------------------------------------------------------------------------------------
  const showWorkspace = () => {
    $('home').hidden = true;
    $('workspace').hidden = false;
    $('project-bar').hidden = false;
    $('project-name').hidden = false;
    $('save-state').hidden = false;
    $('project-name').textContent = engine.project.name;
    saveState.textContent = 'Saved';
    engine.resize();
    engine.frame();
    panel.refreshProject();
    syncPass();
    syncView();
    syncHistory();
    $('gl').focus({ preventScroll: true });
  };

  const showHome = async () => {
    await manager.close();
    $('workspace').hidden = true;
    $('home').hidden = false;
    $('project-bar').hidden = true;
    $('project-name').hidden = true;
    $('save-state').hidden = true;
    await refreshHome();
  };

  const refreshHome = () => renderHome($('home'), {
    onFiles: handleFiles,
    onOpen: openProject,
    onSample: (file, name) => {
      guard(`Loading ${name}…`, async () => {
        const result = await manager.createFromUrl(new URL(`./test-assets/${file}`, import.meta.url).href, name);
        afterImport(result);
      });
    },
  });

  /** Runs a job behind the busy overlay, showing any failure instead of swallowing it. */
  const guard = (label, work) => busy(label, work).catch((error) => {
    console.error(error);
    toast(error.message || 'Something went wrong.');
  });

  const openProject = (id) => guard('Opening…', async () => {
    await manager.openSaved(id);
    showWorkspace();
  });

  /** After importing, either the UVs are fine, or the model needs an unwrap. */
  const afterImport = async ({ analysis, needsUnwrap }) => {
    showWorkspace();
    if (!needsUnwrap) return;
    if (analysis.empty) {
      toast('This model has no UVs, so it\'s being unwrapped.');
      await runUnwrap({ padding: 8, density: 0 }, true);
      return;
    }
    const problem = analysis.outside >= 0.01
      ? 'Some of its UVs fall outside the texture.'
      : 'Some of its UVs overlap, so painting one spot would paint another too.';
    const yes = await confirmDialog({
      title: 'Unwrap this model?',
      body: `${problem} Unwrapping makes a clean layout. You can undo it, or run it later from the UVs section.`,
      confirm: 'Unwrap now',
      cancel: 'Keep its UVs',
    });
    if (yes) await runUnwrap({ padding: 8, density: 0 }, true);
  };

  const handleFiles = (files) => {
    const list = [...files];
    const projectFile = list.find((f) => f.name.toLowerCase().endsWith(PROJECT_EXTENSION));
    if (projectFile) {
      guard('Opening project file…', async () => {
        await manager.saveNow();
        await manager.openFile(projectFile);
        showWorkspace();
      });
      return;
    }
    const modelFile = list.some((f) => /\.(glb|gltf|obj)$/i.test(f.name));
    if (!modelFile) {
      // A lone image while painting is a reference for the palette grabber.
      const image = list.find((f) => f.type.startsWith('image/'));
      if (image && engine.project) {
        panel.takeImage(image);
        return;
      }
      toast('Drop a .glb, .gltf or .obj model.');
      return;
    }
    guard('Importing…', async () => {
      await manager.saveNow();
      const result = await manager.createFromFiles(list);
      afterImport(result);
    });
  };

  const runUnwrap = async (options, skipConfirm = false) => {
    if (!skipConfirm && !engine.project.pristine) {
      const yes = await confirmDialog({
        title: 'Unwrap and move the paint?',
        body: 'Your paint gets carried over to the new layout, and some detail may soften. You can undo this.',
        confirm: 'Unwrap',
      });
      if (!yes) return;
    }
    await guard('Unwrapping…', async () => {
      await manager.unwrap({
        ...options,
        onProgress: (mode, percent) => {
          $('busy-text').textContent = `Unwrapping… ${Math.round(percent)}%`;
        },
      });
      toast('Unwrapped. Undo brings the old layout back.');
    });
  };

  // Panel -------------------------------------------------------------------------------------------
  const panel = buildPanel($('panel'), {
    engine, manager, busy, unwrap: runUnwrap,
  });

  // Input ---------------------------------------------------------------------------------------------
  const input = new InputController(engine, {
    brushCircle: $('brush-circle'),
    onPick: (color) => panel.setColor(color),
    onToolChange: () => panel.refresh(),
    onAction: (action) => {
      switch (action) {
        case 'brushPencil': selectBrush('pencil'); break;
        case 'brushPen': selectBrush('pen'); break;
        case 'brushMarker': selectBrush('marker'); break;
        case 'brushPaint': selectBrush('paint'); break;
        case 'toolEraser': setKind('eraser'); break;
        case 'toolFill': setKind('fill'); break;
        case 'toolEyedropper': setKind('eyedropper'); break;
        default: break;
      }
    },
  });

  engine.on('pass', syncPass);
  engine.on('view', syncView);
  engine.on('preview', () => {
    previewSelect.value = engine.preview;
    toast(`Preview: ${PREVIEW_NAMES[engine.preview]}`);
  });
  const syncHistory = () => {
    undoButton.disabled = !engine.history.canUndo;
    redoButton.disabled = !engine.history.canRedo;
  };
  engine.on('history', syncHistory);

  // Project name, export, settings ----------------------------------------------------------------------
  $('go-home').addEventListener('click', () => {
    if (engine.project) guard('Saving…', showHome);
  });
  $('project-name').addEventListener('click', async () => {
    const name = await askName(engine.project.name);
    if (!name) return;
    engine.project.name = name;
    $('project-name').textContent = name;
    manager.touch();
  });

  $('export-btn').addEventListener('click', () => {
    const name = () => safeName(engine.project.name);
    const choice = (title, description, run) => (close) => el('button', {
      type: 'button',
      class: 'choice',
      onclick: () => {
        close();
        guard(`${title}…`, run);
      },
    }, el('strong', {}, title), el('span', { class: 'muted small' }, description));
    openDialog((close) => [
      el('h2', {}, 'Save & export'),
      el('div', { class: 'choices' },
        choice('Save project file', `A ${PROJECT_EXTENSION} file with the mesh, all three passes and the palette.`, async () => {
          download(await manager.projectFile(), `${name()}${PROJECT_EXTENSION}`);
        })(close),
        choice('Export GLB for the game', 'Lit as the base color, plus shadow, edge and shader settings in the WSCHELL_toon_paint extension.', async () => {
          download(await manager.exportGlb(), `${name()}.glb`);
        })(close),
        ...PASSES.map((pass) => choice(`Export ${PASS_NAMES[pass]} PNG`, `Just the ${PASS_NAMES[pass].toLowerCase()} pass as an image.`, async () => {
          download(await manager.exportPng(pass), `${name()}-${pass}.png`);
        })(close))),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Close')),
    ], { label: 'Save and export' });
  });

  $('settings-btn').append(icon('sliders'));
  $('settings-btn').addEventListener('click', () => openSettings());

  // Theme -----------------------------------------------------------------------------------------------
  const isDark = () => (document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches);
  const syncTheme = () => {
    $('theme-toggle').replaceChildren(icon(isDark() ? 'sun' : 'moon'));
    const color = getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim();
    engine.background.set(color || '#555');
    engine.requestRender();
  };
  $('theme-toggle').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    saveSettings({ theme: next });
    syncTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
  syncTheme();

  // A clicked button keeps focus, which would make Space press it again and leave hotkeys hitting it.
  // Only pointer clicks hand focus back, so keyboard users stay where they are.
  for (const host of [$('panel'), $('rail')]) {
    host.addEventListener('click', (e) => {
      if (e.detail > 0 && e.target.closest('button') && !e.target.closest('.palette-drop')) $('gl').focus({ preventScroll: true });
    });
  }

  // The GPU can drop the context, on driver resets for example. The last autosave is safe in storage.
  $('gl').addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    toast('The graphics driver reset. Reload the page to pick up from your last autosave.');
  });

  // Panel sheet on phones -----------------------------------------------------------------------------------
  $('panel-toggle').addEventListener('click', () => {
    const open = $('panel').classList.toggle('open');
    $('panel-toggle').setAttribute('aria-expanded', String(open));
  });

  // Drag and drop, and paste -------------------------------------------------------------------------------
  let dragDepth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth++;
    $('drop-veil').hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('drop-veil').hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    $('drop-veil').hidden = true;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    if (!engine.project) return;
    const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (image) panel.takeImage(image);
  });

  // Reading settings once here keeps the theme hook honest at first load.
  if (settings.theme !== 'auto') document.documentElement.dataset.theme = settings.theme;
  syncTools();
  refreshHome();
}

if (supported()) {
  start();
} else {
  $('home').replaceChildren(el('div', { class: 'home-intro' },
    el('h1', {}, 'This browser can\'t run the painter.'),
    el('p', {}, 'Splotchle 3D needs WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.')));
}
