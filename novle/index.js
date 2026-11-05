// Entry point: wires the views to the router and starts the app.

import { startRouter } from './js/router.js';
import { createWriter } from './js/write.js';
import { createMine } from './js/mine.js';
import { createGallery } from './js/gallery.js';
import { challengeNumber, localDateString } from './js/daily.js';
import * as api from './js/api.js';
import { readSetting, writeSetting, onStorageError } from './js/storage.js';
import {
  el, icon, openDialog, toast,
} from './js/ui.js';

onStorageError((message) => toast(message));

// Theme: follows the system until the user picks one.
const themeButton = document.getElementById('theme-toggle');
const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
};
const syncThemeButton = () => {
  themeButton.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
  themeButton.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
};
themeButton.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  writeSetting('theme', next);
  syncThemeButton();
});
syncThemeButton();

const views = {
  write: document.getElementById('view-write'),
  gallery: document.getElementById('view-gallery'),
  mine: document.getElementById('view-mine'),
  rules: document.getElementById('view-rules'),
};

const gallery = createGallery({ api, root: views.gallery });
const writer = createWriter({ onPost: (payload) => gallery.openPostDialog(payload) });
const mine = createMine({ root: views.mine, openInWriter: (record) => writer.openStory(record) });

const VIEW_FOR_ROUTE = {
  write: 'write', today: 'gallery', 'all-time': 'gallery', post: 'gallery', mine: 'mine', rules: 'rules',
};

/** Reveals today's prompt the first time someone reaches the Write tab each day. */
function revealPrompt() {
  const today = localDateString();
  if (!writer.isOnDaily() || readSetting('promptSeen', null) === today) return;
  writeSetting('promptSeen', today);
  const challenge = writer.currentChallenge();
  const title = `Novle #${challengeNumber(today)}`;
  openDialog((close) => [
    el('h2', {}, title),
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'tag' }, challenge.genre),
      el('span', { class: 'tag' }, `${challenge.wordLimit.toLocaleString()} words`),
    ),
    el('p', { class: 'prompt-text' }, challenge.prompt),
    challenge.wrinkle ? el('p', { class: 'prompt-wrinkle' }, el('strong', {}, 'Wrinkle: '), challenge.wrinkle) : null,
    el('p', { class: 'notice' }, 'Take it anywhere you like. There are no wrong answers.'),
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { type: 'button', class: 'button accent', onclick: () => close() }, 'Start writing'),
    ),
  ].filter(Boolean), { label: title, className: 'welcome' }).then(() => writer.focusEditor());
}

function showRoute(route) {
  const active = VIEW_FOR_ROUTE[route.name] ?? 'write';
  for (const [name, node] of Object.entries(views)) node.hidden = name !== active;
  for (const tab of document.querySelectorAll('.tab')) {
    const current = tab.dataset.route === route.name;
    tab.classList.toggle('active', current);
    if (current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  writer.setActive(active === 'write');
  if (route.name === 'write') revealPrompt();
  else if (route.name === 'today') gallery.showToday();
  else if (route.name === 'all-time') gallery.showAllTime();
  else if (route.name === 'post') gallery.showPost(route.params.id);
  else if (route.name === 'mine') mine.show();
  window.scrollTo(0, 0);
}

await writer.ready;
startRouter(showRoute);
