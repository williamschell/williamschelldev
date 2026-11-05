// The Mine view: art saved on this device, plus backup and restore.

import { GEN_VERSION, generateBlob } from './blob.js';
import { getAllArtworks, putArtwork, deleteArtwork, readSetting, writeSetting } from './storage.js';
import { downloadArt, downloadBlob, renderPanel } from './export.js';
import { composeMatrix, normalizeTransform, toSvgMatrix } from './transform.js';
import { currentStreak, emptyStreak, localDateString } from './daily.js';
import {
  el, toast, confirmDialog, openDialog, formatDate,
} from './ui.js';

const BACKUP_VERSION = 1;
const THUMB_SIZE = 384;

/** Reads a blob into a data URL, for the backup file. */
const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Turns a backup's image back into a blob. Only accepts inline images. */
async function fromDataUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('data:image/')) throw new Error('Not an image');
  return (await fetch(url)).blob();
}

/** The saved path, or a regenerated one for old records that don't have it. */
function pathFor(record) {
  if (record.pathData) return record.pathData;
  return generateBlob({ seed: record.seed, params: record.params, genVersion: record.genVersion ?? GEN_VERSION }).pathData;
}

/**
 * @param {{ root: HTMLElement, openInStudio: (record: object) => Promise<boolean> }} deps
 */
export function createMine({ root, openInStudio }) {
  /** Object URLs for the current grid, released on each re-render. */
  let urls = [];

  function urlFor(blob) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  }

  async function exportAll(records) {
    try {
      const artworks = await Promise.all(records.map(async (r) => ({
        ...r,
        drawingPng: await toDataUrl(r.drawingPng),
        thumbPng: await toDataUrl(r.thumbPng),
      })));
      const payload = {
        app: 'splotchio',
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        streak: readSetting('streak', emptyStreak()),
        artworks,
      };
      downloadBlob(
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        `splotchio-backup-${localDateString()}.json`,
      );
    } catch {
      toast("Couldn't build the backup.");
    }
  }

  async function importFile(file) {
    let imported = 0;
    let skipped = 0;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'splotchio' || !Array.isArray(data.artworks)) throw new Error('Wrong file');
      for (const item of data.artworks) {
        try {
          if (typeof item.id !== 'string' || typeof item.seed !== 'string') throw new Error('Bad record');
          const saved = await putArtwork({
            ...item,
            createdAt: Number(item.createdAt) || Date.now(),
            drawingPng: await fromDataUrl(item.drawingPng),
            thumbPng: await fromDataUrl(item.thumbPng),
          });
          if (saved) imported++;
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
      toast("That doesn't look like a Splotchio backup.");
      return;
    }
    toast(skipped ? `Imported ${imported}. Skipped ${skipped} that couldn't be read.` : `Imported ${imported}.`);
    await show();
  }

  /** Builds the artwork as it was saved, as a canvas plus the fields export needs. */
  async function loadArt(record) {
    const drawing = await createImageBitmap(record.drawingPng);
    return {
      pathData: pathFor(record),
      transform: normalizeTransform(record.transform),
      blobStyle: record.blobStyle,
      drawing,
    };
  }

  async function openDetail(record) {
    let art;
    try {
      art = await loadArt(record);
    } catch {
      toast("Couldn't open that artwork.");
      return;
    }
    const panelSize = 720;
    const artPanel = renderPanel(art, panelSize);
    const blobSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    blobSvg.setAttribute('viewBox', '0 0 1024 1024');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', toSvgMatrix(composeMatrix(art.transform, 1024)));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', art.pathData);
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('fill', art.blobStyle.color);
    g.append(path);
    blobSvg.append(g);

    await openDialog((close) => {
      const titleInput = el('input', {
        type: 'text',
        value: record.title,
        maxLength: 60,
        'aria-label': 'Title',
        class: 'title-input',
        onchange: async (e) => {
          const title = e.target.value.trim();
          if (!title) {
            e.target.value = record.title;
            return;
          }
          record.title = title;
          await putArtwork(record);
          await show();
        },
      });
      return [
        titleInput,
        el(
          'p',
          { class: 'muted' },
          record.isDaily && record.dailyDate ? `Daily blob, ${formatDate(record.dailyDate)}` : 'Free play',
          `. Saved ${new Date(record.updatedAt ?? record.createdAt).toLocaleString()}.`,
        ),
        el('div', { class: 'pair pair-large' }, el('div', { class: 'pair-cell' }, blobSvg), el('div', { class: 'pair-cell' }, artPanel)),
        el(
          'div',
          { class: 'dialog-actions wrap' },
          el('button', {
            type: 'button',
            class: 'button danger',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this artwork?',
                body: "It's only stored on this device, so this can't be undone.",
                confirm: 'Delete',
                danger: true,
              });
              if (ok && (await deleteArtwork(record.id))) {
                close();
                await show();
              }
            },
          }, 'Delete'),
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'button', onclick: () => downloadArt('png', art, record.title) }, 'PNG'),
          el('button', { type: 'button', class: 'button', onclick: () => downloadArt('side', art, record.title) }, 'Side by side'),
          el('button', { type: 'button', class: 'button', onclick: () => downloadArt('svg', art, record.title) }, 'Blob SVG'),
          el('button', {
            type: 'button',
            class: 'button primary',
            onclick: async () => {
              if (await openInStudio(record)) {
                close();
                window.location.hash = '#/draw';
              }
            },
          }, 'Keep drawing'),
          el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Close'),
        ),
      ];
    }, { wide: true, label: record.title });
    art.drawing.close?.();
  }

  async function show() {
    const records = await getAllArtworks();
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];

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
        el('h1', {}, 'My gallery'),
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
        el('p', {}, 'Draw on a blob and press Save, and it will show up here.'),
        el('a', { class: 'button primary', href: '#/draw' }, 'Start drawing'),
      )
      : el('div', { class: 'thumb-grid' }, ...records.map((record) => el(
        'button',
        {
          type: 'button',
          class: 'thumb',
          onclick: () => openDetail(record),
        },
        el('img', {
          src: urlFor(record.thumbPng),
          alt: record.title,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          loading: 'lazy',
        }),
        el('span', { class: 'thumb-title' }, record.title),
      )));

    root.replaceChildren(head, body);
  }

  return { show };
}
