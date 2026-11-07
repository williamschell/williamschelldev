// The Games view: your list, everything you can add to it, custom games and backups.

import { CATALOG, KINDS } from '../catalog.js';
import {
  addCustomGame, addGame, customGames, isOnList, makeBackup, moveGame, myGames, removeGame, restoreBackup,
} from '../store.js';
import {
  el, externalLink, icon, toast,
} from '../ui.js';
import { localDateString } from '../dates.js';

function myListSection(redraw) {
  const games = myGames();
  return el('section', { class: 'card' },
    el('h1', {}, 'Your games'),
    games.length === 0
      ? el('p', { class: 'muted' }, 'Nothing here yet. Add some from below.')
      : el('ul', { class: 'manage-list' }, ...games.map((game, i) => el('li', { 'data-game': game.id },
        el('span', { class: 'manage-name' }, game.name),
        el('div', { class: 'manage-actions' },
          el('button', {
            type: 'button',
            class: 'icon-button',
            'aria-label': `Move ${game.name} up`,
            disabled: i === 0,
            onclick: () => {
              moveGame(game.id, -1);
              redraw();
            },
          }, icon('up')),
          el('button', {
            type: 'button',
            class: 'icon-button',
            'aria-label': `Move ${game.name} down`,
            disabled: i === games.length - 1,
            onclick: () => {
              moveGame(game.id, 1);
              redraw();
            },
          }, icon('down')),
          el('button', {
            type: 'button',
            class: 'icon-button',
            'aria-label': `Remove ${game.name} from your list`,
            onclick: () => {
              removeGame(game.id);
              redraw();
              toast(`${game.name} removed. Its history is kept.`, {
                action: 'Undo',
                onAction: () => {
                  addGame(game.id);
                  redraw();
                },
              });
            },
          }, icon('trash')))))));
}

function addSection(redraw) {
  const available = [...CATALOG, ...customGames()].filter((game) => !isOnList(game.id));
  return el('section', { class: 'card' },
    el('h2', {}, 'Add a game'),
    available.length === 0
      ? el('p', { class: 'muted' }, 'You\'ve added all of them.')
      : el('ul', { class: 'manage-list' }, ...available.map((game) => el('li', { 'data-game': game.id },
        el('div', { class: 'manage-name' },
          externalLink(game.url, {}, game.name),
          game.blurb ? el('p', { class: 'muted small' }, game.blurb) : null),
        el('button', {
          type: 'button',
          class: 'button small',
          'aria-label': `Add ${game.name}`,
          onclick: () => {
            addGame(game.id);
            redraw();
          },
        }, icon('plus'), 'Add')))));
}

function customSection(redraw) {
  const name = el('input', { type: 'text', maxLength: 40, autocomplete: 'off' });
  const url = el('input', { type: 'url', placeholder: 'https://', autocomplete: 'off' });
  const kind = el('select', {}, ...KINDS.map((k) => el('option', { value: k.id }, k.label)));
  const max = el('input', {
    type: 'number', min: 1, max: 50, value: 6,
  });
  const maxField = el('label', { class: 'field' }, 'Guess limit', max);
  kind.addEventListener('change', () => {
    maxField.hidden = kind.value !== 'guesses';
  });

  return el('section', { class: 'card' },
    el('h2', {}, 'Add your own'),
    el('p', { class: 'muted small' }, 'Anyone who adds a game with exactly the same name shares its board with you.'),
    el('form', {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        const error = addCustomGame({
          name: name.value, url: url.value, kind: kind.value, max: max.value,
        });
        if (error) {
          toast(error);
          return;
        }
        toast(`${name.value.trim()} added.`);
        redraw();
      },
    },
    el('label', { class: 'field' }, 'Name', name),
    el('label', { class: 'field' }, 'Link', url),
    el('label', { class: 'field' }, 'How it\'s scored', kind),
    maxField,
    el('button', { type: 'submit', class: 'button primary' }, 'Add game')));
}

function backupSection(redraw) {
  const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', async () => {
    const [file] = input.files;
    input.value = '';
    if (!file) return;
    try {
      const outcome = restoreBackup(JSON.parse(await file.text()));
      if ('error' in outcome) {
        toast(outcome.error);
      } else {
        toast(`Restored ${outcome.added} result${outcome.added === 1 ? '' : 's'}.`);
        redraw();
      }
    } catch {
      toast('That isn\'t a Streakle backup file.');
    }
  });

  return el('section', { class: 'card' },
    el('h2', {}, 'Backup'),
    el('p', { class: 'muted small' }, 'Your history lives in this browser. Save a file to keep it safe or move it to another device. Restoring keeps anything already here.'),
    el('div', { class: 'row' },
      el('button', {
        type: 'button',
        class: 'button small',
        onclick: () => {
          const blob = new Blob([JSON.stringify(makeBackup(), null, 2)], { type: 'application/json' });
          const link = el('a', {
            href: URL.createObjectURL(blob),
            download: `streakle-backup-${localDateString()}.json`,
          });
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        },
      }, 'Save a backup'),
      el('button', { type: 'button', class: 'button small', onclick: () => input.click() }, 'Restore'),
      input));
}

/** @param {HTMLElement} host */
export function renderGames(host) {
  const redraw = () => {
    host.replaceChildren(
      myListSection(redraw),
      addSection(redraw),
      customSection(redraw),
      backupSection(redraw),
    );
  };
  redraw();
}
