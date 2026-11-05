// Tests for the pure modules. Open tests/index.html through a local server to run them.

import { createRng } from '../js/rng.js';
import {
  MAX_WORD_LIMIT, MIN_WORDS, countWords, postProblem, readingTime,
} from '../js/words.js';
import {
  LAUNCH_DATE, challengeNumber, currentStreak, daysBefore, daysBetween, emptyStreak, isSunday, recordDaily,
} from '../js/daily.js';
import {
  GENRES, dailyChallenge, fullPrompt, practiceChallenge,
} from '../js/prompts.js';
import { parseHash } from '../js/router.js';

const results = document.getElementById('results');
let failures = 0;
let total = 0;

function test(name, fn) {
  total++;
  const li = document.createElement('li');
  try {
    fn();
    li.className = 'pass';
    li.textContent = name;
  } catch (err) {
    failures++;
    li.className = 'fail';
    li.textContent = `${name}: ${err.message}`;
  }
  results.append(li);
}

function equal(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} expected ${b}, got ${a}`);
}

function ok(value, label = 'expected true') {
  if (!value) throw new Error(label);
}

/** Every date for a number of days from launch. */
function dates(count) {
  const [y, m, d] = LAUNCH_DATE.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const when = new Date(Date.UTC(y, m - 1, d + i));
    return when.toISOString().slice(0, 10);
  });
}

// --- rng ---

test('rng: the same seed gives the same sequence', () => {
  const a = createRng('seed');
  const b = createRng('seed');
  for (let i = 0; i < 20; i++) equal(a.next(), b.next());
});

test('rng: different seeds give different sequences', () => {
  ok(createRng('one').next() !== createRng('two').next());
});

// --- words ---

test('words: counts across spaces, tabs and new lines', () => {
  equal(countWords(''), 0);
  equal(countWords('   \n\t '), 0);
  equal(countWords('one'), 1);
  equal(countWords('  one two\n\nthree\tfour  '), 4);
  equal(countWords("don't stop-start"), 2);
});

test('words: posting needs the minimum', () => {
  const short = Array(MIN_WORDS - 1).fill('word').join(' ');
  ok(postProblem(short, 100)?.includes('at least'));
  ok(postProblem('', 100)?.includes('at least'));
});

test('words: exactly the limit is fine, one over is not', () => {
  const body = Array(100).fill('word').join(' ');
  equal(postProblem(body, 100), null);
  ok(postProblem(`${body} more`, 100)?.includes('1 word over'));
});

test('words: one giant word is blocked by the character cap', () => {
  const body = `${Array(20).fill('word').join(' ')} ${'x'.repeat(50001)}`;
  ok(postProblem(body, 100)?.includes('characters'));
});

test('words: reading time is at least a minute', () => {
  equal(readingTime(0), '1 min read');
  equal(readingTime(221), '2 min read');
});

// --- daily ---

test('daily: day math crosses months, years and daylight saving', () => {
  equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  equal(daysBetween('2028-02-28', '2028-03-01'), 2);
  equal(daysBetween('2027-03-13', '2027-03-15'), 2);
  equal(daysBefore('2027-01-01', 1), '2026-12-31');
});

test('daily: launch day is Novle #1', () => {
  equal(challengeNumber(LAUNCH_DATE), 1);
});

test('daily: streaks extend, hold and reset', () => {
  let s = recordDaily(emptyStreak(), '2026-12-30');
  equal(s.current, 1);
  s = recordDaily(s, '2026-12-30');
  equal(s.current, 1, 'same day');
  s = recordDaily(s, '2026-12-31');
  s = recordDaily(s, '2027-01-01');
  equal(s.current, 3, 'across the year');
  s = recordDaily(s, '2027-01-05');
  equal(s.current, 1, 'after a gap');
  equal(s.best, 3);
});

test('daily: a streak survives until the day after, and is never negative', () => {
  const s = { lastDate: '2027-01-05', current: 4, best: 4 };
  equal(currentStreak(s, '2027-01-05'), 4);
  equal(currentStreak(s, '2027-01-06'), 4);
  equal(currentStreak(s, '2027-01-07'), 0);
  equal(currentStreak(s, '2027-01-04'), 4, 'time-zone change');
  equal(currentStreak(emptyStreak(), '2027-01-05'), 0);
});

// --- prompts ---

test('prompts: a date always gives the same challenge', () => {
  for (const date of dates(30)) equal(dailyChallenge(date), dailyChallenge(date));
});

test('prompts: every challenge fits what the database accepts', () => {
  for (const date of dates(1500)) {
    const c = dailyChallenge(date);
    ok(c.genre.length >= 1 && c.genre.length <= 40, `genre on ${date}`);
    ok(c.wordLimit >= 500 && c.wordLimit <= MAX_WORD_LIMIT, `limit on ${date}: ${c.wordLimit}`);
    const text = fullPrompt(c);
    ok(text.length >= 1 && text.length <= 600, `prompt on ${date}: ${text.length}`);
  }
});

test('prompts: every genre appears once before any repeats, and never twice in a row', () => {
  const list = dates(GENRES.length * 40).map((date) => dailyChallenge(date).genre);
  for (let i = 1; i < list.length; i++) ok(list[i] !== list[i - 1], `repeat at day ${i}: ${list[i]}`);
  for (let cycle = 0; cycle < 40; cycle++) {
    const slice = list.slice(cycle * GENRES.length, (cycle + 1) * GENRES.length);
    equal(new Set(slice).size, GENRES.length, `cycle ${cycle}`);
  }
});

test('prompts: Sundays are the long day, and other days are shorter', () => {
  for (const date of dates(120)) {
    const { wordLimit } = dailyChallenge(date);
    if (isSunday(date)) equal(wordLimit, MAX_WORD_LIMIT, date);
    else ok(wordLimit < MAX_WORD_LIMIT, `${date} is ${wordLimit}`);
  }
});

test('prompts: no prompt repeats within 45 days', () => {
  const list = dates(365).map((date) => dailyChallenge(date).prompt);
  for (let i = 0; i + 45 <= list.length; i++) {
    const window = list.slice(i, i + 45);
    equal(new Set(window).size, 45, `window starting at day ${i}`);
  }
});

test('prompts: a premise never repeats for two years', () => {
  const premises = dates(730).map((date) => dailyChallenge(date).prompt).filter((p) => !p.startsWith('Begin your story'));
  equal(new Set(premises).size, premises.length);
});

test('prompts: every fifth day is a first line, and about half have a wrinkle', () => {
  const list = dates(365).map((date) => dailyChallenge(date));
  list.forEach((c, i) => equal(c.prompt.startsWith('Begin your story'), i % 5 === 0, `day ${i}`));
  const wrinkles = list.filter((c) => c.wrinkle).length;
  ok(wrinkles > 120 && wrinkles < 240, `wrinkles: ${wrinkles}`);
});

test('prompts: fullPrompt only mentions a wrinkle when there is one', () => {
  const base = { genre: 'Noir', wordLimit: 1000, prompt: 'A premise.' };
  equal(fullPrompt({ ...base, wrinkle: null }), 'A premise.');
  equal(fullPrompt({ ...base, wrinkle: 'End on a question.' }), 'A premise. Wrinkle: End on a question.');
});

test('prompts: practice prompts follow their seed', () => {
  equal(practiceChallenge('abc'), practiceChallenge('abc'));
  const many = new Set(Array.from({ length: 50 }, (_, i) => practiceChallenge(`s${i}`).prompt));
  ok(many.size > 40, `only ${many.size} different`);
  ok(practiceChallenge('abc').wordLimit < MAX_WORD_LIMIT);
});

// --- router ---

test('router: routes parse and unknown ones go to write', () => {
  equal(parseHash('#/write').name, 'write');
  equal(parseHash('#/today').name, 'today');
  equal(parseHash('#/all-time').name, 'all-time');
  equal(parseHash('#/mine').name, 'mine');
  equal(parseHash('#/rules').name, 'rules');
  equal(parseHash('#/post/abc-123'), { name: 'post', params: { id: 'abc-123' } });
  equal(parseHash('').name, 'write');
  equal(parseHash('#/nonsense').name, 'write');
  equal(parseHash('#/post').name, 'write');
});

const summary = document.getElementById('summary');
summary.textContent = failures ? `${failures} of ${total} failed` : `All ${total} passed`;
summary.className = failures ? 'fail' : 'pass';
document.title = summary.textContent;
