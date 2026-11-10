// Games: every game being planned, and starting a new one.

import { LIMITS, progressOf } from '../model.js';
import {
  createProject, currentProject, deleteProject, openProject, projects, renameProject,
} from '../store.js';
import {
  confirmDialog, el, icon, iconButton, openDialog, redrawKeepingFocus, toast,
} from '../ui.js';

function edited(time) {
  if (!time) return 'not edited yet';
  return `edited ${new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * @param {HTMLElement} host
 * @param {{ chrome: () => void }} ctx
 */
export function renderGames(host, ctx) {
  const draw = (focus) => redrawKeepingFocus(host, build, focus);

  async function rename(project) {
    const input = el('input', {
      type: 'text', value: project.name, maxLength: LIMITS.name, required: true, autocomplete: 'off',
    });
    const name = await openDialog((close) => [
      el('h2', {}, 'Rename'),
      el('form', {
        class: 'stack',
        onsubmit: (e) => {
          e.preventDefault();
          close(input.value);
        },
      },
      el('label', { class: 'field' }, 'Name', input),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'button', onclick: () => close(undefined) }, 'Cancel'),
        el('button', { type: 'submit', class: 'button primary' }, 'Save'))),
    ], { label: `Rename ${project.name}` });
    if (name === undefined) return;
    const error = renameProject(project.id, name);
    if (error) toast(error);
    ctx.chrome();
    draw(`rename:${project.id}`);
  }

  async function remove(project) {
    const ok = await confirmDialog({
      title: `Delete ${project.name}?`,
      body: 'Its design doc and every to-do go with it, and this can\'t be undone. Save a backup from Export first if you might want it back.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteProject(project.id);
    ctx.chrome();
    draw('new-name');
    toast(`Deleted ${project.name}.`);
  }

  function gameItem(project, isOpen) {
    const { done, total } = progressOf(project.cards);
    return el('li', { class: isOpen ? 'game-card current' : 'game-card' },
      el('div', { class: 'game-info' },
        el('h2', {}, project.name, isOpen ? el('span', { class: 'tag' }, 'open') : null),
        el('p', { class: 'muted small' }, `${project.meta.stage} · ${total ? `${done} of ${total} to-dos done` : 'no to-dos yet'} · ${edited(project.updatedAt)}`),
        project.meta.pitch.trim() ? el('p', { class: 'game-pitch' }, project.meta.pitch.trim()) : null),
      el('div', { class: 'game-actions' },
        isOpen
          ? el('a', { class: 'button small', href: '#/gdd' }, 'Go to GDD')
          : el('button', {
            type: 'button',
            class: 'button small primary',
            onclick: () => {
              openProject(project.id);
              ctx.chrome();
              window.location.hash = '#/gdd';
            },
          }, 'Open'),
        iconButton('pencil', `Rename ${project.name}`, () => rename(project), { 'data-focus': `rename:${project.id}` }),
        iconButton('trash', `Delete ${project.name}`, () => remove(project))));
  }

  function newGame() {
    const name = el('input', {
      type: 'text', maxLength: LIMITS.name, placeholder: 'Working title', autocomplete: 'off', 'data-focus': 'new-name',
    });
    return el('section', { class: 'card' },
      el('h2', {}, 'Start a new game'),
      el('p', { class: 'muted small' }, 'It gets its own design doc, filled with the usual sections, and its own to-do board.'),
      el('form', {
        class: 'new-game',
        onsubmit: (e) => {
          e.preventDefault();
          const made = createProject(name.value);
          if (typeof made === 'string') {
            toast(made);
            name.focus();
            return;
          }
          ctx.chrome();
          toast(`Started ${made.name}.`);
          window.location.hash = '#/gdd';
        },
      },
      el('label', { class: 'field' }, 'Name', name),
      el('button', { type: 'submit', class: 'sticky-button' }, icon('plus'), 'New game')));
  }

  function build() {
    const open = currentProject();
    return [
      el('section', { class: 'card' },
        el('h1', {}, 'Your games'),
        el('ul', { class: 'game-list' }, ...projects().map((p) => gameItem(p, p.id === open.id)))),
      newGame(),
    ];
  }

  draw();
}
