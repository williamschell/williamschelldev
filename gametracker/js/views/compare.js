// The Compare view: a ranked board for one game on one day.

import { friendlyError, getBackend } from '../backend.js';
import { CATALOG, catalogGame } from '../catalog.js';
import { FINISH_POINTS, TOP_POINTS, overallBoard } from '../overall.js';
import { formatScore, lowerIsBetter } from '../scores.js';
import {
  findGame, myGames, readSetting, syncNow, writeSetting,
} from '../store.js';
import { el, segmented } from '../ui.js';
import { dateNav, notSetUp, streakBadge } from './common.js';

const OVERALL = 'overall';

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
  const saved = readSetting('compareGame', '');
  // The overall board, across every game, is picked like a game.
  let overall = ctx.params.game === OVERALL || (!requested && saved === OVERALL);
  let game = requested ?? findGame(saved) ?? games[0] ?? CATALOG[0];
  if (requested || overall) writeSetting('compareGame', overall ? OVERALL : game.id);
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
  const explainHost = el('details', { class: 'overall-explain' },
    el('summary', {}, 'How overall points work'),
    el('ul', {},
      el('li', {}, `Every game you finish earns ${FINISH_POINTS} to ${TOP_POINTS} points: ${FINISH_POINTS} for finishing, plus up to ${TOP_POINTS - FINISH_POINTS} more for how well you did. Your day is the total, so the more you finish, the better.`),
      el('li', {}, 'Games with a fixed scale are scored on it: 1/6 is the top and 6/6 the bottom, and 98% or 155/500 is that share of the way up.'),
      el('li', {}, 'Times, counts and open-ended points are scored against the best on this board, so the best gets the full amount.'),
      el('li', {}, 'Games with no score, like Splotchle, are worth the full amount for finishing. A failed game earns nothing, and custom games don\'t count.')));
  let requestId = 0;

  const emptyBoard = (what) => el('div', { class: 'empty' },
    el('p', {}, scope === 'friends'
      ? `Nobody on your friends list has logged ${what} for this day yet.`
      : `Nobody has logged ${what} for this day yet.`),
    scope === 'friends' ? el('a', { class: 'button', href: '#/friends' }, 'Add friends') : null);

  const playerCell = (row) => [
    row.display_name,
    row.is_me ? el('span', { class: 'tag' }, 'You') : null,
    !row.is_me && row.is_friend && scope === 'everyone' ? el('span', { class: 'tag' }, 'Friend') : null,
  ];

  const loadOverall = async (id) => {
    let rows;
    try {
      await syncNow();
      rows = overallBoard(await backend.dayBoard({ date: ctx.date, scope }), catalogGame);
    } catch (err) {
      console.warn('Streakle overall board:', err);
      if (id === requestId) boardHost.replaceChildren(el('p', { class: 'notice' }, friendlyError(err)));
      return;
    }
    if (id !== requestId || !ctx.isCurrent()) return;
    if (rows.length === 0) {
      boardHost.replaceChildren(emptyBoard('any games'));
      return;
    }

    const breakdown = (row) => el('ul', { class: 'breakdown' }, ...row.games.map((g) => {
      const played = catalogGame(g.gameId);
      return el('li', {},
        el('span', {}, played.name),
        el('span', { class: g.failed ? 'failed' : null }, formatScore(played, g)),
        el('span', { class: 'breakdown-points' }, `+${g.points}`));
    }));

    boardHost.replaceChildren(el('table', { class: 'board-table overall-table' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Rank'),
        el('th', { scope: 'col' }, 'Player'),
        el('th', { scope: 'col' }, 'Solved'),
        el('th', { scope: 'col' }, 'Points'))),
      el('tbody', {}, ...rows.slice(0, 100).concat(rows.slice(100).filter((r) => r.is_me))
        .map((row) => el('tr', { class: row.is_me ? 'me' : null },
          el('td', {}, String(row.rank)),
          el('td', {}, el('details', {}, el('summary', {}, ...playerCell(row)), breakdown(row))),
          el('td', {}, String(row.solved)),
          el('td', { class: 'score-cell' }, String(row.points)))))));
  };

  const loadBoard = async () => {
    requestId += 1;
    const id = requestId;
    boardHost.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    explainHost.hidden = !overall;
    if (overall) {
      await loadOverall(id);
      return;
    }
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
      boardHost.replaceChildren(emptyBoard(game.name));
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
        el('td', {}, ...playerCell(row)),
        el('td', { class: row.failed ? 'score-cell failed' : 'score-cell' }, formatScore(game, row)),
        el('td', {}, streakBadge(Number(row.streak))))))));
  };

  // Your own games first, then everything else, so any board can be looked at.
  const listIds = new Set(games.map((g) => g.id));
  const others = CATALOG.filter((g) => !listIds.has(g.id));
  if (!listIds.has(game.id) && !others.some((g) => g.id === game.id)) others.unshift(game);
  const option = (g) => el('option', { value: g.id, selected: !overall && g.id === game.id }, g.name);
  const select = el('select', {
    'aria-label': 'Game',
    onchange: () => {
      overall = select.value === OVERALL;
      if (!overall) game = findGame(select.value);
      writeSetting('compareGame', overall ? OVERALL : game.id);
      loadBoard();
    },
  },
  el('option', { value: OVERALL, selected: overall }, 'Overall: all games'),
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
    explainHost,
    boardHost,
    el('p', { class: 'muted small' }, 'Scores are logged by each player and can\'t be checked, so play nice. Only the score is shared, never your grid.'),
  ].filter(Boolean));
  loadBoard();
}
