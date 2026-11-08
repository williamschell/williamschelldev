// In-browser tests for the pure modules. Open tests/index.html, or run tests/e2e.mjs.

import { addDays, daysBetween, isDateString } from '../js/dates.js';
import { computeStreak, mergeExternalStreak } from '../js/streaks.js';
import {
  cleanResult, compareResults, formatScore, formatTime, lowerIsBetter, ordinal, parseTime, rankRows,
} from '../js/scores.js';
import {
  CATALOG, DEFAULT_GAMES, catalogGame, customGameId, isWebUrl, makeCustomGame,
} from '../js/catalog.js';
import { parseShare } from '../js/parse.js';
import { gamePoints, overallBoard } from '../js/overall.js';
import { parseHash } from '../js/router.js';

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

function equal(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} expected ${b}, got ${a}`);
}

const wordle = catalogGame('wordle');
const spelling = catalogGame('spelling-bee');
const waffle = catalogGame('waffle');
const mini = catalogGame('mini');
const connections = catalogGame('connections');
const splotchle = catalogGame('splotchle');

test('dates: arithmetic crosses months, years and leap days', () => {
  equal(addDays('2026-12-31', 1), '2027-01-01');
  equal(addDays('2028-03-01', -1), '2028-02-29');
  equal(daysBetween('2026-12-31', '2027-01-02'), 2);
  equal(daysBetween('2027-01-02', '2026-12-31'), -2);
});

test('dates: a daylight saving change doesn\'t shift a day', () => {
  equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  equal(daysBetween('2026-10-31', '2026-11-02'), 2);
});

test('dates: only real dates pass', () => {
  equal(isDateString('2026-02-28'), true);
  equal(isDateString('2026-02-30'), false);
  equal(isDateString('2026-13-01'), false);
  equal(isDateString('tomorrow'), false);
  equal(isDateString(20261107), false);
});

test('streaks: nothing played', () => {
  equal(computeStreak([], '2026-11-07'), { current: 0, best: 0, total: 0, lastDate: null });
});

test('streaks: alive today and yesterday, dead after that', () => {
  const days = ['2026-11-04', '2026-11-05', '2026-11-06'];
  equal(computeStreak(days, '2026-11-06').current, 3);
  equal(computeStreak(days, '2026-11-07').current, 3);
  equal(computeStreak(days, '2026-11-08').current, 0);
});

test('streaks: best survives a gap, order and duplicates don\'t matter', () => {
  const s = computeStreak(['2026-11-07', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-03', '2026-11-06'], '2026-11-07');
  equal(s, { current: 2, best: 3, total: 5, lastDate: '2026-11-07' });
});

test('streaks: across a year boundary', () => {
  equal(computeStreak(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01').current, 3);
});

test('streaks: a date ahead of today never goes negative', () => {
  equal(computeStreak(['2026-11-08'], '2026-11-07').current, 1);
});

test('streaks: the game\'s own record wins when it goes back further', () => {
  const own = computeStreak(['2026-11-07'], '2026-11-07');
  const merged = mergeExternalStreak(own, { lastDate: '2026-11-07', current: 9, best: 12 }, '2026-11-07');
  equal([merged.current, merged.best], [9, 12]);
});

test('streaks: an old external streak doesn\'t count as current', () => {
  const merged = mergeExternalStreak(computeStreak([], '2026-11-07'), { lastDate: '2026-10-01', current: 9, best: 12 }, '2026-11-07');
  equal([merged.current, merged.best], [0, 12]);
});

test('scores: formatting by kind', () => {
  equal(formatScore(wordle, { score: 3, failed: false }), '3/6');
  equal(formatScore(wordle, { score: null, failed: true }), 'X/6');
  equal(formatScore(mini, { score: 83, failed: false }), '1:23');
  equal(formatScore(connections, { score: 1, failed: false }), '1 mistake');
  equal(formatScore(connections, { score: 2, failed: false }), '2 mistakes');
  equal(formatScore(spelling, { score: 142, failed: false }), '142');
  equal(formatScore(waffle, { score: 4, failed: false }), '4/5 stars');
  equal(formatScore(splotchle, { score: null, failed: false }), 'Done');
});

test('scores: time parsing and formatting', () => {
  equal(parseTime('1:23'), 83);
  equal(parseTime('45'), 45);
  equal(parseTime('1:02:03'), 3723);
  equal(parseTime('1:99'), null);
  equal(parseTime('abc'), null);
  equal(parseTime(''), null);
  equal(formatTime(3723), '1:02:03');
  equal(formatTime(5), '0:05');
});

test('scores: direction', () => {
  equal(lowerIsBetter(wordle), true);
  equal(lowerIsBetter(spelling), false);
});

test('scores: failed always ranks last, whichever way scores go', () => {
  equal(compareResults(wordle, { score: null, failed: true }, { score: 6, failed: false }) > 0, true);
  equal(compareResults(spelling, { score: 999, failed: true }, { score: 1, failed: false }) > 0, true);
});

test('scores: ties share a rank and the next one skips', () => {
  const ranked = rankRows(wordle, [
    { n: 'd', score: null, failed: true },
    { n: 'b', score: 3, failed: false },
    { n: 'a', score: 2, failed: false },
    { n: 'c', score: 3, failed: false },
  ]);
  equal(ranked.map((r) => r.rank), [1, 2, 2, 4]);
  equal(ranked[0].n, 'a');
  equal(ranked[3].n, 'd');
});

test('scores: higher wins for points', () => {
  const ranked = rankRows(spelling, [{ score: 10, failed: false }, { score: 90, failed: false }]);
  equal(ranked[0].score, 90);
});

test('scores: done games all tie', () => {
  const ranked = rankRows(splotchle, [{ score: null, failed: false }, { score: null, failed: false }]);
  equal(ranked.map((r) => r.rank), [1, 1]);
});

test('scores: ordinals', () => {
  equal([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th']);
});

test('scores: invalid results are rejected', () => {
  equal(cleanResult(wordle, { score: 7, failed: false }), null);
  equal(cleanResult(wordle, { score: 0, failed: false }), null);
  equal(cleanResult(wordle, { score: 'x', failed: false }), null);
  equal(cleanResult(wordle, { score: 2.5, failed: false }), null);
  equal(cleanResult(mini, { score: -1, failed: false }), null);
  equal(cleanResult(wordle, { score: 3, failed: false }), { score: 3, failed: false });
  equal(cleanResult(wordle, { score: null, failed: true }), { score: null, failed: true });
  equal(cleanResult(splotchle, { score: 99 }), { score: null, failed: false });
});

test('catalog: Splotchle and Krillion are on the list by default', () => {
  equal(DEFAULT_GAMES, ['splotchle', 'krillion']);
  equal(catalogGame('splotchle').url, '../splotchle/');
  equal(catalogGame('krillion').kind, 'points');
});

test('catalog: points games rank higher first', () => {
  for (const id of ['krillion', 'enclose-horse', 'farflung']) {
    const game = catalogGame(id);
    equal(game.kind, 'points');
    const ranked = rankRows(game, [{ score: 120, failed: false }, { score: 480, failed: false }]);
    equal(ranked.map((r) => r.score), [480, 120]);
  }
});

test('catalog: every game is well formed', () => {
  const ids = new Set();
  for (const game of CATALOG) {
    if (!/^[a-z0-9-]{1,40}$/.test(game.id)) throw new Error(`bad id ${game.id}`);
    if (ids.has(game.id)) throw new Error(`duplicate ${game.id}`);
    ids.add(game.id);
    if (!['guesses', 'count', 'time', 'points', 'done'].includes(game.kind)) throw new Error(`bad kind ${game.id}`);
    if (!isWebUrl(game.url) && !game.url.startsWith('../')) throw new Error(`bad url ${game.id}`);
  }
});

test('catalog: only web links are allowed', () => {
  equal(isWebUrl('https://example.com'), true);
  equal(isWebUrl('http://example.com'), true);
  equal(isWebUrl('javascript:alert(1)'), false);
  equal(isWebUrl('JaVaScRiPt:alert(1)'), false);
  equal(isWebUrl('data:text/html,hi'), false);
  equal(isWebUrl('example.com'), false);
  equal(isWebUrl(null), false);
});

test('catalog: custom games', () => {
  const made = makeCustomGame({
    name: '  My Game! ', url: 'https://example.com', kind: 'guesses', max: '8',
  });
  equal(made.game.id, 'c-my-game');
  equal(made.game.name, 'My Game!');
  equal(made.game.max, 8);
  equal('error' in makeCustomGame({ name: 'A', url: 'javascript:alert(1)', kind: 'done' }), true);
  equal('error' in makeCustomGame({ name: '', url: 'https://a.co', kind: 'done' }), true);
  equal('error' in makeCustomGame({ name: 'A', url: 'https://a.co', kind: 'nope' }), true);
  equal('error' in makeCustomGame({ name: 'A', url: 'https://a.co', kind: 'guesses', max: 0 }), true);
});

test('catalog: custom ids always fit the server\'s rule', () => {
  for (const name of ['Foo', 'ありがとう', '🎮', 'a'.repeat(40), 'Über Game', '---', 'x-'.repeat(20)]) {
    const id = customGameId(name);
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`bad id "${id}" from "${name}"`);
  }
  equal(customGameId('Foo'), customGameId(' foo '));
});

const parses = (text, gameId, score, failed = false) => equal(parseShare(text), { gameId, score, failed }, text.slice(0, 30));

test('parse: Wordle', () => {
  parses('Wordle 1,234 3/6\n\n⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩', 'wordle', 3);
  parses('Wordle 1,234 X/6*\n⬛⬛⬛⬛⬛', 'wordle', null, true);
  parses('Wordle 987 6/6', 'wordle', 6);
  parses('Wordle 1 234 2/6', 'wordle', 2);
});

test('parse: Worldle isn\'t mistaken for Wordle', () => {
  parses('#Worldle #1234 2/6 (100%)\n🟩🟩🟩🟩🟨⬅️', 'worldle', 2);
  parses('#Worldle #1234 X/6 (92%)', 'worldle', null, true);
});

test('parse: Connections counts mistakes', () => {
  parses('Connections\nPuzzle #123\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪', 'connections', 0);
  parses('Connections\nPuzzle #123\n🟨🟨🟩🟨\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪', 'connections', 1);
  parses('Connections\nPuzzle #123\n🟨🟨🟩🟨\n🟨🟩🟨🟨\n🟨🟨🟦🟨\n🟨🟨🟪🟨', 'connections', 4, true);
});

test('parse: Strands counts hints', () => {
  parses('Strands #123\n“Some clue”\n🔵🟡🔵\n🔵🔵🔵', 'strands', 0);
  parses('Strands #123\n“Some clue”\n💡🔵🟡\n💡🔵🔵', 'strands', 2);
});

test('parse: the Mini', () => {
  parses('I solved the 11/7/2026 New York Times Mini Crossword in 0:32!', 'mini', 32);
  parses('I solved the 11/7/2026 New York Times Mini Crossword in 1:05!', 'mini', 65);
});

test('parse: Framed finds the winning frame', () => {
  parses('Framed #123\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛', 'framed', 3);
  parses('Framed #123\n🎥 🟥 🟥 🟥 🟥 🟥 🟥', 'framed', null, true);
});

test('parse: the rest', () => {
  parses('I played contexto.me #123 and got it in 15 guesses.', 'contexto', 15);
  parses('I solved Semantle #123 in 25 guesses.', 'semantle', 25);
  parses('Daily Quordle 123\n6️⃣5️⃣\n4️⃣3️⃣', 'quordle', 18);
  parses('Daily Quordle 123\n6️⃣🟥\n4️⃣3️⃣', 'quordle', 13, true);
  parses('#waffle123 4/5\n\n🔥 streak: 3', 'waffle', 4);
  parses('nerdlegame 123 3/6', 'nerdle', 3);
  parses('Bandle #123 2/6', 'bandle', 2);
  parses('Costcodle #123 4/6', 'costcodle', 4);
  parses('Queens #123 | 1:23 and flawless', 'queens', 83);
  parses('Tango #123 | 0:45', 'tango', 45);
  parses('🌎 Nov 7, 2026 🌍\n🔥 3 | Avg. Guesses: 6\n🟡🟠 = 12\n#globle', 'globle', 12);
});

test('parse: Krillion, Enclose Horse and Farflung, from real share text', () => {
  parses('Krillion #115 🦐\n410\n\n🏮🦑🦑🐟🏮🦑🐟', 'krillion', 410);
  parses('Krillion #116 🦐\r\n1,250\r\n🏮', 'krillion', 1250);
  parses('https://enclose.horse Day 313\n🥇 Excellent! 🥇 98%', 'enclose-horse', 98);
  parses('https://enclose.horse Day 314\nGood 100%', 'enclose-horse', 100);
  parses('Farflung #34 · 155/500 km\nRare · Miss · Miss · Elusive · Miss\nhttps://farflung.game/s/c6wxs3?e=34', 'farflung', 155);
  parses('Farflung #35 · 60/600 km', 'farflung', 50);
  equal(formatScore(catalogGame('enclose-horse'), { score: 98, failed: false }), '98%');
  equal(formatScore(catalogGame('farflung'), { score: 155, failed: false }), '155/500 km');
  equal(formatScore(catalogGame('krillion'), { score: 410, failed: false }), '410 points');
});

test('overall: points per game', () => {
  equal(gamePoints(wordle, { score: 1, failed: false }), 100);
  equal(gamePoints(wordle, { score: 6, failed: false }), 50);
  equal(gamePoints(wordle, { score: 3, failed: false }), 80);
  equal(gamePoints(wordle, { score: null, failed: true }), 0);
  equal(gamePoints(splotchle, { score: null, failed: false }), 100);
  equal(gamePoints(catalogGame('enclose-horse'), { score: 98, failed: false }), 99);
  equal(gamePoints(catalogGame('farflung'), { score: 155, failed: false }), 66);
  // Against the best on the board.
  equal(gamePoints(catalogGame('krillion'), { score: 410, failed: false }, 410), 100);
  equal(gamePoints(catalogGame('krillion'), { score: 205, failed: false }, 410), 75);
  equal(gamePoints(mini, { score: 59, failed: false }, 29), 75);
  equal(gamePoints(connections, { score: 0, failed: false }, 0), 100);
  equal(gamePoints(connections, { score: 1, failed: false }, 0), 75);
  equal(gamePoints(mini, { score: 30, failed: false }, null), 100);
});

test('overall: more games finished beats one lucky one, ties share a rank', () => {
  const row = (user, gameId, score, failed = false) => ({
    user_id: user, display_name: user, game_id: gameId, score, failed,
  });
  const board = overallBoard([
    row('lucky', 'wordle', 1),
    row('steady', 'wordle', 5), row('steady', 'splotchle', null), row('steady', 'krillion', 300),
    row('twin', 'wordle', 1),
    row('flop', 'wordle', null, true), row('flop', 'c-my-game', 1),
    row('ghost', 'not-a-game', 1),
  ], catalogGame);
  equal(board.map((p) => [p.display_name, p.rank, p.points, p.solved]), [
    ['steady', 1, 260, 3], ['lucky', 2, 100, 1], ['twin', 2, 100, 1], ['flop', 4, 0, 0],
  ]);
  equal(board[0].games.map((g) => g.gameId), ['splotchle', 'krillion', 'wordle']);
});

test('parse: anything else is left alone', () => {
  equal(parseShare(''), null);
  equal(parseShare('   '), null);
  equal(parseShare('I love the word Wordle'), null);
  equal(parseShare('Connections are important'), null);
  equal(parseShare(null), null);
});

test('router: routes and invite links', () => {
  equal(parseHash('#/today').name, 'today');
  equal(parseHash('#/games').name, 'games');
  equal(parseHash('').name, 'today');
  equal(parseHash('#/nope').name, 'today');
  equal(parseHash('#/add/ABC123'), { name: 'friends', params: { code: 'ABC123' } });
  equal(parseHash('#/compare/wordle'), { name: 'compare', params: { game: 'wordle' } });
});

const failures = results.filter((r) => !r.ok);
document.getElementById('summary').textContent = failures.length === 0
  ? `All ${results.length} tests passed`
  : `${failures.length} of ${results.length} tests FAILED`;
document.getElementById('summary').className = failures.length === 0 ? 'pass' : 'fail';
document.getElementById('results').append(...results.map((r) => {
  const line = document.createElement('div');
  line.className = r.ok ? 'pass' : 'fail';
  line.textContent = `${r.ok ? 'ok' : 'FAIL'}: ${r.name}${r.message ? ` (${r.message})` : ''}`;
  return line;
}));
window.testResults = results;
