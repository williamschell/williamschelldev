// The Compare view: a ranked board for one game on one day.

import { friendlyError, getBackend } from '../backend.js';
import { CATALOG } from '../catalog.js';
import { formatScore, lowerIsBetter } from '../scores.js';
import {
  findGame, myGames, readSetting, syncNow, writeSetting,
} from '../store.js';
import { el, segmented } from '../ui.js';
import { dateNav, notSetUp, streakBadge } from './common.js';

/**
 * @param {HTMLElement} host
 * @param {{ date: string, setDate: (date: string) => void, params: Record<string, string>, isCurrent: () => boolean }} ctx
 */
export async function renderCompare(host, ctx) {
  const backend = await getBackend();
  if (!ctx.isCurrent()) return;
  if (!backend.isConfigured) {
    host.replaceChildren(notSetUp());
    return;
  }

  const games = myGames();
  const requested = ctx.params.game ? findGame(ctx.params.game) : null;
  let game = requested ?? findGame(readSetting('compareGame', '')) ?? games[0] ?? CATALOG[0];
  let scope = readSetting('compareScope', 'friends');
  let account = null;
  try {
    account = await backend.getAccount();
  } catch (err) {
    console.warn('Streakle account:', err);
  }
  if (!ctx.isCurrent()) return;

  // Someone who isn't signed in has no friends to see, but can still read Everyone.
  if (!account) scope = 'everyone';

  const boardHost = el('div', { class: 'board' });
  let requestId = 0;

  const loadBoard = async () => {
    requestId += 1;
    const id = requestId;
    boardHost.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    let rows;
    try {
      await syncNow();
      rows = await backend.gameBoard({
        game, date: ctx.date, scope, lower: lowerIsBetter(game),
      });
    } catch (err) {
      console.warn('Streakle board:', err);
      if (id === requestId) boardHost.replaceChildren(el('p', { class: 'notice' }, friendlyError(err)));
      return;
    }
    if (id !== requestId || !ctx.isCurrent()) return;

    if (rows.length === 0) {
      boardHost.replaceChildren(el('div', { class: 'empty' },
        el('p', {}, scope === 'friends'
          ? `Nobody on your friends list has logged ${game.name} for this day yet.`
          : `Nobody has logged ${game.name} for this day yet.`),
        scope === 'friends' ? el('a', { class: 'button', href: '#/friends' }, 'Add friends') : null));
      return;
    }

    boardHost.replaceChildren(el('table', { class: 'board-table' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Rank'),
        el('th', { scope: 'col' }, 'Player'),
        el('th', { scope: 'col' }, 'Score'),
        el('th', { scope: 'col' }, 'Streak'))),
      el('tbody', {}, ...rows.map((row) => el('tr', { class: row.is_me ? 'me' : null },
        el('td', {}, String(row.rank)),
        el('td', {},
          row.display_name,
          row.is_me ? el('span', { class: 'tag' }, 'You') : null,
          !row.is_me && row.is_friend && scope === 'everyone' ? el('span', { class: 'tag' }, 'Friend') : null),
        el('td', { class: row.failed ? 'score-cell failed' : 'score-cell' }, formatScore(game, row)),
        el('td', {}, streakBadge(Number(row.streak))))))));
  };

  // Your own games first, then everything else, so any board can be looked at.
  const listIds = new Set(games.map((g) => g.id));
  const others = CATALOG.filter((g) => !listIds.has(g.id));
  if (!listIds.has(game.id) && !others.some((g) => g.id === game.id)) others.unshift(game);
  const option = (g) => el('option', { value: g.id, selected: g.id === game.id }, g.name);
  const select = el('select', {
    'aria-label': 'Game',
    onchange: () => {
      game = findGame(select.value);
      writeSetting('compareGame', game.id);
      loadBoard();
    },
  },
  games.length > 0 ? el('optgroup', { label: 'Your games' }, ...games.map(option)) : null,
  others.length > 0 ? el('optgroup', { label: 'All games' }, ...others.map(option)) : null);

  const controls = el('div', { class: 'row' });
  const drawControls = () => {
    controls.replaceChildren(
      select,
      segmented({
        label: 'Who to compare with',
        value: scope,
        options: [{ value: 'friends', label: 'Friends' }, { value: 'everyone', label: 'Everyone' }],
        onChange: (value) => {
          if (value === 'friends' && !account) {
            window.location.hash = '#/friends';
            return;
          }
          scope = value;
          writeSetting('compareScope', scope);
          drawControls();
          loadBoard();
        },
      }),
    );
  };
  drawControls();

  const nav = el('div', {});
  const drawNav = () => nav.replaceChildren(dateNav({
    date: ctx.date,
    onChange: (next) => {
      ctx.setDate(next);
      drawNav();
      loadBoard();
    },
  }));
  drawNav();

  host.replaceChildren(...[
    el('header', { class: 'view-head' }, nav),
    controls,
    !account ? el('p', { class: 'notice' }, 'You\'re viewing without signing in. ', el('a', { href: '#/account' }, 'Sign in'), ' to put your own scores on the board.') : null,
    boardHost,
    el('p', { class: 'muted small' }, 'Scores are logged by each player and can\'t be checked, so play nice. Only the score is shared, never your grid.'),
  ].filter(Boolean));
  loadBoard();
}
