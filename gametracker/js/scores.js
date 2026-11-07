// Formatting, comparing, ranking and validating scores. See the table in CLAUDE.md §4.

/**
 * @typedef {object} ScoreResult
 * @property {number|null} score
 * @property {boolean} failed
 */

/**
 * @param {number} seconds
 * @returns {string} like "1:05", or "1:02:05" past an hour
 */
export function formatTime(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Reads what someone typed into a time box: "1:23", "1:02:03" or plain seconds.
 * @param {string} text
 * @returns {number|null} seconds, or null if it isn't a time
 */
export function parseTime(text) {
  const parts = String(text).trim().split(':');
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n > 59)) return null;
  return nums.reduce((total, n) => total * 60 + n, 0);
}

/**
 * @param {{ kind: string }} game
 * @returns {boolean} whether a lower score beats a higher one
 */
export function lowerIsBetter(game) {
  return game.kind !== 'points';
}

const plural = (n, unit) => {
  if (!unit) return String(n);
  return `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
};

/**
 * @param {{ kind: string, max?: number, unit?: string }} game
 * @param {ScoreResult} result
 * @returns {string}
 */
export function formatScore(game, { score, failed }) {
  switch (game.kind) {
    case 'guesses':
      if (failed) return game.max ? `X/${game.max}` : 'Failed';
      return game.max ? `${score}/${game.max}` : plural(score, 'guesses');
    case 'count':
      return failed ? `Failed (${plural(score ?? 0, game.unit)})` : plural(score ?? 0, game.unit);
    case 'time':
      return failed ? 'Failed' : formatTime(score ?? 0);
    case 'points':
      if (failed) return 'Failed';
      return game.max ? `${score}/${game.max}${game.unit ? ` ${game.unit}` : ''}` : plural(score ?? 0, game.unit);
    default:
      return failed ? 'Failed' : 'Done';
  }
}

/**
 * Sorts best first. Failed results always come last, whatever their score.
 * @param {{ kind: string }} game
 * @param {ScoreResult} a
 * @param {ScoreResult} b
 * @returns {number}
 */
export function compareResults(game, a, b) {
  if (a.failed !== b.failed) return a.failed ? 1 : -1;
  const aMissing = a.score === null || a.score === undefined;
  const bMissing = b.score === null || b.score === undefined;
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
  return lowerIsBetter(game) ? a.score - b.score : b.score - a.score;
}

/**
 * Ranks rows the way game_board does in schema.sql: ties share a rank, and the next rank
 * skips past them (1, 2, 2, 4).
 * @template {ScoreResult} T
 * @param {{ kind: string }} game
 * @param {T[]} rows
 * @returns {(T & { rank: number })[]} a new array, best first
 */
export function rankRows(game, rows) {
  const sorted = [...rows].sort((a, b) => compareResults(game, a, b));
  const out = [];
  sorted.forEach((row, i) => {
    const tied = i > 0 && compareResults(game, sorted[i - 1], row) === 0;
    out.push({ ...row, rank: tied ? out[i - 1].rank : i + 1 });
  });
  return out;
}

/**
 * @param {number} n
 * @returns {string} like "1st", "2nd", "23rd"
 */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * Checks a result against the game's rules. Used for manual entry and for restoring backups.
 * @param {{ kind: string, max?: number }} game
 * @param {{ score?: unknown, failed?: unknown }} result
 * @returns {ScoreResult|null} the cleaned result, or null if it isn't valid
 */
export function cleanResult(game, { score = null, failed = false }) {
  const isFailed = failed === true;
  if (game.kind === 'done') return { score: null, failed: isFailed };
  if (isFailed && (score === null || score === undefined)) return { score: null, failed: true };
  if (!Number.isInteger(score) || score < 0 || score > 1000000) return null;
  if (game.kind === 'guesses' && score < 1 && !isFailed) return null;
  if (game.max && score > game.max) return null;
  return { score, failed: isFailed };
}
