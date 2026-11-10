// The planner's data: games, their design docs and their to-do cards.
// Pure: no DOM, no storage and no network.

export const DISCIPLINES = [
  { id: 'art', label: 'Art' },
  { id: 'programming', label: 'Programming' },
  { id: 'design', label: 'Design' },
  { id: 'audio', label: 'Audio' },
];

export const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

export const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
];

export const STAGES = ['Idea', 'Prototype', 'Vertical slice', 'Production', 'Polish', 'Released'];

/** The sections every new design doc starts with. Hints show as placeholder text. */
export const GDD_TEMPLATE = [
  { title: 'Concept', hint: 'What is the game, in a paragraph? Why is it worth making?' },
  { title: 'Core loop', hint: 'What does the player do over and over? Second to second, minute to minute, session to session.' },
  { title: 'Mechanics', hint: 'The rules and systems: movement, combat, crafting, scoring, failure…' },
  { title: 'Controls', hint: 'Which inputs do what, on each platform.' },
  { title: 'Story & setting', hint: 'Where and when it takes place, and what happens.' },
  { title: 'Characters', hint: 'Who the player is, and who they meet.' },
  { title: 'Levels & world', hint: 'How the world is laid out and how the player moves through it.' },
  { title: 'Progression', hint: 'How the player grows, unlocks things and is rewarded. The difficulty curve.' },
  { title: 'Art direction', hint: 'Style, palette, references, resolution, animation.' },
  { title: 'Audio direction', hint: 'Music style, sound effects, voice, references.' },
  { title: 'UI & UX', hint: 'Menus, HUD, onboarding, accessibility.' },
  { title: 'Scope & milestones', hint: 'What\'s in the first playable, the vertical slice and 1.0. What gets cut.' },
  { title: 'Notes', hint: 'Anything else: inspirations, open questions, ideas for later.' },
];

export const META_FIELDS = [
  { id: 'pitch', label: 'One-line pitch', placeholder: 'A cozy farming game where the crops fight back' },
  { id: 'genre', label: 'Genre', placeholder: 'Roguelite, puzzle, platformer…' },
  { id: 'platforms', label: 'Platforms', placeholder: 'PC, web, Switch…' },
  { id: 'audience', label: 'Who it\'s for', placeholder: 'Players who like…' },
  { id: 'engine', label: 'Engine & tools', placeholder: 'Godot, Unity, Aseprite, FMOD…' },
];

export const LIMITS = {
  name: 60, title: 140, notes: 4000, sectionTitle: 80, sectionBody: 100000, meta: 300, cards: 2000, sections: 100,
};

/**
 * A fresh id. Random, so two devices never hand out the same one.
 * @returns {string}
 */
export function makeId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The label for an id from one of the lists above.
 * @param {{ id: string, label: string }[]} list
 * @param {string} id
 * @returns {string}
 */
export function labelOf(list, id) {
  return list.find((item) => item.id === id)?.label ?? id;
}

/**
 * True for a real calendar date written YYYY-MM-DD.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const oneOf = (value, list, fallback) => (list.some((item) => item.id === value) ? value : fallback);
const time = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const idOr = (value) => (typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : makeId());

/**
 * Tidies a game's name. Empty means no usable name.
 * @param {unknown} name
 * @returns {string}
 */
export function cleanName(name) {
  return text(name, 200).replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
}

/**
 * A card from anywhere (the editor, a backup file), made safe. Null if it has no title.
 * @param {any} raw
 * @returns {object|null}
 */
export function cleanCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.title, 1000).replace(/\s+/g, ' ').trim().slice(0, LIMITS.title);
  if (!title) return null;
  return {
    id: idOr(raw.id),
    title,
    notes: text(raw.notes, LIMITS.notes),
    discipline: oneOf(raw.discipline, DISCIPLINES, 'design'),
    column: oneOf(raw.column, COLUMNS, 'todo'),
    priority: oneOf(raw.priority, PRIORITIES, 'normal'),
    due: isDateString(raw.due) ? raw.due : '',
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
  };
}

/**
 * A design doc section, made safe. Null if it isn't one.
 * @param {any} raw
 * @returns {object|null}
 */
export function cleanSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: idOr(raw.id),
    title: text(raw.title, LIMITS.sectionTitle),
    hint: text(raw.hint, 300),
    body: text(raw.body, LIMITS.sectionBody),
  };
}

/**
 * A whole game, made safe. Null if it isn't one.
 * @param {any} raw
 * @returns {object|null}
 */
export function cleanProject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name) || 'Untitled game';
  const meta = { stage: STAGES.includes(raw.meta?.stage) ? raw.meta.stage : STAGES[0] };
  for (const field of META_FIELDS) meta[field.id] = text(raw.meta?.[field.id], LIMITS.meta);
  const seen = new Set();
  const unique = (item) => {
    if (!item) return false;
    if (seen.has(item.id)) item.id = makeId();
    seen.add(item.id);
    return true;
  };
  return {
    id: idOr(raw.id),
    name,
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
    meta,
    sections: (Array.isArray(raw.sections) ? raw.sections : []).slice(0, LIMITS.sections).map(cleanSection).filter(unique),
    cards: (Array.isArray(raw.cards) ? raw.cards : []).slice(0, LIMITS.cards).map(cleanCard).filter(unique),
  };
}

/**
 * Everything the planner keeps, made safe. Always returns a usable shape.
 * @param {any} raw
 * @returns {{ projects: object[], currentId: string|null }}
 */
export function cleanData(raw) {
  const seen = new Set();
  const projects = (Array.isArray(raw?.projects) ? raw.projects : []).map(cleanProject).filter((project) => {
    if (!project) return false;
    if (seen.has(project.id)) project.id = makeId();
    seen.add(project.id);
    return true;
  });
  const currentId = projects.some((p) => p.id === raw?.currentId) ? raw.currentId : (projects[0]?.id ?? null);
  return { projects, currentId };
}

/**
 * A new game with the design doc template filled in and no cards.
 * @param {string} name
 * @param {number} [now]
 * @returns {object}
 */
export function newProject(name, now = Date.now()) {
  return cleanProject({
    id: makeId(),
    name,
    createdAt: now,
    updatedAt: now,
    meta: {},
    sections: GDD_TEMPLATE.map((s) => ({ id: makeId(), title: s.title, hint: s.hint, body: '' })),
    cards: [],
  });
}

/**
 * Moves a card to a column, just before another card, or to the end of the column.
 * The order of the array is the order on the board. Returns a new array.
 * @param {object[]} cards
 * @param {string} id
 * @param {string} column
 * @param {string|null} [beforeId]
 * @returns {object[]}
 */
export function placeCard(cards, id, column, beforeId = null) {
  const card = cards.find((c) => c.id === id);
  if (!card || beforeId === id) return cards;
  const rest = cards.filter((c) => c.id !== id);
  const moved = { ...card, column: oneOf(column, COLUMNS, card.column) };
  const at = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1;
  if (at === -1) rest.push(moved);
  else rest.splice(at, 0, moved);
  return rest;
}

/**
 * Swaps a card with its neighbour above or below, counting only the cards that are showing.
 * Returns a new array, or the same one if there's nowhere to go.
 * @param {object[]} cards
 * @param {string} id
 * @param {-1|1} dir
 * @param {(card: object) => boolean} [isShown]
 * @returns {object[]}
 */
export function shiftCard(cards, id, dir, isShown = () => true) {
  const card = cards.find((c) => c.id === id);
  if (!card) return cards;
  const column = cards.filter((c) => c.column === card.column && (c.id === id || isShown(c)));
  const neighbour = column[column.findIndex((c) => c.id === id) + dir];
  if (!neighbour) return cards;
  const rest = cards.filter((c) => c.id !== id);
  const at = rest.findIndex((c) => c.id === neighbour.id);
  rest.splice(dir < 0 ? at : at + 1, 0, card);
  return rest;
}

/**
 * The column next to this one, or null at either end.
 * @param {string} column
 * @param {-1|1} dir
 * @returns {string|null}
 */
export function nextColumn(column, dir) {
  const i = COLUMNS.findIndex((c) => c.id === column);
  return COLUMNS[i + dir]?.id ?? null;
}

/**
 * How many cards are done.
 * @param {object[]} cards
 * @returns {{ done: number, total: number }}
 */
export function progressOf(cards) {
  return { done: cards.filter((c) => c.column === 'done').length, total: cards.length };
}

/**
 * True when a card that isn't done is past its due date.
 * @param {object} card
 * @param {string} today YYYY-MM-DD
 * @returns {boolean}
 */
export function isOverdue(card, today) {
  return Boolean(card.due) && card.column !== 'done' && card.due < today;
}

/**
 * Counts words, for the design doc's table of contents.
 * @param {string} body
 * @returns {number}
 */
export function wordCount(body) {
  const words = String(body).trim().match(/\S+/g);
  return words ? words.length : 0;
}
