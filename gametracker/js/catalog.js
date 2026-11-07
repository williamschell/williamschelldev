// The built-in games, and the rules for custom ones. Adding a game here is all it takes to
// list it. Add a parser in parse.js too if it has share text.

/**
 * @typedef {object} Game
 * @property {string} id matches the server's rule: lowercase letters, digits and dashes
 * @property {string} name
 * @property {string} url where Play goes
 * @property {'guesses'|'count'|'time'|'points'|'done'} kind see CLAUDE.md §4
 * @property {number} [max] the top of the scale, for guesses and some points
 * @property {string} [unit] plural, like "mistakes"
 * @property {boolean} [canFail] whether manual entry offers a failed option
 * @property {string} [blurb]
 * @property {string} [autoKey] the localStorage key where this game keeps its own streak
 * @property {boolean} [custom]
 */

/** @type {Game[]} */
export const CATALOG = [
  {
    id: 'splotchle', name: 'Splotchle', url: '../splotchle/', kind: 'done', autoKey: 'splotchio:streak', blurb: 'Turn today\'s blob into a character',
  },
  {
    id: 'novle', name: 'Novle', url: '../novle/', kind: 'done', autoKey: 'novle:streak', blurb: 'A daily short story challenge',
  },
  {
    id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle/index.html', kind: 'guesses', max: 6, canFail: true, blurb: 'Guess the five-letter word',
  },
  {
    id: 'connections', name: 'Connections', url: 'https://www.nytimes.com/games/connections', kind: 'count', unit: 'mistakes', canFail: true, blurb: 'Find the four groups',
  },
  {
    id: 'strands', name: 'Strands', url: 'https://www.nytimes.com/games/strands', kind: 'count', unit: 'hints', blurb: 'Find the themed words',
  },
  {
    id: 'mini', name: 'The Mini', url: 'https://www.nytimes.com/crosswords/game/mini', kind: 'time', blurb: 'A small crossword against the clock',
  },
  {
    id: 'spelling-bee', name: 'Spelling Bee', url: 'https://www.nytimes.com/puzzles/spelling-bee', kind: 'points', blurb: 'Make words from seven letters',
  },
  {
    id: 'sudoku', name: 'NYT Sudoku', url: 'https://www.nytimes.com/puzzles/sudoku', kind: 'time', blurb: 'Log your time',
  },
  {
    id: 'pips', name: 'Pips', url: 'https://www.nytimes.com/games/pips', kind: 'time', blurb: 'Place the dominoes',
  },
  {
    id: 'worldle', name: 'Worldle', url: 'https://worldle.teuteuf.fr/', kind: 'guesses', max: 6, canFail: true, blurb: 'Name the country from its shape',
  },
  {
    id: 'globle', name: 'Globle', url: 'https://globle-game.com/', kind: 'count', unit: 'guesses', blurb: 'Find the mystery country',
  },
  {
    id: 'framed', name: 'Framed', url: 'https://framed.wtf/', kind: 'guesses', max: 6, canFail: true, blurb: 'Name the movie from its frames',
  },
  {
    id: 'contexto', name: 'Contexto', url: 'https://contexto.me/', kind: 'count', unit: 'guesses', blurb: 'Find the word by closeness',
  },
  {
    id: 'semantle', name: 'Semantle', url: 'https://semantle.com/', kind: 'count', unit: 'guesses', blurb: 'Find the word by meaning',
  },
  {
    id: 'quordle', name: 'Quordle', url: 'https://www.merriam-webster.com/games/quordle/', kind: 'count', unit: 'guesses', canFail: true, blurb: 'Four Wordles at once',
  },
  {
    id: 'waffle', name: 'Waffle', url: 'https://wafflegame.net/daily', kind: 'points', max: 5, unit: 'stars', canFail: true, blurb: 'Swap letters to fix the grid',
  },
  {
    id: 'nerdle', name: 'Nerdle', url: 'https://nerdlegame.com/', kind: 'guesses', max: 6, canFail: true, blurb: 'Wordle, but it\'s math',
  },
  {
    id: 'bandle', name: 'Bandle', url: 'https://bandle.app/', kind: 'guesses', max: 6, canFail: true, blurb: 'Name the song one instrument at a time',
  },
  {
    id: 'costcodle', name: 'Costcodle', url: 'https://costcodle.com/', kind: 'guesses', max: 6, canFail: true, blurb: 'Guess the price',
  },
  {
    id: 'queens', name: 'Queens', url: 'https://www.linkedin.com/games/queens/', kind: 'time', blurb: 'LinkedIn\'s crown placement puzzle',
  },
  {
    id: 'tango', name: 'Tango', url: 'https://www.linkedin.com/games/tango/', kind: 'time', blurb: 'LinkedIn\'s sun and moon grid',
  },
];

/** What a new person's list starts with. */
export const DEFAULT_GAMES = ['splotchle'];

/** Offered as one-tap additions when someone's list is short. */
export const SUGGESTED_GAMES = ['wordle', 'connections', 'strands', 'mini', 'worldle'];

export const KINDS = [
  { id: 'guesses', label: 'Guesses out of a limit, like 3/6' },
  { id: 'count', label: 'A count where lower is better' },
  { id: 'time', label: 'A time' },
  { id: 'points', label: 'Points where higher is better' },
  { id: 'done', label: 'No score, just done or not' },
];

const BY_ID = new Map(CATALOG.map((game) => [game.id, game]));

/**
 * @param {string} id
 * @returns {Game|undefined}
 */
export function catalogGame(id) {
  return BY_ID.get(id);
}

/**
 * Only web links are allowed, so a custom link can never run script.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isWebUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Two people who name a custom game the same way end up on the same board. Names with no
 * Latin letters or digits fall back to a hash, so they still get a stable id.
 * @param {string} name
 * @returns {string}
 */
export function customGameId(name) {
  const clean = name.trim().toLowerCase();
  const slug = clean.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
  if (slug) return `c-${slug}`.replace(/-+$/, '');
  let hash = 0;
  for (const ch of clean) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0;
  return `c-${hash.toString(16)}`;
}

/**
 * Validates a custom game.
 * @param {{ name?: unknown, url?: unknown, kind?: unknown, max?: unknown, unit?: unknown }} input
 * @returns {{ game: Game } | { error: string }}
 */
export function makeCustomGame({ name, url, kind, max, unit }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName.length < 1 || cleanName.length > 40) return { error: 'Names are 1 to 40 characters.' };
  const cleanUrl = typeof url === 'string' ? url.trim() : '';
  if (!isWebUrl(cleanUrl)) return { error: 'The link has to start with http:// or https://.' };
  if (!KINDS.some((k) => k.id === kind)) return { error: 'Choose how this game is scored.' };

  /** @type {Game} */
  const game = {
    id: customGameId(cleanName), name: cleanName, url: cleanUrl, kind, custom: true,
  };
  if (BY_ID.has(game.id)) return { error: 'That one is already in the list of games.' };
  if (kind === 'guesses') {
    const limit = Number(max);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return { error: 'The guess limit has to be 1 to 50.' };
    game.max = limit;
    game.canFail = true;
  } else if (kind !== 'done') {
    game.canFail = true;
  }
  if ((kind === 'count' || kind === 'points') && typeof unit === 'string' && unit.trim()) {
    game.unit = unit.trim().slice(0, 20);
  }
  return { game };
}
