// Everything is kept in this browser's localStorage, under the prefix gameplanner:.
// Changes are saved a moment after they happen, and right away when the page is hidden.

import {
  cleanCard, cleanData, cleanName, cleanProject, cleanSection, makeId, newProject, placeCard, shiftCard,
} from './model.js';

const PREFIX = 'gameplanner:';
const DATA_KEY = 'data';

/** @type {{ projects: object[], currentId: string|null }} */
let data = { projects: [], currentId: null };
let saveTimer = null;
let reportError = () => {};
let externalChange = () => {};

/** @param {(message: string) => void} fn */
export function onStorageError(fn) { reportError = fn; }

/** Called when another tab saves, after this one has picked up the change. @param {() => void} fn */
export function onExternalChange(fn) { externalChange = fn; }

/**
 * Reads a saved value. Never throws.
 * @param {string} key
 * @param {any} fallback
 * @returns {any}
 */
export function readSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Saves a value. Never throws; reports a failure instead.
 * @param {string} key
 * @param {any} value
 * @returns {boolean}
 */
export function writeSetting(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    reportError('Couldn\'t save in this browser. It may be full or in private mode, so save a backup from Export.');
    return false;
  }
}

/** Makes sure there's always a game to work on. */
function ensureProject() {
  if (data.projects.length === 0) {
    const project = newProject('My game');
    data.projects.push(project);
    data.currentId = project.id;
    scheduleSave();
  }
  if (!data.projects.some((p) => p.id === data.currentId)) data.currentId = data.projects[0].id;
}

/** Saves whatever is waiting to be saved. */
export function flush() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeSetting(DATA_KEY, data);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

/** Records that the current game changed and saves soon. */
function touch(project = currentProject()) {
  project.updatedAt = Date.now();
  scheduleSave();
}

/** Loads saved data. Call once at startup. */
export function initStore() {
  data = cleanData(readSetting(DATA_KEY, null));
  ensureProject();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
  // Another tab saved. Its copy wins, unless this tab has a change of its own waiting.
  window.addEventListener('storage', (e) => {
    if (e.key !== PREFIX + DATA_KEY || saveTimer !== null) return;
    data = cleanData(readSetting(DATA_KEY, null));
    ensureProject();
    externalChange();
  });
}

// Games

/** @returns {object[]} */
export function projects() { return data.projects; }

/** @returns {object} */
export function currentProject() {
  return data.projects.find((p) => p.id === data.currentId) ?? data.projects[0];
}

/** @param {string} id */
export function openProject(id) {
  if (!data.projects.some((p) => p.id === id)) return;
  data.currentId = id;
  scheduleSave();
}

/**
 * Starts a new game and opens it.
 * @param {string} name
 * @returns {object|string} the game, or an error to show
 */
export function createProject(name) {
  if (!cleanName(name)) return 'Give it a name first.';
  const project = newProject(name);
  data.projects.unshift(project);
  data.currentId = project.id;
  scheduleSave();
  return project;
}

/** @param {string} id @param {string} name @returns {string|null} an error, or null */
export function renameProject(id, name) {
  const project = data.projects.find((p) => p.id === id);
  const clean = cleanName(name);
  if (!project) return 'That game is gone.';
  if (!clean) return 'Give it a name first.';
  project.name = clean;
  touch(project);
  return null;
}

/** Deletes a game. If it was the last one, a fresh one takes its place. @param {string} id */
export function deleteProject(id) {
  data.projects = data.projects.filter((p) => p.id !== id);
  ensureProject();
  scheduleSave();
}

// The design doc

/** @param {string} key @param {string} value */
export function setMeta(key, value) {
  const project = currentProject();
  project.meta[key] = String(value);
  touch(project);
}

/** @param {string} id @param {{ title?: string, body?: string }} changes */
export function setSection(id, changes) {
  const section = currentProject().sections.find((s) => s.id === id);
  if (!section) return;
  Object.assign(section, cleanSection({ ...section, ...changes }), { id });
  touch();
}

/** @param {string} title @returns {object} the new section */
export function addSection(title = 'New section') {
  const section = cleanSection({ id: makeId(), title, body: '' });
  currentProject().sections.push(section);
  touch();
  return section;
}

/** @param {string} id @returns {{ section: object, index: number }|null} what's needed to undo */
export function removeSection(id) {
  const project = currentProject();
  const index = project.sections.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const [section] = project.sections.splice(index, 1);
  touch(project);
  return { section, index };
}

/** @param {{ section: object, index: number }} removed */
export function restoreSection({ section, index }) {
  const project = currentProject();
  project.sections.splice(Math.min(index, project.sections.length), 0, section);
  touch(project);
}

/** @param {string} id @param {-1|1} dir */
export function moveSection(id, dir) {
  const { sections } = currentProject();
  const i = sections.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= sections.length) return;
  [sections[i], sections[j]] = [sections[j], sections[i]];
  touch();
}

// To-dos

/** @param {object} fields @returns {object|string} the card, or an error to show */
export function addCard(fields) {
  const now = Date.now();
  const card = cleanCard({
    ...fields, id: makeId(), createdAt: now, updatedAt: now,
  });
  if (!card) return 'Give the to-do a title.';
  const project = currentProject();
  project.cards = placeCard([...project.cards, card], card.id, card.column);
  touch(project);
  return card;
}

/** @param {string} id @param {object} fields @returns {string|null} an error, or null */
export function updateCard(id, fields) {
  const project = currentProject();
  const old = project.cards.find((c) => c.id === id);
  if (!old) return 'That to-do is gone.';
  const card = cleanCard({ ...old, ...fields, id, updatedAt: Date.now() });
  if (!card) return 'Give the to-do a title.';
  // A card that changes column goes to the end of its new one.
  project.cards = old.column === card.column
    ? project.cards.map((c) => (c.id === id ? card : c))
    : placeCard(project.cards.map((c) => (c.id === id ? card : c)), id, card.column);
  touch(project);
  return null;
}

/** @param {string} id @returns {{ card: object, index: number }|null} what's needed to undo */
export function deleteCard(id) {
  const project = currentProject();
  const index = project.cards.findIndex((c) => c.id === id);
  if (index === -1) return null;
  const card = project.cards[index];
  project.cards = project.cards.filter((c) => c.id !== id);
  touch(project);
  return { card, index };
}

/** @param {{ card: object, index: number }} removed */
export function restoreCard({ card, index }) {
  const project = currentProject();
  const cards = [...project.cards];
  cards.splice(Math.min(index, cards.length), 0, card);
  project.cards = cards;
  touch(project);
}

/** @param {string} id @param {string} column @param {string|null} [beforeId] */
export function moveCard(id, column, beforeId = null) {
  const project = currentProject();
  project.cards = placeCard(project.cards, id, column, beforeId)
    .map((c) => (c.id === id ? { ...c, updatedAt: Date.now() } : c));
  touch(project);
}

/** @param {string} id @param {-1|1} dir @param {(card: object) => boolean} isShown */
export function shiftCardInColumn(id, dir, isShown) {
  const project = currentProject();
  project.cards = shiftCard(project.cards, id, dir, isShown);
  touch(project);
}

// Backups

/** @returns {object} everything, ready to save as JSON */
export function makeBackup() {
  flush();
  return { app: 'gameplanner', version: 1, savedAt: new Date().toISOString(), projects: data.projects };
}

/**
 * Reads a backup file's games.
 * @param {any} raw parsed JSON
 * @returns {{ incoming: object[], clashes: number }|{ error: string }}
 */
export function readBackup(raw) {
  if (!raw || raw.app !== 'gameplanner' || !Array.isArray(raw.projects)) return { error: 'That isn\'t a Game Planner backup file.' };
  const incoming = raw.projects.map(cleanProject).filter(Boolean);
  if (incoming.length === 0) return { error: 'That backup has no games in it.' };
  const clashes = incoming.filter((p) => data.projects.some((q) => q.id === p.id)).length;
  return { incoming, clashes };
}

/**
 * Adds games from a backup. Ones already here are replaced, or kept alongside as copies.
 * @param {object[]} incoming from readBackup
 * @param {boolean} replace
 * @returns {number} how many games came in
 */
export function restoreBackup(incoming, replace) {
  for (const project of incoming) {
    const at = data.projects.findIndex((p) => p.id === project.id);
    if (at === -1) data.projects.push(project);
    else if (replace) data.projects[at] = project;
    else data.projects.push({ ...project, id: makeId(), name: cleanName(`${project.name} (restored)`) });
  }
  scheduleSave();
  return incoming.length;
}
