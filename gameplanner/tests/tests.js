// In-browser tests for the pure modules. Open tests/index.html. Also runs under Node:
//   node gameplanner/tests/tests.js

import {
  GDD_TEMPLATE, cleanCard, cleanData, cleanProject, isDateString, isOverdue, newProject, nextColumn, placeCard,
  progressOf, shiftCard, wordCount,
} from '../js/model.js';
import {
  csvField, fileSlug, gddToMarkdown, groupCards, selectCards, todosToCsv, todosToMarkdown, todosToText,
} from '../js/export.js';
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

const card = (id, column, discipline = 'art', extra = {}) => cleanCard({
  id, title: `Card ${id}`, column, discipline, ...extra,
});
const ids = (cards) => cards.map((c) => c.id);

test('dates: only real dates pass', () => {
  equal(isDateString('2028-02-29'), true);
  equal(isDateString('2026-02-29'), false);
  equal(isDateString('2026-13-01'), false);
  equal(isDateString('soon'), false);
});

test('cards: cleaned, defaulted and rejected without a title', () => {
  const c = cleanCard({
    title: '  Make   the player sprite ', discipline: 'nope', column: 'doing', priority: 'high', due: '2026-02-30', extra: 1,
  });
  equal(c.title, 'Make the player sprite');
  equal(c.discipline, 'design');
  equal(c.column, 'doing');
  equal(c.priority, 'high');
  equal(c.due, '');
  equal('extra' in c, false);
  equal(cleanCard({ title: '   ' }), null);
  equal(cleanCard('hi'), null);
});

test('projects: a new game gets the whole template', () => {
  const p = newProject('  Space   Goose ');
  equal(p.name, 'Space Goose');
  equal(p.sections.map((s) => s.title), GDD_TEMPLATE.map((s) => s.title));
  equal(p.cards, []);
  equal(p.meta.stage, 'Idea');
});

test('projects: duplicate ids are split apart', () => {
  const p = cleanProject({ name: 'x', cards: [{ id: 'a', title: 'one' }, { id: 'a', title: 'two' }] });
  equal(p.cards.length, 2);
  equal(p.cards[0].id === p.cards[1].id, false);
});

test('data: garbage gives an empty but usable shape', () => {
  equal(cleanData(null), { projects: [], currentId: null });
  equal(cleanData({ projects: 'no' }), { projects: [], currentId: null });
  const d = cleanData({ projects: [{ id: 'p1', name: 'A' }, null, { id: 'p2', name: 'B' }], currentId: 'zzz' });
  equal(d.projects.length, 2);
  equal(d.currentId, 'p1');
});

test('board: placing a card moves it to another column', () => {
  const cards = [card('a', 'todo'), card('b', 'todo'), card('c', 'doing')];
  const moved = placeCard(cards, 'a', 'doing');
  equal(ids(moved), ['b', 'c', 'a']);
  equal(moved[2].column, 'doing');
  equal(ids(placeCard(cards, 'c', 'todo', 'b')), ['a', 'c', 'b']);
  equal(placeCard(cards, 'a', 'todo', 'a'), cards);
  equal(placeCard(cards, 'missing', 'todo'), cards);
});

test('board: shifting only counts cards that are showing', () => {
  const cards = [card('a', 'todo', 'art'), card('b', 'todo', 'audio'), card('c', 'todo', 'art'), card('d', 'done', 'art')];
  equal(ids(shiftCard(cards, 'c', -1)), ['a', 'c', 'b', 'd']);
  const artOnly = (c) => c.discipline === 'art';
  equal(ids(shiftCard(cards, 'c', -1, artOnly)), ['c', 'a', 'b', 'd']);
  equal(ids(shiftCard(cards, 'a', 1, artOnly)), ['b', 'c', 'a', 'd']);
  equal(shiftCard(cards, 'a', -1), cards);
  equal(shiftCard(cards, 'c', 1, artOnly), cards);
});

test('board: columns, progress and overdue', () => {
  equal(nextColumn('backlog', -1), null);
  equal(nextColumn('todo', 1), 'doing');
  equal(nextColumn('done', 1), null);
  equal(progressOf([card('a', 'done'), card('b', 'todo')]), { done: 1, total: 2 });
  equal(isOverdue(card('a', 'todo', 'art', { due: '2026-01-01' }), '2026-01-02'), true);
  equal(isOverdue(card('a', 'done', 'art', { due: '2026-01-01' }), '2026-01-02'), false);
  equal(isOverdue(card('a', 'todo', 'art', { due: '2026-01-02' }), '2026-01-02'), false);
  equal(isOverdue(card('a', 'todo'), '2026-01-02'), false);
});

test('words are counted', () => {
  equal(wordCount(''), 0);
  equal(wordCount('  one two\nthree  '), 3);
});

const sample = [
  card('1', 'todo', 'art', { title: 'Player sprite', priority: 'high', due: '2026-12-01' }),
  card('2', 'doing', 'programming', { title: 'Jump physics', notes: 'Coyote time\n\nJump buffer' }),
  card('3', 'done', 'art', { title: 'Tileset' }),
  card('4', 'backlog', 'audio', { title: 'Footsteps' }),
];

test('export: selecting and grouping keeps board order', () => {
  const picked = selectCards(sample, { disciplines: ['art', 'audio'], columns: ['todo', 'done', 'backlog'] });
  equal(ids(picked), ['1', '3', '4']);
  equal(groupCards(picked, 'discipline').map((g) => g.label), ['Art', 'Audio']);
  equal(groupCards(picked, 'column').map((g) => g.label), ['Backlog', 'To do', 'Done']);
});

test('export: markdown checklist', () => {
  equal(todosToMarkdown('Goose', sample, { groupBy: 'discipline', notes: true }), [
    '# Goose: to-dos',
    '',
    '## Art',
    '',
    '- [ ] Player sprite _(high priority, due 2026-12-01)_',
    '- [x] Tileset',
    '',
    '## Programming',
    '',
    '- [ ] Jump physics _(doing)_',
    '  - Coyote time',
    '  - Jump buffer',
    '',
    '## Audio',
    '',
    '- [ ] Footsteps _(backlog)_',
    '',
  ].join('\n'));
});

test('export: plain text grouped by column, without notes', () => {
  const out = todosToText('Goose', sample, { groupBy: 'column', notes: false });
  equal(out.split('\n').slice(0, 6), ['Goose: to-dos', '=============', '', 'BACKLOG', '[ ] Footsteps (Audio)', '']);
  equal(out.includes('Coyote'), false);
  equal(out.includes('[x] Tileset (Art)'), true);
});

test('export: empty lists say so', () => {
  equal(todosToMarkdown('G', []).includes('_Nothing to do._'), true);
  equal(todosToText('G', []).includes('Nothing to do.'), true);
});

test('export: csv quotes and defuses formulas', () => {
  equal(csvField('plain'), 'plain');
  equal(csvField('a, b'), '"a, b"');
  equal(csvField('say "hi"'), '"say ""hi"""');
  equal(csvField('=SUM(A1)'), '\'=SUM(A1)');
  equal(csvField('-1'), '\'-1');
  const csv = todosToCsv(sample);
  const lines = csv.trimEnd().split('\r\n');
  equal(lines[0], 'Title,Discipline,Status,Done,Priority,Due,Notes');
  equal(lines.length, 5);
  equal(lines[1], 'Player sprite,Art,To do,no,High,2026-12-01,');
  equal(csv.includes('"Coyote time\n\nJump buffer"'), true);
  equal(todosToCsv(sample, { notes: false }).split('\r\n')[0].endsWith('Due'), true);
});

test('export: gdd markdown skips empty sections', () => {
  const p = newProject('Space Goose');
  p.meta.pitch = 'Honk in space';
  p.sections[0].body = 'A goose. In space.';
  const md = gddToMarkdown(p);
  equal(md.startsWith('# Space Goose\n\n- **Stage:** Idea\n- **One-line pitch:** Honk in space\n'), true);
  equal(md.includes('## Concept\n\nA goose. In space.'), true);
  equal(md.includes('## Core loop'), false);
  equal(gddToMarkdown(p, { empty: true }).includes('## Core loop\n\n_To be written._'), true);
});

test('export: file names', () => {
  equal(fileSlug('Space Goose: The Honkening!'), 'space-goose-the-honkening');
  equal(fileSlug('!!!'), 'game');
});

test('router: routes and discipline filters', () => {
  equal(parseHash(''), { name: 'gdd', params: {} });
  equal(parseHash('#/todos'), { name: 'todos', params: {} });
  equal(parseHash('#/todos/audio'), { name: 'todos', params: { discipline: 'audio' } });
  equal(parseHash('#/todos/cooking'), { name: 'gdd', params: {} });
  equal(parseHash('#/export'), { name: 'export', params: {} });
  equal(parseHash('#/nope'), { name: 'gdd', params: {} });
});

const failed = results.filter((r) => !r.ok);
if (typeof document !== 'undefined') {
  document.getElementById('summary').textContent = `${results.length - failed.length} of ${results.length} passed`;
  document.getElementById('summary').className = failed.length ? 'fail' : 'pass';
  for (const r of results) {
    const line = document.createElement('div');
    line.className = r.ok ? 'pass' : 'fail';
    line.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `: ${r.message}`}`;
    document.getElementById('results').append(line);
  }
} else {
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `: ${r.message}`}`);
  console.log(`${results.length - failed.length} of ${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
