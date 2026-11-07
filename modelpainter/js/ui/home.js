// The project list screen.

import {
  confirmDialog, el, openDialog, toast,
} from '../../../splotchle/js/ui.js';
import { deleteProject, listProjects, saveProject } from '../io/db.js';
import { PROJECT_EXTENSION } from '../core/project.js';

const SAMPLES = [
  { file: 'cube-seams.glb', name: 'Cube with hard seams' },
  { file: 'uv-sphere.glb', name: 'UV sphere' },
  { file: 'character.glb', name: 'Low-poly character' },
];

/**
 * Asks for a project name.
 * @param {string} current
 * @returns {Promise<string|undefined>} the trimmed new name, or undefined if cancelled or blank
 */
export async function askName(current) {
  const name = await openDialog((close) => {
    const field = el('input', { type: 'text', value: current, maxLength: 80 });
    setTimeout(() => field.select(), 0);
    return [
      el('h2', {}, 'Rename project'),
      el('form', {
        onsubmit: (e) => {
          e.preventDefault();
          close(field.value.trim());
        },
      }, field,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Cancel'),
        el('button', { type: 'submit', class: 'button primary' }, 'Rename'))),
    ];
  }, { label: 'Rename project' });
  return name || undefined;
}

/**
 * Renders the project list.
 * @param {HTMLElement} host
 * @param {object} actions
 * @param {(files: File[]) => void} actions.onFiles a model or project file was chosen
 * @param {(id: string) => void} actions.onOpen
 * @param {(file: string, name: string) => void} actions.onSample
 */
export async function renderHome(host, { onFiles, onOpen, onSample }) {
  const input = el('input', {
    type: 'file',
    multiple: true,
    hidden: true,
    accept: `.glb,.gltf,.obj,.bin,.png,.jpg,.jpeg,${PROJECT_EXTENSION}`,
  });
  input.addEventListener('change', () => {
    if (input.files.length > 0) onFiles([...input.files]);
    input.value = '';
  });

  const intro = el('div', { class: 'home-intro' },
    el('h1', {}, 'Paint it twice.'),
    el('p', {}, 'Paint each model once fully lit and once fully in shadow. A toon shader blends the two under real lighting, so your brushwork survives in the game.'),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'button primary', onclick: () => input.click() }, 'Import a model'),
      input),
    el('p', { class: 'muted small' }, `Drop a .glb, .gltf (with its files) or .obj anywhere on this page, or a ${PROJECT_EXTENSION} project.`),
    el('h2', { class: 'home-heading' }, 'Or try a test model'),
    el('div', { class: 'row' }, ...SAMPLES.map(({ file, name }) => el('button', {
      type: 'button', class: 'button small', onclick: () => onSample(file, name),
    }, name))));

  const grid = el('div', { class: 'project-grid' });
  const listSection = el('div', { class: 'home-projects' }, el('h2', { class: 'home-heading' }, 'Your projects'), grid);

  let projects = [];
  try {
    projects = await listProjects();
  } catch {
    toast('Saved projects aren\'t available in this browser mode. You can still paint and save to files.');
  }
  listSection.hidden = projects.length === 0;

  grid.replaceChildren(...projects.map((meta) => {
    const url = meta.thumb ? URL.createObjectURL(meta.thumb) : null;
    const card = el('article', { class: 'project-card' },
      el('button', {
        type: 'button',
        class: 'project-open',
        'aria-label': `Open ${meta.name}`,
        onclick: () => onOpen(meta.id),
      }, url ? el('img', { src: url, alt: '', loading: 'lazy' }) : el('span', { class: 'no-thumb' })),
      el('div', { class: 'project-info' },
        el('div', {},
          el('div', { class: 'project-title' }, meta.name),
          el('div', { class: 'muted small' }, new Date(meta.updatedAt).toLocaleString())),
        el('div', { class: 'row project-actions' },
          el('button', {
            type: 'button',
            class: 'link-button',
            onclick: async () => {
              const name = await askName(meta.name);
              if (!name) return;
              await saveProject({ ...meta, name, data: { ...meta.data, name } });
              renderHome(host, { onFiles, onOpen, onSample });
            },
          }, 'Rename'),
          el('button', {
            type: 'button',
            class: 'link-button',
            onclick: async () => {
              const sure = await confirmDialog({
                title: `Delete ${meta.name}?`,
                body: 'This can\'t be undone. Save it as a project file first if you might want it back.',
                confirm: 'Delete',
                danger: true,
              });
              if (!sure) return;
              await deleteProject(meta.id);
              renderHome(host, { onFiles, onOpen, onSample });
            },
          }, 'Delete'))));
    return card;
  }));

  host.replaceChildren(intro, listSection);
}
