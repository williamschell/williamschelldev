// The prompt generator: date -> genre, word limit and prompt. Everyone with the same date gets
// the same result, with no server involved. The content lives in prompt-bank.js. See CLAUDE.md §4.
//
// Each day has a genre and a shape. A shape is one kind of hook: a hand-written scenario for that
// genre, a first line to start from, a form to tell it in, and so on. Most shapes name the genre
// in the sentence, so the genre always matters to the prompt.
//
// Changing a list reshuffles the days that use it, including today, for anyone who loads the new
// code. Posts and saved stories keep a snapshot of what they answered, so old stories still show
// the right prompt.

import { createRng } from './rng.js';
import { daysBetween, isSunday, LAUNCH_DATE } from './daily.js';
import {
  CLOSING_LINES, GATHERINGS, GENRE_KITS, OBJECTS, OPENING_LINES, POINTS_OF_VIEW, SPOKEN_LINES,
  STORY_FORMS, TWISTS, WORD_BANK,
} from './prompt-bank.js';

/**
 * @typedef {object} Challenge
 * @property {string} genre
 * @property {number} wordLimit
 * @property {string|null} title a short name for the prompt. Older saved stories don't have one
 * @property {string} prompt
 * @property {string|null} wrinkle an optional extra twist
 */

export const GENRES = Object.keys(GENRE_KITS);

/** Repeats make a limit more common. Sundays ignore this list and get SUNDAY_LIMIT. */
const WORD_LIMITS = [750, 1000, 1000, 1500, 1500, 2000, 2500, 3000];
const SUNDAY_LIMIT = 5000;

const WORDS_PER_BANK = 4;
const TWIST_CHANCE = 1 / 3;

/**
 * The order shapes come around in. Hand-written scenarios are the best prompts, so they get the
 * most days. The length is 13 because it shares no factor with the 7-day week or the 14 genres,
 * so every genre meets every shape, and no shape gets stuck on one weekday.
 */
const SHAPE_ORDER = [
  'scenario', 'opening', 'scenario', 'form', 'object', 'scenario', 'spoken',
  'pov', 'scenario', 'gathering', 'closing', 'scenario', 'words',
];

/**
 * Shapes a twist can join. The rest already have a strict rule, and the best prompts give one
 * clear hook, so piling on more would make them worse.
 */
const TWIST_SHAPES = new Set(['scenario', 'object', 'gathering', 'spoken']);

/**
 * Hand-written days. These replace any part of the generated challenge. For example:
 *   '2026-12-25': { genre: 'Fairy Tale', wordLimit: 2000, title: '...', prompt: '...', wrinkle: null },
 * @type {Record<string, Partial<Challenge>>}
 */
const OVERRIDES = {};

/** A fixed shuffle of a list (Fisher-Yates), decided entirely by the salt. */
function shuffled(list, salt) {
  const rng = createRng(salt);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deals from a shuffled bag, so every item appears once before any repeats. It needs no saved
 * state: the day number says which bag and which position. Swapping the first two items never
 * changes a bag's last item, so the check against the previous bag can't cascade backward.
 */
function bagPick(list, name, dayIndex) {
  const n = list.length;
  const cycle = Math.floor(dayIndex / n);
  const bag = shuffled(list, `${name}-${cycle}`);
  const previousLast = shuffled(list, `${name}-${cycle - 1}`)[n - 1];
  if (bag[0] === previousLast) [bag[0], bag[1]] = [bag[1], bag[0]];
  return bag[dayIndex - cycle * n];
}

/** Walks one fixed shuffle in order, so each item is as far from its repeat as possible. */
function walk(list, name, index) {
  const n = list.length;
  return shuffled(list, name)[((index % n) + n) % n];
}

const mod = (n, size) => ((n % size) + size) % size;

const shapeOfDay = (day) => SHAPE_ORDER[mod(day, SHAPE_ORDER.length)];

/** Remembered because working out a scenario's place looks back over every earlier day. */
const genreCache = new Map();

function genreOfDay(day) {
  if (!genreCache.has(day)) genreCache.set(day, bagPick(GENRES, 'genre', day));
  return genreCache.get(day);
}

/**
 * How many scenarios a genre has had before a day. A genre only gets a scenario on some of its
 * days, so counting the real ones means every scenario is used before any comes back.
 */
function scenariosBefore(genre, day) {
  let count = 0;
  for (let d = 0; d < day; d++) {
    if (shapeOfDay(d) === 'scenario' && genreOfDay(d) === genre) count++;
  }
  return count;
}

/**
 * How many times a day's shape has come up before that day. Lists are walked by this count, not
 * by the day number. Otherwise a shape that lands on every 13th day would only ever reach some
 * of the items in its list.
 */
function shapeCount(day) {
  const position = mod(day, SHAPE_ORDER.length);
  const shape = shapeOfDay(day);
  const perRound = SHAPE_ORDER.filter((s) => s === shape).length;
  const earlier = SHAPE_ORDER.slice(0, position).filter((s) => s === shape).length;
  return Math.floor(day / SHAPE_ORDER.length) * perRound + earlier;
}

/**
 * Writes the prompt for a genre and shape.
 * @param {string} genre
 * @param {string} shape
 * @param {(list: any[], name: string, offset?: number) => any} pick chooses from a list
 * @returns {{ title: string, prompt: string }}
 */
function writePrompt(genre, shape, pick) {
  const { story, scenarios } = GENRE_KITS[genre];
  switch (shape) {
    case 'opening':
      return { title: 'Start Here', prompt: `Start ${story} with this line: "${pick(OPENING_LINES, 'opening')}"` };
    case 'closing':
      return { title: 'The Last Word', prompt: `Write ${story} that ends with this exact line: "${pick(CLOSING_LINES, 'closing')}"` };
    case 'spoken':
      return { title: 'Somebody Has to Say It', prompt: `Write ${story} in which someone has to say: "${pick(SPOKEN_LINES, 'spoken')}"` };
    case 'pov':
      return { title: 'Whose Story Is It?', prompt: `Write ${story} from the point of view of ${pick(POINTS_OF_VIEW, 'pov')}.` };
    case 'form':
      return { title: 'Odd Format', prompt: `Tell ${story} entirely as ${pick(STORY_FORMS, 'form')}.` };
    case 'gathering':
      return { title: 'Something Goes Wrong', prompt: `Set ${story} at ${pick(GATHERINGS, 'gathering')}, and let something go wrong.` };
    case 'object':
      return { title: 'The Object', prompt: `Build ${story} around ${pick(OBJECTS, 'object')}.` };
    case 'words': {
      const words = Array.from({ length: WORDS_PER_BANK }, (_, i) => pick(WORD_BANK, 'words', i));
      return { title: 'Four Words', prompt: `Write ${story} that uses all four of these words: ${words.join(', ')}.` };
    }
    default: {
      const [title, prompt] = pick(scenarios, `scenario-${genre}`);
      return { title, prompt };
    }
  }
}

/**
 * Half the twists come from the general list, and half ban the genre's most tired words. A ban
 * can't be fair if the prompt itself uses one of the words, so those days get a general twist.
 */
function writeTwist(genre, prompt, useBanned, general) {
  const { banned } = GENRE_KITS[genre];
  const clashes = banned.some((word) => new RegExp(`\\b${word}`, 'i').test(prompt));
  if (!useBanned || clashes) return general;
  return `Don't use any of these words: ${banned.map((word) => `"${word}"`).join(', ')}.`;
}

/**
 * The challenge for a date.
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Challenge}
 */
export function dailyChallenge(dateStr) {
  const day = daysBetween(LAUNCH_DATE, dateStr);
  const rng = createRng(`novle-${dateStr}`);
  const genre = genreOfDay(day);
  const shape = shapeOfDay(day);
  const wordLimit = isSunday(dateStr) ? SUNDAY_LIMIT : rng.pick(WORD_LIMITS);
  const count = shape === 'scenario' ? scenariosBefore(genre, day) : shapeCount(day);
  const pick = (list, name, offset = 0) => {
    const step = name === 'words' ? WORDS_PER_BANK : 1;
    return walk(list, name, count * step + offset);
  };
  const rollTwist = rng.chance(TWIST_CHANCE);
  const useBanned = rng.chance(0.5);
  const written = writePrompt(genre, shape, pick);
  const generated = {
    genre,
    wordLimit,
    ...written,
    wrinkle: TWIST_SHAPES.has(shape) && rollTwist
      ? writeTwist(genre, written.prompt, useBanned, walk(TWISTS, 'twist', day))
      : null,
  };
  return { ...generated, ...OVERRIDES[dateStr] };
}

/**
 * A challenge for practice, unconnected to any date.
 * @param {string} seed
 * @returns {Challenge}
 */
export function practiceChallenge(seed) {
  const rng = createRng(`practice-${seed}`);
  const genre = rng.pick(GENRES);
  const shape = rng.pick(SHAPE_ORDER);
  const wordLimit = rng.pick(WORD_LIMITS);
  // Shuffling first means a word bank can't pick the same word twice.
  const words = shuffled(WORD_BANK, `practice-words-${seed}`);
  const pick = (list, name, offset = 0) => (name === 'words' ? words[offset] : rng.pick(list));
  const written = writePrompt(genre, shape, pick);
  const rollTwist = rng.chance(TWIST_CHANCE);
  const useBanned = rng.chance(0.5);
  return {
    genre,
    wordLimit,
    ...written,
    wrinkle: TWIST_SHAPES.has(shape) && rollTwist ? writeTwist(genre, written.prompt, useBanned, rng.pick(TWISTS)) : null,
  };
}

/**
 * The prompt as one piece of text, which is what a post stores.
 * @param {Challenge} challenge
 * @returns {string}
 */
export function fullPrompt({ title, prompt, wrinkle }) {
  const name = title ? `${title}${/[.?!]$/.test(title) ? '' : '.'} ` : '';
  return `${name}${prompt}${wrinkle ? ` Optional twist: ${wrinkle}` : ''}`;
}
