// The design doc: an index card with the game's vital facts, then a page of sections.
// Everything saves as it's typed, so this view only redraws when sections are added,
// removed or moved.

import {
  LIMITS, META_FIELDS, STAGES, cleanName, wordCount,
} from '../model.js';
import {
  addSection, currentProject, moveSection, removeSection, renameProject, restoreSection, setMeta, setSection,
} from '../store.js';
import {
  autoGrow, el, icon, iconButton, redrawKeepingFocus, toast,
} from '../ui.js';

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {HTMLElement} host
 * @param {{ chrome: () => void }} ctx
 */
export function renderGdd(host, ctx) {
  // Live bits of the contents list, updated while typing without a redraw.
  let tocTitles = new Map();
  let tocCounts = new Map();
  let totalCount = null;

  const draw = (focus) => redrawKeepingFocus(host, build, focus);

  const updateTotal = () => {
    const total = currentProject().sections.reduce((sum, s) => sum + wordCount(s.body), 0);
    if (totalCount) totalCount.textContent = plural(total, 'word');
  };

  function overview(project) {
    const name = el('input', {
      type: 'text',
      class: 'title-input',
      value: project.name,
      maxLength: LIMITS.name,
      placeholder: 'Working title',
      'aria-label': 'Game title',
      autocomplete: 'off',
      'data-focus': 'name',
      oninput: () => {
        if (!cleanName(name.value)) return;
        renameProject(project.id, name.value);
        ctx.chrome();
      },
      onblur: () => {
        if (!cleanName(name.value)) name.value = currentProject().name;
      },
    });

    const stage = el('select', {
      'data-focus': 'stage',
      onchange: () => setMeta('stage', stage.value),
    }, ...STAGES.map((s) => el('option', { value: s, selected: s === project.meta.stage }, s)));

    const fields = META_FIELDS.map((field) => el('label', { class: field.id === 'pitch' ? 'field wide' : 'field' },
      field.label,
      el('input', {
        type: 'text',
        value: project.meta[field.id],
        maxLength: LIMITS.meta,
        placeholder: field.placeholder,
        autocomplete: 'off',
        'data-focus': `meta:${field.id}`,
        oninput: (e) => setMeta(field.id, e.target.value),
      })));

    return el('section', { class: 'index-card overview', 'aria-label': 'Overview' },
      el('p', { class: 'kicker' }, 'Game design document'),
      name,
      el('div', { class: 'meta-grid' }, fields[0], el('label', { class: 'field' }, 'Stage', stage), ...fields.slice(1)));
  }

  function contents(project) {
    tocTitles = new Map();
    tocCounts = new Map();
    totalCount = el('span', {});
    const items = project.sections.map((section) => {
      const title = el('span', {}, section.title.trim() || 'Untitled section');
      const count = el('span', { class: 'toc-count' }, wordCount(section.body) ? plural(wordCount(section.body), 'word') : 'empty');
      tocTitles.set(section.id, title);
      tocCounts.set(section.id, count);
      return el('li', {},
        el('button', {
          type: 'button',
          class: 'link-button toc-link',
          onclick: () => {
            const target = document.getElementById(`section-${section.id}`);
            target?.scrollIntoView({ block: 'start' });
            target?.querySelector('textarea')?.focus({ preventScroll: true });
          },
        }, title),
        count);
    });
    const node = el('nav', { class: 'card toc', 'aria-label': 'Contents' },
      el('h2', {}, 'Contents'),
      items.length ? el('ol', {}, ...items) : el('p', { class: 'muted' }, 'No sections yet.'),
      el('p', { class: 'muted small' }, totalCount, ' so far. Everything saves in this browser as you type.'));
    updateTotal();
    return node;
  }

  function section(s, index, count) {
    const label = () => s.title.trim() || 'this section';
    const title = el('input', {
      type: 'text',
      class: 'gdd-title',
      value: s.title,
      maxLength: LIMITS.sectionTitle,
      placeholder: 'Section title',
      'aria-label': 'Section title',
      autocomplete: 'off',
      'data-focus': `title:${s.id}`,
      oninput: () => {
        setSection(s.id, { title: title.value });
        s.title = title.value;
        const toc = tocTitles.get(s.id);
        if (toc) toc.textContent = title.value.trim() || 'Untitled section';
      },
    });
    const body = el('textarea', {
      class: 'lined',
      value: s.body,
      rows: 3,
      maxLength: LIMITS.sectionBody,
      placeholder: s.hint || 'Write here…',
      'aria-label': s.title.trim() || 'Section text',
      'data-focus': `body:${s.id}`,
      oninput: () => {
        setSection(s.id, { body: body.value });
        const words = wordCount(body.value);
        const toc = tocCounts.get(s.id);
        if (toc) toc.textContent = words ? plural(words, 'word') : 'empty';
        updateTotal();
      },
    });
    autoGrow(body);

    return el('section', { class: 'gdd-section', id: `section-${s.id}` },
      el('div', { class: 'gdd-head' },
        title,
        el('div', { class: 'gdd-actions' },
          iconButton('up', `Move ${label()} up`, () => {
            moveSection(s.id, -1);
            draw();
          }, { disabled: index === 0, 'data-focus': `up:${s.id}` }),
          iconButton('down', `Move ${label()} down`, () => {
            moveSection(s.id, 1);
            draw();
          }, { disabled: index === count - 1, 'data-focus': `down:${s.id}` }),
          iconButton('trash', `Remove ${label()}`, () => {
            const removed = removeSection(s.id);
            if (!removed) return;
            draw('add-section');
            toast(`Removed ${s.title.trim() || 'the section'}.`, {
              action: 'Undo',
              onAction: () => {
                restoreSection(removed);
                draw(`title:${s.id}`);
              },
            });
          }))),
      body);
  }

  function build() {
    const project = currentProject();
    return [
      overview(project),
      contents(project),
      ...project.sections.map((s, i) => section(s, i, project.sections.length)),
      el('button', {
        type: 'button',
        class: 'sticky-button add-section',
        'data-focus': 'add-section',
        onclick: () => {
          const added = addSection('New section');
          draw(`title:${added.id}`);
          host.querySelector(`[data-focus="title:${added.id}"]`)?.select();
        },
      }, icon('plus'), 'Add a section'),
    ];
  }

  draw();
}
