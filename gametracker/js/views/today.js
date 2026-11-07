// The Today view: everything on your list for one day, with a way to log each result.

import { getBackend } from '../backend.js';
import { CATALOG, SUGGESTED_GAMES, catalogGame } from '../catalog.js';
import { localDateString } from '../dates.js';
import { parseShare } from '../parse.js';
import {
  cleanResult, formatScore, ordinal, parseTime, rankRows,
} from '../scores.js';
import {
  addGame, clearResult, findGame, gameStreak, getResult, isOnList, logResult, myGames, overallStreak,
} from '../store.js';
import {
  el, externalLink, icon, toast,
} from '../ui.js';
import { dateNav, streakBadge } from './common.js';

/** Which game's score editor is open, so a redraw doesn't close it. */
let editing = null;

// Friends' scores are fetched when the view opens and when you come back to it. Logging redraws
// this view a lot, and those redraws reuse what's here.
let friendCache = { date: null, rows: [] };

async function friendRows(date) {
  if (friendCache.date === date) return friendCache.rows;
  const backend = await getBackend();
  if (!backend.isConfigured || !await backend.getAccount()) return [];
  const rows = await backend.friendsDay(date);
  friendCache = { date, rows };
  return rows;
}

/** Fills in how you stand against friends, once that has loaded. Quiet if it can't load. */
async function fillFriendLines(host, date) {
  let rows;
  try {
    rows = await friendRows(date);
  } catch (err) {
    console.warn('Streakle friends:', err);
    return;
  }
  for (const line of host.querySelectorAll('[data-friend-line]')) {
    const game = findGame(line.dataset.friendLine);
    const friends = rows.filter((row) => row.game_id === game.id);
    if (friends.length === 0) continue;
    line.textContent = standing(game, friends, getResult(game.id, date));
    line.hidden = false;
  }
}

/**
 * @param {import('../catalog.js').Game} game
 * @param {object[]} friends
 * @param {object|null} mine
 * @returns {string} one line comparing you and your friends
 */
function standing(game, friends, mine) {
  const count = `${friends.length} friend${friends.length === 1 ? '' : 's'}`;
  if (game.kind === 'done') return `${count} played`;
  const ranked = rankRows(game, friends);
  const top = ranked[0];
  if (!mine) return `${count} played, best ${formatScore(game, top)} (${top.display_name})`;
  const withMe = rankRows(game, [...friends, { ...mine, isMe: true }]);
  const me = withMe.find((row) => row.isMe);
  return `${ordinal(me.rank)} of ${withMe.length} with friends`;
}

/**
 * The controls for typing in a score.
 * @param {import('../catalog.js').Game} game
 * @param {(result: { score: number|null, failed: boolean }) => void} save
 * @param {object|null} current
 * @returns {HTMLElement}
 */
function scoreEditor(game, save, current) {
  if (game.kind === 'guesses' && game.max && game.max <= 12) {
    const choice = (label, result, name) => el('button', {
      type: 'button',
      class: 'choice',
      'aria-label': name,
      onclick: () => save(result),
    }, label);
    return el('div', { class: 'choices', role: 'group', 'aria-label': `${game.name} score` },
      ...Array.from({ length: game.max }, (_, i) => choice(String(i + 1), { score: i + 1, failed: false }, `${i + 1} of ${game.max}`)),
      game.canFail ? choice('X', { score: null, failed: true }, 'Failed') : null);
  }

  const isTime = game.kind === 'time';
  const field = el('input', {
    type: 'text',
    inputMode: isTime ? 'text' : 'numeric',
    placeholder: isTime ? '1:23' : '0',
    'aria-label': isTime ? `${game.name} time` : `${game.name} score`,
    autocomplete: 'off',
    value: current && current.score !== null ? (isTime ? formatScore(game, { score: current.score, failed: false }) : String(current.score)) : '',
  });
  const failedBox = game.canFail ? el('input', { type: 'checkbox', checked: Boolean(current?.failed) }) : null;
  return el('form', {
    class: 'score-form',
    onsubmit: (e) => {
      e.preventDefault();
      const text = field.value.trim();
      const failed = Boolean(failedBox?.checked);
      let score = isTime ? parseTime(text) : (/^\d+$/.test(text) ? Number(text) : null);
      if (text === '' && failed) score = null;
      const clean = (score === null && !failed) ? null : cleanResult(game, { score, failed });
      if (!clean) {
        toast(isTime ? 'Enter a time like 1:23.' : `Enter a whole number${game.max ? ` up to ${game.max}` : ''}.`);
        field.focus();
        return;
      }
      save(clean);
    },
  },
  field,
  failedBox ? el('label', { class: 'check-field' }, failedBox, el('span', {}, 'Failed')) : null,
  el('button', { type: 'submit', class: 'button primary small' }, 'Save'));
}

function gameRow(game, date, redraw) {
  const result = getResult(game.id, date);
  const streak = gameStreak(game.id);
  const isEditing = editing === game.id;
  const isAuto = result?.source === 'auto';

  const save = (value) => {
    editing = null;
    logResult(game.id, date, value);
    redraw(`[data-focus="${game.id}"]`);
  };

  let status;
  if (result) {
    status = el('div', { class: 'status' },
      el('span', { class: result.failed ? 'score failed' : 'score' },
        result.failed ? null : icon('check'),
        formatScore(game, result)),
      isAuto ? el('span', { class: 'muted small' }, `From ${game.name}`) : null,
      !isAuto && game.kind !== 'done' ? el('button', {
        type: 'button',
        class: 'link-button',
        'data-focus': game.id,
        'aria-label': `Change ${game.name} score`,
        onclick: () => {
          editing = isEditing ? null : game.id;
          redraw();
        },
      }, 'Change') : null,
      !isAuto ? el('button', {
        type: 'button',
        class: 'link-button',
        'aria-label': `Clear ${game.name} result`,
        onclick: () => {
          editing = null;
          clearResult(game.id, date);
          redraw(`[data-focus="${game.id}"]`);
        },
      }, 'Clear') : null);
  } else if (game.kind === 'done') {
    status = el('div', { class: 'status' }, el('button', {
      type: 'button',
      class: 'button small',
      'data-focus': game.id,
      onclick: () => save({ score: null, failed: false }),
    }, 'Mark done'));
  } else {
    status = el('div', { class: 'status' }, el('button', {
      type: 'button',
      class: 'button small',
      'data-focus': game.id,
      'aria-expanded': String(isEditing),
      onclick: () => {
        editing = isEditing ? null : game.id;
        redraw();
      },
    }, 'Log score'));
  }

  return el('article', { class: result ? 'game-row done' : 'game-row', 'data-game': game.id },
    el('div', { class: 'game-main' },
      el('div', { class: 'game-title' },
        el('h2', {}, game.name),
        streakBadge(streak.current)),
      game.blurb ? el('p', { class: 'muted small' }, game.blurb) : null,
      el('p', { class: 'friend-line small', 'data-friend-line': game.id, hidden: true })),
    el('div', { class: 'game-actions' },
      status,
      externalLink(game.url, { class: 'button play', 'aria-label': `Play ${game.name}` }, 'Play', icon('external'))),
    isEditing ? el('div', { class: 'game-editor' }, scoreEditor(game, save, result)) : null);
}

function pasteBox(date, redraw) {
  const area = el('textarea', {
    rows: 2,
    placeholder: 'Paste a share result here, like "Wordle 1,234 3/6"',
    'aria-label': 'Paste a share result',
    spellcheck: false,
  });

  const submit = () => {
    const text = area.value;
    if (!text.trim()) return;
    const parsed = parseShare(text);
    if (!parsed) {
      toast('That doesn\'t look like a game we can read yet. Use Log score on the game instead.');
      return;
    }
    const game = catalogGame(parsed.gameId);
    const added = !isOnList(game.id);
    if (added) addGame(game.id);
    logResult(game.id, date, { score: parsed.score, failed: parsed.failed }, 'paste');
    area.value = '';
    toast(`${game.name}: ${formatScore(game, parsed)}${added ? ', and added to your list' : ''}`);
    redraw();
  };

  // A paste is one deliberate action, so it can log straight away if it's recognized.
  area.addEventListener('paste', () => {
    setTimeout(() => {
      if (parseShare(area.value)) submit();
    }, 0);
  });

  return el('form', {
    class: 'paste-box',
    onsubmit: (e) => {
      e.preventDefault();
      submit();
    },
  }, area, el('button', { type: 'submit', class: 'button' }, 'Log'));
}

function suggestions(redraw) {
  const offered = SUGGESTED_GAMES.filter((id) => !isOnList(id)).map(catalogGame);
  if (myGames().length >= 5 || offered.length === 0) return null;
  return el('section', { class: 'suggestions' },
    el('h2', {}, 'Add the games you play'),
    el('div', { class: 'row' },
      ...offered.map((game) => el('button', {
        type: 'button',
        class: 'sticky-button',
        onclick: () => {
          addGame(game.id);
          redraw();
        },
      }, icon('plus'), game.name)),
      el('a', { class: 'link-button', href: '#/games' }, `All ${CATALOG.length} games`)));
}

/**
 * @param {HTMLElement} host
 * @param {{ date: string, setDate: (date: string) => void }} ctx
 */
export function renderToday(host, ctx) {
  friendCache = { date: null, rows: [] };

  const redraw = (focusSelector) => {
    const { date } = ctx;
    const games = myGames();
    const played = games.filter((game) => getResult(game.id, date)).length;
    const overall = overallStreak();
    const today = localDateString();

    // Only worth saying once there's a streak to lose and it's still today.
    const atRisk = date === today && overall.current > 0 && overall.lastDate !== today;

    host.replaceChildren(...[
      el('header', { class: 'view-head' },
        dateNav({
          date,
          onChange: (next) => {
            editing = null;
            ctx.setDate(next);
            redraw();
          },
        }),
        el('div', { class: 'head-stats' },
          el('span', { class: 'progress-text' }, `${played} of ${games.length} done`),
          streakBadge(overall.current))),
      games.length > 0 ? el('div', {
        class: 'progress',
        role: 'progressbar',
        'aria-label': 'Games done',
        'aria-valuemin': '0',
        'aria-valuemax': String(games.length),
        'aria-valuenow': String(played),
      }, el('span', { style: `width:${(played / games.length) * 100}%` })) : null,
      atRisk ? el('p', { class: 'notice' }, `Play anything today to keep your ${overall.current}-day streak going.`) : null,
      pasteBox(date, redraw),
      games.length > 0
        ? el('div', { class: 'game-list' }, ...games.map((game) => gameRow(game, date, redraw)))
        : el('div', { class: 'empty' },
          el('h2', {}, 'Your list is empty'),
          el('p', {}, el('a', { class: 'sticky-button', href: '#/games' }, icon('plus'), 'Choose some games'))),
      suggestions(redraw),
    ].filter(Boolean));

    if (focusSelector) host.querySelector(focusSelector)?.focus();
    fillFriendLines(host, date);
  };

  redraw();
}
