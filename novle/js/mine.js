// The Mine view: stories saved on this device, plus backup and restore.

import { currentStreak, emptyStreak, localDateString } from './daily.js';
import { fullPrompt } from './prompts.js';
import {
  deleteStory, getAllStories, putStory, readSetting, writeSetting,
} from './storage.js';
import { countWords, readingTime } from './words.js';
import { downloadStory } from './write.js';
import {
  confirmDialog, el, formatDate, openDialog, toast,
} from './ui.js';

const BACKUP_VERSION = 1;
const EXCERPT_CHARS = 280;

function downloadJson(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Backups can be hand-edited, so only accept the shape we wrote. */
function readChallenge(raw) {
  if (typeof raw?.genre !== 'string' || typeof raw.prompt !== 'string' || !Number.isFinite(raw.wordLimit)) {
    throw new Error('Bad challenge');
  }
  return {
    genre: raw.genre,
    wordLimit: raw.wordLimit,
    prompt: raw.prompt,
    wrinkle: typeof raw.wrinkle === 'string' ? raw.wrinkle : null,
  };
}

function readStory(item) {
  if (typeof item?.id !== 'string' || typeof item.title !== 'string' || typeof item.body !== 'string') {
    throw new Error('Bad record');
  }
  const dailyDate = /^\d{4}-\d{2}-\d{2}$/.test(item.dailyDate ?? '') ? item.dailyDate : null;
  return {
    id: item.id,
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
    isDaily: dailyDate !== null,
    dailyDate,
    label: typeof item.label === 'string' ? item.label : '',
    challenge: readChallenge(item.challenge),
    title: item.title,
    body: item.body,
    wordCount: countWords(item.body),
  };
}

const whereFrom = (record) => {
  if (record.dailyDate) return `Daily prompt, ${formatDate(record.dailyDate)}`;
  return record.label || 'Practice';
};

/**
 * @param {{ root: HTMLElement, openInWriter: (record: object) => Promise<boolean> }} deps
 */
export function createMine({ root, openInWriter }) {
  function exportAll(records) {
    downloadJson({
      app: 'novle',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      streak: readSetting('streak', emptyStreak()),
      stories: records,
    }, `novle-backup-${localDateString()}.json`);
  }

  async function importFile(file) {
    let imported = 0;
    let skipped = 0;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'novle' || !Array.isArray(data.stories)) throw new Error('Wrong file');
      for (const item of data.stories) {
        try {
          if (await putStory(readStory(item))) imported++;
          else skipped++;
        } catch {
          skipped++;
        }
      }
      // A backup only restores the streak on a device that doesn't have a better one.
      const local = readSetting('streak', emptyStreak());
      if (data.streak && Number(data.streak.best) > local.best) {
        writeSetting('streak', {
          lastDate: typeof data.streak.lastDate === 'string' ? data.streak.lastDate : null,
          current: Math.max(0, Number(data.streak.current) || 0),
          best: Number(data.streak.best),
        });
      }
    } catch {
      toast("That doesn't look like a Novle backup.");
      return;
    }
    toast(skipped ? `Imported ${imported}. Skipped ${skipped} that couldn't be read.` : `Imported ${imported}.`);
    await show();
  }

  async function openDetail(record) {
    await openDialog((close) => [
      el('h2', { class: 'reader-title' }, record.title),
      el('p', { class: 'muted' }, `${whereFrom(record)}. ${record.wordCount.toLocaleString()} words, ${readingTime(record.wordCount)}.`),
      el(
        'div',
        { class: 'prompt-quote' },
        el('strong', {}, `${record.challenge.genre}, ${record.challenge.wordLimit.toLocaleString()} words. `),
        fullPrompt(record.challenge),
      ),
      el('div', { class: 'story-text' }, record.body),
      el(
        'div',
        { class: 'dialog-actions wrap' },
        el('button', {
          type: 'button',
          class: 'button danger',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Delete this story?',
              body: "It's only stored on this device, so this can't be undone. A copy you posted stays in the gallery.",
              confirm: 'Delete',
              danger: true,
            });
            if (ok && (await deleteStory(record.id))) {
              close();
              await show();
            }
          },
        }, 'Delete'),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'button', onclick: () => downloadStory(record.title, record.body.trim()) }, 'Download'),
        el('button', {
          type: 'button',
          class: 'button primary',
          onclick: async () => {
            if (await openInWriter(record)) {
              close();
              window.location.hash = '#/write';
            }
          },
        }, 'Keep writing'),
        el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Close'),
      ),
    ], { wide: true, label: record.title });
  }

  async function show() {
    const records = await getAllStories();
    const streak = readSetting('streak', emptyStreak());
    const days = currentStreak(streak, localDateString());
    const fileInput = el('input', {
      type: 'file',
      accept: 'application/json,.json',
      class: 'visually-hidden',
      'aria-label': 'Choose a backup file',
      onchange: (e) => {
        const [file] = e.target.files;
        if (file) importFile(file);
        e.target.value = '';
      },
    });

    const head = el(
      'div',
      { class: 'view-head' },
      el(
        'div',
        {},
        el('h1', {}, 'My stories'),
        el('p', { class: 'muted' }, `Stored on this device only. Current streak: ${days}. Best: ${streak.best}.`),
      ),
      el(
        'div',
        { class: 'row' },
        el('button', {
          type: 'button',
          class: 'button',
          disabled: records.length === 0,
          onclick: () => exportAll(records),
        }, 'Export all'),
        el('button', { type: 'button', class: 'button', onclick: () => fileInput.click() }, 'Import'),
        fileInput,
      ),
    );

    const body = records.length === 0
      ? el(
        'div',
        { class: 'empty' },
        el('h2', {}, 'Nothing here yet'),
        el('p', {}, 'Write a story and press Save, and it will show up here.'),
        el('a', { class: 'button primary', href: '#/write' }, 'Start writing'),
      )
      : el('div', { class: 'card-grid' }, ...records.map((record) => el(
        'button',
        { type: 'button', class: 'card story-button', onclick: () => openDetail(record) },
        el('span', { class: 'card-title' }, record.title),
        el('span', { class: 'card-excerpt' }, record.body.slice(0, EXCERPT_CHARS).replace(/\s+/g, ' ')),
        el('span', { class: 'card-sub' }, `${whereFrom(record)}. ${record.wordCount.toLocaleString()} words.`),
      )));

    root.replaceChildren(head, body);
  }

  return { show };
}
