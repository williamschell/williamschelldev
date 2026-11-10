// Entry point: routes, theme, and the top bar.

import { startRouter } from './js/router.js';
import {
  currentProject, initStore, onExternalChange, onStorageError, writeSetting,
} from './js/store.js';
import { icon, toast } from './js/ui.js';
import { renderBoard } from './js/views/board.js';
import { renderExport } from './js/views/export.js';
import { renderGames } from './js/views/games.js';
import { renderGdd } from './js/views/gdd.js';

const VIEWS = {
  gdd: renderGdd,
  todos: renderBoard,
  export: renderExport,
  games: renderGames,
};

const TITLES = {
  gdd: 'Design doc', todos: 'To-dos', export: 'Export', games: 'Games',
};

const host = document.getElementById('view');
let currentRoute = { name: 'gdd', params: {} };

/** The tabs, the open game's name and the page title. */
function drawChrome() {
  const { name } = currentProject();
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.route === currentRoute.name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  const link = document.getElementById('project-link');
  document.getElementById('project-label').textContent = name;
  link.setAttribute('aria-label', `Open game: ${name}. Switch games`);
  if (currentRoute.name === 'games') link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
  document.title = `${TITLES[currentRoute.name]} · ${name} · Game Planner`;
}

function render() {
  document.body.dataset.view = currentRoute.name;
  drawChrome();
  VIEWS[currentRoute.name](host, { params: currentRoute.params, chrome: drawChrome });
}

function setupTheme() {
  const button = document.getElementById('theme-toggle');
  const isDark = () => {
    const theme = document.documentElement.dataset.theme;
    if (theme) return theme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const draw = () => button.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
  button.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeSetting('theme', next);
    draw();
  });
  draw();
}

function start() {
  onStorageError((message) => toast(message));
  setupTheme();
  initStore();
  // Another tab saved. Redraw, unless someone is typing here.
  onExternalChange(() => {
    const active = document.activeElement;
    const typing = host.contains(active) && active.matches('input[type=text], textarea');
    if (typing || document.querySelector('dialog[open]')) drawChrome();
    else render();
  });
  startRouter((route) => {
    const changed = route.name !== currentRoute.name;
    currentRoute = route;
    render();
    if (changed) window.scrollTo(0, 0);
  });
}

start();
