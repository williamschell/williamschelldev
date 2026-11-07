// Entry point: routes, theme, and refreshing on focus and at midnight.

import { isDemo } from './js/backend.js';
import { BACKEND_CONFIGURED } from './js/config.js';
import { localDateString } from './js/dates.js';
import { startRouter } from './js/router.js';
import {
  collectAutoResults, initStore, onRemoteChange, onStorageError, readSetting, syncNow, writeSetting,
} from './js/store.js';
import { icon, toast } from './js/ui.js';
import { renderAccount } from './js/views/account.js';
import { renderCompare } from './js/views/compare.js';
import { renderFriends } from './js/views/friends.js';
import { renderGames } from './js/views/games.js';
import { renderStreaks } from './js/views/streaks.js';
import { renderToday } from './js/views/today.js';

const VIEWS = {
  today: renderToday,
  compare: renderCompare,
  streaks: renderStreaks,
  friends: renderFriends,
  games: renderGames,
  account: renderAccount,
};

const TITLES = {
  today: 'Today', compare: 'Compare', streaks: 'Streaks', friends: 'Friends', games: 'Games', account: 'Account',
};

/** The top bar says who's signed in, from what this browser remembers, without a request. */
function drawAccountLink() {
  const link = document.getElementById('account-link');
  link.hidden = !(isDemo || BACKEND_CONFIGURED);
  const username = readSetting('account', null)?.username;
  document.getElementById('account-label').textContent = typeof username === 'string' ? username : 'Sign in';
  link.setAttribute('aria-label', typeof username === 'string' ? `Account, signed in as ${username}` : 'Sign in');
  if (currentRoute.name === 'account') link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
}

const host = document.getElementById('view');

let currentRoute = { name: 'today', params: {} };
let renderId = 0;
// The day being looked at, shared by Today and Compare. Follows the clock unless changed.
let selectedDate = localDateString();
let lastSeenToday = selectedDate;

function render() {
  renderId += 1;
  const id = renderId;
  const { name, params } = currentRoute;
  const ctx = {
    get date() { return selectedDate; },
    setDate: (date) => { selectedDate = date; },
    params,
    isCurrent: () => id === renderId,
  };
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.route === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = `${TITLES[name]} · Streakle`;
  drawAccountLink();
  VIEWS[name](host, ctx);
}

/** Redraws views that show results, unless someone is partway through typing. */
function redrawIfSafe() {
  drawAccountLink();
  // The form-heavy views would lose what's been typed, so they only redraw on navigation.
  if (['today', 'streaks', 'games'].includes(currentRoute.name)) {
    const typing = [...host.querySelectorAll('textarea, input[type=text], input[type=url]')].some((field) => field.value !== '' && field.value !== field.defaultValue);
    if (!typing && !host.querySelector('.game-editor')) render();
  }
}

/** Coming back from a game's tab is the main moment anything here changes. */
function refresh() {
  const today = localDateString();
  // Someone looking at the day that just ended moves on to the new one.
  if (today !== lastSeenToday) {
    if (selectedDate === lastSeenToday) selectedDate = today;
    lastSeenToday = today;
  }
  collectAutoResults();
  redrawIfSafe();
  syncNow({ pull: true });
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

async function start() {
  onStorageError((message) => toast(message));
  // Another device's changes, or finding out this browser was signed out elsewhere.
  onRemoteChange(redrawIfSafe);
  setupTheme();
  document.getElementById('demo-banner').hidden = !isDemo;
  await initStore();
  collectAutoResults();
  startRouter((route) => {
    // A tab called Today should show today, even after stepping back through older days.
    if (route.name === 'today' && currentRoute.name !== 'today') selectedDate = localDateString();
    currentRoute = route;
    render();
  });
  syncNow({ pull: true, force: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', () => syncNow());
  // Lets the page roll over at midnight if it's left open and visible.
  setInterval(() => {
    if (localDateString() !== lastSeenToday) refresh();
  }, 60000);
}

start();
