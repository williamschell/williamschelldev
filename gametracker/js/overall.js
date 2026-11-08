// The overall board: one ranking for a day across every game. Each built-in game a player
// finishes is worth 50 to 100 points, depending on how well they did, and their day is the sum.
// So playing more games counts, and one lucky 1/6 can't win the day on its own. See CLAUDE.md §4.

import { compareResults, lowerIsBetter, rankRows } from './scores.js';

/** What finishing a game is worth however badly it went. A better score adds up to the same again. */
export const FINISH_POINTS = 50;
export const TOP_POINTS = 100;

/**
 * Whether the game's own scale says how good a score is. Games without one (times, counts and
 * points with no top) are scored against the best result on the board instead.
 * @param {{ kind: string, max?: number }} game
 * @returns {boolean}
 */
export function hasScale(game) {
  if (game.kind === 'done') return true;
  if (game.kind === 'guesses' || game.kind === 'points') return Boolean(game.max);
  return false;
}

/**
 * How good a finished result is, from 0 (worst) to 1 (best).
 * @param {{ kind: string, max?: number }} game
 * @param {number|null} score
 * @param {number|null|undefined} best the best finished score on the board, for games without a scale
 * @returns {number}
 */
function quality(game, score, best) {
  if (game.kind === 'done') return 1;
  if (score === null || score === undefined) return 0;
  if (game.kind === 'guesses' && game.max) return game.max <= 1 ? 1 : (game.max - score) / (game.max - 1);
  if (game.kind === 'points' && game.max) return score / game.max;
  if (best === null || best === undefined) return 1;
  // Against the best on the board. The +1 keeps a best of 0 (no mistakes, no hints) workable.
  return lowerIsBetter(game) ? (best + 1) / (score + 1) : (best > 0 ? score / best : 1);
}

/**
 * Points one result earns toward a player's day.
 * @param {{ kind: string, max?: number }} game
 * @param {{ score: number|null, failed: boolean }} result
 * @param {number|null} [best] the best finished score on the board, for games without a scale
 * @returns {number} 0 for a failed game, otherwise 50 to 100
 */
export function gamePoints(game, { score, failed }, best = null) {
  if (failed) return 0;
  const q = Math.min(1, Math.max(0, quality(game, score, best)));
  return Math.round(FINISH_POINTS + (TOP_POINTS - FINISH_POINTS) * q);
}

/**
 * @typedef {object} DayRow
 * @property {string} user_id
 * @property {string} display_name
 * @property {string} game_id
 * @property {number|null} score
 * @property {boolean} failed
 * @property {boolean} [is_me]
 * @property {boolean} [is_friend]
 */

/**
 * @typedef {object} OverallRow
 * @property {number} rank
 * @property {string} user_id
 * @property {string} display_name
 * @property {boolean} is_me
 * @property {boolean} is_friend
 * @property {number} points
 * @property {number} solved games finished
 * @property {{ gameId: string, score: number|null, failed: boolean, points: number }[]} games best first
 */

/**
 * Turns every result on a day's board into a ranked overall board. Custom games don't count,
 * because two players can set the same one up differently.
 * @param {DayRow[]} rows
 * @param {(id: string) => ({ kind: string, max?: number, custom?: boolean }|undefined)} lookup
 * @returns {OverallRow[]} ranked by points, ties sharing a rank
 */
export function overallBoard(rows, lookup) {
  const counted = rows.filter((row) => {
    const game = lookup(row.game_id);
    return game && !game.custom;
  });

  // The best finished score per game, for the games scored against the board.
  const best = new Map();
  for (const row of counted) {
    const game = lookup(row.game_id);
    if (hasScale(game) || row.failed || row.score === null || row.score === undefined) continue;
    const current = best.get(row.game_id);
    if (current === undefined || compareResults(game, row, { score: current, failed: false }) < 0) {
      best.set(row.game_id, row.score);
    }
  }

  const players = new Map();
  for (const row of counted) {
    const game = lookup(row.game_id);
    let player = players.get(row.user_id);
    if (!player) {
      player = {
        user_id: row.user_id,
        display_name: row.display_name,
        is_me: Boolean(row.is_me),
        is_friend: Boolean(row.is_friend),
        points: 0,
        solved: 0,
        games: [],
      };
      players.set(row.user_id, player);
    }
    const points = gamePoints(game, row, best.get(row.game_id) ?? null);
    player.points += points;
    if (!row.failed) player.solved += 1;
    player.games.push({
      gameId: row.game_id, score: row.score, failed: row.failed, points,
    });
  }

  const list = [...players.values()];
  for (const player of list) player.games.sort((a, b) => b.points - a.points);
  list.sort((a, b) => a.display_name.localeCompare(b.display_name));
  // Ranked as a points game: higher wins, ties share a rank.
  return rankRows({ kind: 'points' }, list.map((p) => ({ ...p, score: p.points, failed: false })))
    .map(({ score, failed, ...rest }) => rest);
}
