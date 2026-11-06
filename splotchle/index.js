// Entry point: wires the views to the router and starts the app.

import { generateBlob, PRESETS } from './js/blob.js';
import { startRouter } from './js/router.js';
import { createStudio } from './js/studio.js';
import { createMine } from './js/mine.js';
import { createGallery } from './js/gallery.js';
import * as api from './js/api.js';
import { readSetting, writeSetting, onStorageError } from './js/storage.js';
import {
  el, icon, openDialog, toast,
} from './js/ui.js';

onStorageError((message) => toast(message));

// The logo is a blob too, generated the same way as every other one. The seed keeps the
// game's original name so the logo's shape doesn't change.
document.querySelector('#logo path').setAttribute(
  'd',
  generateBlob({ seed: 'splotchio-logo', params: PRESETS.weird }).pathData,
);

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
  draw: document.getElementById('view-draw'),
  gallery: document.getElementById('view-gallery'),
  mine: document.getElementById('view-mine'),
  rules: document.getElementById('view-rules'),
};

const gallery = createGallery({
  api,
  root: views.gallery,
  openFreePlay: () => studio.openFreePlay(),
});
const studio = createStudio({ onPost: (payload) => gallery.openPostDialog(payload) });
const mine = createMine({ root: views.mine, openInStudio: (record) => studio.openArtwork(record) });

const VIEW_FOR_ROUTE = {
  draw: 'draw', today: 'gallery', 'all-time': 'gallery', unlimiteds: 'gallery', post: 'gallery', mine: 'mine', rules: 'rules',
};

function showRoute(route) {
  const active = VIEW_FOR_ROUTE[route.name] ?? 'draw';
  for (const [name, node] of Object.entries(views)) node.hidden = name !== active;
  for (const tab of document.querySelectorAll('.tab')) {
    const current = tab.dataset.route === route.name;
    tab.classList.toggle('active', current);
    if (current) {
      tab.setAttribute('aria-current', 'page');
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      tab.removeAttribute('aria-current');
    }
  }
  studio.setActive(active === 'draw');
  if (route.name === 'today') gallery.showToday();
  else if (route.name === 'all-time') gallery.showAllTime();
  else if (route.name === 'unlimiteds') gallery.showUnlimiteds();
  else if (route.name === 'post') gallery.showPost(route.params.id);
  else if (route.name === 'mine') mine.show();
  window.scrollTo(0, 0);
}

await studio.ready;
startRouter(showRoute);

// Shown on every open, on purpose.
openDialog((close) => [
  el('h2', {}, 'What do you see?'),
  el('p', {}, "Look at the blob and draw whatever comes to mind. There are no wrong answers."),
  el(
    'div',
    { class: 'dialog-actions' },
    el('button', { type: 'button', class: 'button accent', onclick: () => close() }, 'Got it'),
  ),
], { label: 'What do you see?', className: 'welcome' });
