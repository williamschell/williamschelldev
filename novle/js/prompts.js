// DRAFT prompt generator: date -> genre, word limit and prompt. Everyone with the same date
// gets the same result, with no server involved. See CLAUDE.md §4 for the plan.
//
// The lists below are placeholders to be workshopped. Changing a list reshuffles every day,
// including today, for anyone who loads the new code. Posts and saved stories keep a snapshot
// of what they answered, so old stories still show the right prompt.

import { createRng } from './rng.js';
import { daysBetween, isSunday, LAUNCH_DATE } from './daily.js';

/**
 * @typedef {object} Challenge
 * @property {string} genre
 * @property {number} wordLimit
 * @property {string} prompt
 * @property {string|null} wrinkle an optional extra twist
 */

export const GENRES = [
  'Mystery', 'Romance', 'Horror', 'Science Fiction', 'Fantasy', 'Comedy', 'Noir', 'Western',
  'Fairy Tale', 'Thriller', 'Historical', 'Slice of Life', 'Adventure', 'Magical Realism',
];

/** Repeats make a limit more common. Sundays ignore this list and get SUNDAY_LIMIT. */
const WORD_LIMITS = [750, 1000, 1000, 1500, 1500, 2000, 2500, 3000];
const SUNDAY_LIMIT = 5000;

/** How often a prompt is a first line to start from, rather than a premise. */
const FIRST_LINE_EVERY = 5;

const CHARACTERS = [
  'A retired stage magician', 'A night-shift nurse', 'A lighthouse keeper', 'A teenager on their first job',
  'A long-haul trucker', 'A small-town mayor', 'A cartographer', 'A beekeeper', 'A substitute teacher',
  'A wedding photographer', 'A piano tuner', 'A translator', 'A pair of estranged siblings',
  'A ferry captain', 'A failed novelist', 'An elderly chess champion', 'A locksmith', 'A museum night guard',
  'A traveling salesperson', 'A baker', 'A postal worker', 'A court stenographer', 'A storm chaser',
  'A newly elected ghost', 'A gardener', 'A radio host', 'A deep-sea diver', 'A librarian', 'A stray dog',
  'A town clockmaker', 'A hospital chaplain',
];

const SITUATIONS = [
  'gets a phone call from a number that was disconnected years ago',
  'finds a letter addressed to them, dated tomorrow',
  'inherits a house nobody knew existed',
  'wakes up to find everyone in town speaking a different language',
  'is asked to keep one small secret that keeps getting bigger',
  'discovers a door that was not there yesterday',
  'returns home after twenty years to find nothing has changed',
  'makes a promise they have no way of keeping',
  'receives the same anonymous gift every year, and this year it stops',
  'is mistaken for someone far more important',
  'has one night to undo a mistake',
  'finds a photograph of themselves in a place they have never been',
  'loses the one thing they were told never to lose',
  'starts getting mail meant for a stranger, and starts answering it',
  'is the only person who remembers what happened last Tuesday',
  'has to deliver bad news to someone they have never met',
  'wins a contest they never entered',
  'hears their own voice on an old recording, saying things they never said',
  'gets stuck overnight with their worst enemy',
  'agrees to a trade and only later learns what they gave away',
  'follows a stranger who dropped something important',
  'finds out the town has been keeping a tradition from them',
  'is offered the job of a lifetime on one strange condition',
  'tries to return a borrowed object to its owner decades too late',
  'notices the same person in the background of every memory',
];

const WRINKLES = [
  'Someone in the story is lying, and the reader finds out before the narrator does.',
  'The whole story takes place in a single room.',
  'The story covers exactly one hour.',
  'Tell it out of order.',
  'Write it in the second person.',
  'A broken clock matters more than it first seems.',
  'It rains the entire time, and that turns out to be important.',
  'End on a question.',
  'Nobody in the story ever says what they actually mean.',
  'A meal plays a key part.',
  'Tell it through letters, messages or notes.',
  'The narrator is not who they seem to be.',
  'The last line should change how the first line reads.',
  'Include a song that nobody can quite remember.',
  'Include a map that is wrong.',
];

const FIRST_LINES = [
  'By the time the bells stopped, everyone had already agreed not to talk about it.',
  'The first thing I stole was a Tuesday.',
  'Nobody ever came to the door at that hour, so of course I opened it.',
  'There were eleven chairs at the table, and we were expecting ten people.',
  'She had rehearsed the apology for nine years, and now he was late.',
  'The river gave back the car on the same day it gave back the rain.',
  'Everything in the shop was for sale except the thing I came for.',
  'It was the kind of town where the map ended a little early.',
  'I am told I was very brave, which is the first of several lies you will hear.',
  'The dog knew before any of us did.',
];

/**
 * Hand-written days. These replace any part of the generated challenge. For example:
 *   '2026-12-25': { genre: 'Fairy Tale', wordLimit: 2000, prompt: '...', wrinkle: null },
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

/**
 * Walks one fixed shuffle in order, so each item is as far from its repeat as possible. Keep
 * CHARACTERS and SITUATIONS at lengths that share no factor (31 and 25 now): a pairing then
 * can't come back for their product in days, which is 775.
 */
function walk(list, name, index) {
  const n = list.length;
  return shuffled(list, name)[((index % n) + n) % n];
}

const premise = (character, situation) => `${character} ${situation}.`;
const firstLinePrompt = (line) => `Begin your story with this line: "${line}"`;

/**
 * The challenge for a date.
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Challenge}
 */
export function dailyChallenge(dateStr) {
  const day = daysBetween(LAUNCH_DATE, dateStr);
  const rng = createRng(`novle-${dateStr}`);
  const generated = {
    genre: bagPick(GENRES, 'genre', day),
    wordLimit: isSunday(dateStr) ? SUNDAY_LIMIT : rng.pick(WORD_LIMITS),
    prompt: day % FIRST_LINE_EVERY === 0
      ? firstLinePrompt(walk(FIRST_LINES, 'first-line', day / FIRST_LINE_EVERY))
      : premise(walk(CHARACTERS, 'character', day), walk(SITUATIONS, 'situation', day)),
    wrinkle: rng.chance(0.5) ? walk(WRINKLES, 'wrinkle', day) : null,
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
  return {
    genre: rng.pick(GENRES),
    wordLimit: rng.pick(WORD_LIMITS),
    prompt: rng.chance(0.2)
      ? firstLinePrompt(rng.pick(FIRST_LINES))
      : premise(rng.pick(CHARACTERS), rng.pick(SITUATIONS)),
    wrinkle: rng.chance(0.5) ? rng.pick(WRINKLES) : null,
  };
}

/**
 * The prompt as one piece of text, which is what a post stores.
 * @param {Challenge} challenge
 * @returns {string}
 */
export function fullPrompt(challenge) {
  return challenge.wrinkle ? `${challenge.prompt} Wrinkle: ${challenge.wrinkle}` : challenge.prompt;
}
