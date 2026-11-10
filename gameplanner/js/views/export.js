// Export: to-do lists in a few formats, the design doc as Markdown, and backups.

import {
  FORMATS, exportTodos, fileSlug, gddToMarkdown, selectCards, todosToText,
} from '../export.js';
import { COLUMNS, DISCIPLINES } from '../model.js';
import {
  currentProject, makeBackup, readBackup, readSetting, restoreBackup, writeSetting,
} from '../store.js';
import {
  copyText, download, el, icon, openDialog, printText, redrawKeepingFocus, segmented, toast, today,
} from '../ui.js';

const DEFAULTS = {
  disciplines: DISCIPLINES.map((d) => d.id),
  columns: ['backlog', 'todo', 'doing'],
  groupBy: 'discipline',
  format: 'markdown',
  notes: true,
};

/** The saved export choices, checked so a stale or edited value can't break anything. */
function loadOptions() {
  const saved = readSetting('export', {}) ?? {};
  const pickIds = (value, list, fallback) => (Array.isArray(value) ? value.filter((id) => list.some((item) => item.id === id)) : fallback);
  return {
    disciplines: pickIds(saved.disciplines, DISCIPLINES, DEFAULTS.disciplines),
    columns: pickIds(saved.columns, COLUMNS, DEFAULTS.columns),
    groupBy: saved.groupBy === 'column' ? 'column' : 'discipline',
    format: FORMATS.some((f) => f.id === saved.format) ? saved.format : DEFAULTS.format,
    notes: typeof saved.notes === 'boolean' ? saved.notes : DEFAULTS.notes,
  };
}

async function copy(contents) {
  toast(await copyText(contents) ? 'Copied.' : 'Couldn\'t copy. Try downloading instead.');
}

/**
 * @param {HTMLElement} host
 * @param {{ chrome: () => void }} ctx
 */
export function renderExport(host, ctx) {
  const options = loadOptions();
  const draw = (focus) => redrawKeepingFocus(host, build, focus);
  const set = (changes) => {
    Object.assign(options, changes);
    writeSetting('export', options);
    draw();
  };

  function checkboxes(legend, list, key, counts) {
    return el('fieldset', { class: 'choice-set' },
      el('legend', {}, legend),
      el('div', { class: 'check-row' }, ...list.map((item) => el('label', { class: 'check-field' },
        el('input', {
          type: 'checkbox',
          checked: options[key].includes(item.id),
          'data-focus': `${key}:${item.id}`,
          onchange: (e) => set({
            [key]: list.map((x) => x.id).filter((id) => (id === item.id ? e.target.checked : options[key].includes(id))),
          }),
        }),
        item.label,
        el('span', { class: 'muted small' }, `(${counts(item.id)})`)))));
  }

  function todoSection(project) {
    const cards = selectCards(project.cards, options);
    const format = FORMATS.find((f) => f.id === options.format);
    const output = exportTodos(options.format, project.name, cards, options);
    const which = options.disciplines.length === 1 ? `-${options.disciplines[0]}` : '';
    const name = `${fileSlug(project.name)}-todos${which}-${today()}.${format.ext}`;
    const inColumns = (c) => options.columns.includes(c.column);
    const ofKind = (c) => options.disciplines.includes(c.discipline);

    return el('section', { class: 'card' },
      el('h2', {}, 'To-do lists'),
      el('div', { class: 'row quick', role: 'group', 'aria-label': 'Quick pick' },
        el('span', { class: 'muted' }, 'Quick pick:'),
        ...[{ id: 'all', label: 'Everything' }, ...DISCIPLINES].map((d) => {
          const ids = d.id === 'all' ? DISCIPLINES.map((x) => x.id) : [d.id];
          const on = ids.length === options.disciplines.length && ids.every((id) => options.disciplines.includes(id));
          return el('button', {
            type: 'button',
            class: `chip chip-${d.id}`,
            'aria-pressed': String(on),
            'data-focus': `quick:${d.id}`,
            onclick: () => set({ disciplines: ids }),
          }, d.id === 'all' ? 'Everything' : `Just ${d.label.toLowerCase()}`);
        })),
      el('div', { class: 'export-options' },
        checkboxes('Disciplines', DISCIPLINES, 'disciplines', (id) => project.cards.filter((c) => c.discipline === id && inColumns(c)).length),
        checkboxes('Columns', COLUMNS, 'columns', (id) => project.cards.filter((c) => c.column === id && ofKind(c)).length),
        el('div', { class: 'field' }, el('span', {}, 'Group by'), segmented({
          label: 'Group by',
          value: options.groupBy,
          focusKey: 'group',
          options: [{ value: 'discipline', label: 'Discipline' }, { value: 'column', label: 'Column' }],
          onChange: (groupBy) => set({ groupBy }),
        })),
        el('div', { class: 'field' }, el('span', {}, 'Format'), segmented({
          label: 'Format',
          value: options.format,
          focusKey: 'format',
          options: FORMATS.map((f) => ({ value: f.id, label: f.label })),
          onChange: (value) => set({ format: value }),
        })),
        el('label', { class: 'check-field' },
          el('input', {
            type: 'checkbox', checked: options.notes, 'data-focus': 'notes', onchange: (e) => set({ notes: e.target.checked }),
          }),
          'Include notes')),
      el('p', { class: 'muted small' }, `${cards.length} to-do${cards.length === 1 ? '' : 's'} in this list.`),
      el('pre', {
        class: 'preview', tabIndex: 0, 'aria-label': 'Preview of the export',
      }, output),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'button small primary', onclick: () => copy(output) }, icon('copy'), 'Copy'),
        el('button', { type: 'button', class: 'button small', onclick: () => download(name, output, format.mime) }, icon('download'), 'Download'),
        el('button', {
          type: 'button',
          class: 'button small',
          onclick: () => printText(`${project.name}: to-dos`, todosToText(project.name, cards, options).split('\n').slice(3).join('\n')),
        }, icon('print'), 'Print')));
  }

  function gddSection(project) {
    const markdown = () => gddToMarkdown(project);
    return el('section', { class: 'card' },
      el('h2', {}, 'Design doc'),
      el('p', { class: 'muted small' }, 'The whole GDD as Markdown, which GitHub, Notion, Obsidian and Google Docs can all read. Empty sections are left out.'),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'button small', onclick: () => copy(markdown()) }, icon('copy'), 'Copy'),
        el('button', {
          type: 'button', class: 'button small', onclick: () => download(`${fileSlug(project.name)}-gdd-${today()}.md`, markdown(), 'text/markdown'),
        }, icon('download'), 'Download .md'),
        el('button', {
          type: 'button', class: 'button small', onclick: () => printText(project.name, markdown().split('\n').slice(2).join('\n')),
        }, icon('print'), 'Print')));
  }

  function backupSection() {
    const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const [file] = input.files;
      input.value = '';
      if (!file) return;
      let read;
      try {
        read = readBackup(JSON.parse(await file.text()));
      } catch {
        read = { error: 'That isn\'t a Game Planner backup file.' };
      }
      if ('error' in read) {
        toast(read.error);
        return;
      }
      let replace = false;
      if (read.clashes > 0) {
        const answer = await openDialog((close) => [
          el('h2', {}, 'Some of these are already here'),
          el('p', {}, `${read.clashes} of the games in this backup ${read.clashes === 1 ? 'is' : 'are'} already in this browser. Replace ${read.clashes === 1 ? 'it' : 'them'} with the backup, or keep both?`),
          el('div', { class: 'dialog-actions' },
            el('button', { type: 'button', class: 'button', onclick: () => close(undefined) }, 'Cancel'),
            el('button', { type: 'button', class: 'button', onclick: () => close('keep') }, 'Keep both'),
            el('button', { type: 'button', class: 'button danger', onclick: () => close('replace') }, 'Replace')),
        ], { label: 'Restore a backup' });
        if (!answer) return;
        replace = answer === 'replace';
      }
      const count = restoreBackup(read.incoming, replace);
      toast(`Restored ${count} game${count === 1 ? '' : 's'}.`);
      ctx.chrome();
      draw();
    });

    return el('section', { class: 'card' },
      el('h2', {}, 'Backup'),
      el('p', { class: 'muted small' }, 'Everything lives in this browser. Save a file now and then to keep it safe, or to move it to another computer.'),
      el('div', { class: 'row' },
        el('button', {
          type: 'button',
          class: 'button small',
          onclick: () => download(`game-planner-backup-${today()}.json`, JSON.stringify(makeBackup(), null, 2), 'application/json'),
        }, icon('download'), 'Save a backup'),
        el('button', { type: 'button', class: 'button small', onclick: () => input.click() }, icon('upload'), 'Restore'),
        input));
  }

  function build() {
    const project = currentProject();
    return [
      el('section', { class: 'card' },
        el('h1', {}, 'Export'),
        el('p', { class: 'muted' }, `From “${project.name}”. To export another game, open it from Games first.`)),
      todoSection(project),
      gddSection(project),
      backupSection(),
    ];
  }

  draw();
}
