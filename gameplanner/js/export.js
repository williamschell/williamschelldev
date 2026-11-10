// Turns to-dos and design docs into text to copy, download or print.
// Pure: no DOM, no storage and no network.

import {
  COLUMNS, DISCIPLINES, META_FIELDS, PRIORITIES, labelOf,
} from './model.js';

export const FORMATS = [
  { id: 'markdown', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'text', label: 'Plain text', ext: 'txt', mime: 'text/plain' },
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
];

/**
 * The cards that match the chosen disciplines and columns, in board order.
 * @param {object[]} cards
 * @param {{ disciplines: string[], columns: string[] }} choice
 * @returns {object[]}
 */
export function selectCards(cards, { disciplines, columns }) {
  return cards.filter((c) => disciplines.includes(c.discipline) && columns.includes(c.column));
}

/**
 * Splits cards into labelled groups in the board's own order, leaving out empty ones.
 * @param {object[]} cards
 * @param {'discipline'|'column'} groupBy
 * @returns {{ label: string, cards: object[] }[]}
 */
export function groupCards(cards, groupBy) {
  const list = groupBy === 'column' ? COLUMNS : DISCIPLINES;
  return list
    .map((item) => ({ label: item.label, cards: cards.filter((c) => c[groupBy] === item.id) }))
    .filter((group) => group.cards.length > 0);
}

/** The bits worth saying after a card's title, which depend on how it's grouped. */
function details(card, groupBy) {
  const parts = [];
  if (groupBy === 'column') parts.push(labelOf(DISCIPLINES, card.discipline));
  else if (card.column === 'doing' || card.column === 'backlog') parts.push(labelOf(COLUMNS, card.column).toLowerCase());
  if (card.priority !== 'normal') parts.push(`${labelOf(PRIORITIES, card.priority).toLowerCase()} priority`);
  if (card.due) parts.push(`due ${card.due}`);
  return parts;
}

const noteLines = (card) => card.notes.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== '');

/**
 * A Markdown checklist, which GitHub, Notion, Obsidian and Trello all read as tick boxes.
 * @param {string} name the game's name
 * @param {object[]} cards
 * @param {{ groupBy?: 'discipline'|'column', notes?: boolean }} [options]
 * @returns {string}
 */
export function todosToMarkdown(name, cards, { groupBy = 'discipline', notes = true } = {}) {
  const lines = [`# ${name}: to-dos`, ''];
  if (cards.length === 0) lines.push('_Nothing to do._', '');
  for (const group of groupCards(cards, groupBy)) {
    lines.push(`## ${group.label}`, '');
    for (const card of group.cards) {
      const extra = details(card, groupBy);
      lines.push(`- [${card.column === 'done' ? 'x' : ' '}] ${card.title}${extra.length ? ` _(${extra.join(', ')})_` : ''}`);
      if (notes) for (const line of noteLines(card)) lines.push(`  - ${line.trim()}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * A plain checklist for pasting anywhere or printing.
 * @param {string} name
 * @param {object[]} cards
 * @param {{ groupBy?: 'discipline'|'column', notes?: boolean }} [options]
 * @returns {string}
 */
export function todosToText(name, cards, { groupBy = 'discipline', notes = true } = {}) {
  const heading = `${name}: to-dos`;
  const lines = [heading, '='.repeat(heading.length), ''];
  if (cards.length === 0) lines.push('Nothing to do.', '');
  for (const group of groupCards(cards, groupBy)) {
    lines.push(group.label.toUpperCase());
    for (const card of group.cards) {
      const extra = details(card, groupBy);
      lines.push(`[${card.column === 'done' ? 'x' : ' '}] ${card.title}${extra.length ? ` (${extra.join(', ')})` : ''}`);
      if (notes) for (const line of noteLines(card)) lines.push(`    ${line.trim()}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * One CSV field. Quotes when needed, and stops a spreadsheet reading text as a formula.
 * @param {string} value
 * @returns {string}
 */
export function csvField(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A spreadsheet with one row per card, for Excel, Google Sheets, Jira or Trello imports.
 * @param {object[]} cards
 * @param {{ notes?: boolean }} [options]
 * @returns {string}
 */
export function todosToCsv(cards, { notes = true } = {}) {
  const header = ['Title', 'Discipline', 'Status', 'Done', 'Priority', 'Due'];
  if (notes) header.push('Notes');
  const rows = cards.map((card) => {
    const row = [
      card.title,
      labelOf(DISCIPLINES, card.discipline),
      labelOf(COLUMNS, card.column),
      card.column === 'done' ? 'yes' : 'no',
      labelOf(PRIORITIES, card.priority),
      card.due,
    ];
    if (notes) row.push(card.notes);
    return row.map(csvField).join(',');
  });
  return `${[header.join(','), ...rows].join('\r\n')}\r\n`;
}

/**
 * To-dos in the chosen format.
 * @param {string} format one of FORMATS
 * @param {string} name
 * @param {object[]} cards
 * @param {{ groupBy?: 'discipline'|'column', notes?: boolean }} options
 * @returns {string}
 */
export function exportTodos(format, name, cards, options) {
  if (format === 'csv') return todosToCsv(cards, options);
  if (format === 'text') return todosToText(name, cards, options);
  return todosToMarkdown(name, cards, options);
}

/**
 * The design doc as Markdown. Empty sections are left out unless asked for.
 * @param {object} project
 * @param {{ empty?: boolean }} [options]
 * @returns {string}
 */
export function gddToMarkdown(project, { empty = false } = {}) {
  const lines = [`# ${project.name}`, ''];
  const facts = [['Stage', project.meta.stage], ...META_FIELDS.map((f) => [f.label, project.meta[f.id]])]
    .filter(([, value]) => value && value.trim());
  for (const [label, value] of facts) lines.push(`- **${label}:** ${value.trim()}`);
  if (facts.length) lines.push('');
  for (const section of project.sections) {
    const body = section.body.trim();
    if (!body && !empty) continue;
    lines.push(`## ${section.title.trim() || 'Untitled section'}`, '', body || '_To be written._', '');
  }
  return lines.join('\n');
}

/**
 * A safe file name from a game's name.
 * @param {string} name
 * @returns {string}
 */
export function fileSlug(name) {
  const slug = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'game';
}
