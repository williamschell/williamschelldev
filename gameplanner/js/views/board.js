// The to-do board: four columns of sticky notes, one color per discipline.
// Cards move by dragging, or by the arrow buttons on each note (keyboard and touch).

import {
  COLUMNS, DISCIPLINES, LIMITS, PRIORITIES, isOverdue, labelOf, nextColumn, progressOf,
} from '../model.js';
import {
  addCard, currentProject, deleteCard, moveCard, readSetting, restoreCard, shiftCardInColumn, updateCard, writeSetting,
} from '../store.js';
import {
  el, formatDate, icon, iconButton, openDialog, redrawKeepingFocus, toast, today,
} from '../ui.js';

const ALL = { id: 'all', label: 'Everything' };

function select(list, value) {
  return el('select', {}, ...list.map((item) => el('option', { value: item.id, selected: item.id === value }, item.label)));
}

/**
 * The index card for adding or editing a to-do.
 * @param {{ card?: object, column?: string, discipline?: string }} start
 * @returns {Promise<object|'delete'|undefined>} the fields, 'delete', or undefined if cancelled
 */
function editDialog({ card, column = 'todo', discipline = 'design' }) {
  const title = el('input', {
    type: 'text', required: true, maxLength: LIMITS.title, value: card?.title ?? '', autocomplete: 'off',
  });
  const notes = el('textarea', { rows: 4, maxLength: LIMITS.notes, value: card?.notes ?? '' });
  const kind = select(DISCIPLINES, card?.discipline ?? discipline);
  const col = select(COLUMNS, card?.column ?? column);
  const priority = select(PRIORITIES, card?.priority ?? 'normal');
  const due = el('input', { type: 'date', value: card?.due ?? '' });

  return openDialog((close) => [
    el('h2', {}, card ? 'Edit to-do' : 'New to-do'),
    el('form', {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        close({
          title: title.value,
          notes: notes.value,
          discipline: kind.value,
          column: col.value,
          priority: priority.value,
          due: due.value,
        });
      },
    },
    el('label', { class: 'field' }, 'What needs doing?', title),
    el('div', { class: 'field-row' },
      el('label', { class: 'field' }, 'Discipline', kind),
      el('label', { class: 'field' }, 'Column', col)),
    el('div', { class: 'field-row' },
      el('label', { class: 'field' }, 'Priority', priority),
      el('label', { class: 'field' }, 'Due (optional)', due)),
    el('label', { class: 'field' }, 'Notes', notes),
    el('div', { class: 'dialog-actions' },
      card ? el('button', { type: 'button', class: 'button danger push-left', onclick: () => close('delete') }, icon('trash'), 'Delete') : null,
      el('button', { type: 'button', class: 'button', onclick: () => close(undefined) }, 'Cancel'),
      el('button', { type: 'submit', class: 'button primary' }, card ? 'Save' : 'Add'))),
  ], { label: card ? 'Edit to-do' : 'New to-do' });
}

/**
 * @param {HTMLElement} host
 * @param {{ params: { discipline?: string } }} ctx
 */
export function renderBoard(host, ctx) {
  const filter = ctx.params.discipline ?? 'all';
  const isShown = (card) => filter === 'all' || card.discipline === filter;
  const draw = (focus) => redrawKeepingFocus(host, build, focus);
  let dragId = null;
  const marker = el('li', { class: 'drop-marker', 'aria-hidden': 'true' });

  async function add(column) {
    const discipline = filter === 'all' ? readSetting('lastDiscipline', 'design') : filter;
    const fields = await editDialog({ column, discipline });
    if (!fields || fields === 'delete') return;
    const card = addCard(fields);
    if (typeof card === 'string') {
      toast(card);
      return;
    }
    writeSetting('lastDiscipline', card.discipline);
    draw(isShown(card) ? `open:${card.id}` : `add:${column}`);
    if (!isShown(card)) toast(`Added to ${labelOf(DISCIPLINES, card.discipline)}, which isn't showing.`);
  }

  async function edit(card) {
    const fields = await editDialog({ card });
    if (!fields) return;
    if (fields === 'delete') {
      const removed = deleteCard(card.id);
      draw(`add:${card.column}`);
      toast(`Deleted “${card.title}”.`, {
        action: 'Undo',
        onAction: () => {
          restoreCard(removed);
          draw(`open:${card.id}`);
        },
      });
      return;
    }
    const error = updateCard(card.id, fields);
    if (error) toast(error);
    draw(`open:${card.id}`);
  }

  function task(card, siblings) {
    const i = siblings.indexOf(card);
    const left = nextColumn(card.column, -1);
    const right = nextColumn(card.column, 1);
    const overdue = isOverdue(card, today());
    const notes = card.notes.trim();
    const move = (to, key) => {
      moveCard(card.id, to);
      draw(`${key}:${card.id}`);
    };

    const li = el('li', {
      class: `task task-${card.discipline} priority-${card.priority}${card.column === 'done' ? ' done' : ''}`,
      draggable: true,
      'data-card': card.id,
      'data-focus-home': '.task-open',
      ondragstart: (e) => {
        dragId = card.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.title);
        requestAnimationFrame(() => li.classList.add('dragging'));
      },
      ondragend: () => {
        dragId = null;
        li.classList.remove('dragging');
        marker.remove();
        for (const node of host.querySelectorAll('.drop-here')) node.classList.remove('drop-here');
      },
    },
    el('button', {
      type: 'button', class: 'task-open', title: 'Edit', 'data-focus': `open:${card.id}`, onclick: () => edit(card),
    },
    el('span', { class: 'task-kind' }, labelOf(DISCIPLINES, card.discipline)),
    el('span', { class: 'task-title' }, card.title),
    card.column === 'done' ? el('span', { class: 'visually-hidden' }, ' (done)') : null,
    notes ? el('span', { class: 'task-notes' }, notes) : null,
    card.priority !== 'normal' || card.due ? el('span', { class: 'task-meta' },
      card.priority !== 'normal' ? el('span', { class: 'tag' }, `${labelOf(PRIORITIES, card.priority).toLowerCase()} priority`) : null,
      card.due ? el('span', { class: overdue ? 'due overdue' : 'due' }, icon('calendar'), overdue ? `overdue, ${formatDate(card.due)}` : formatDate(card.due)) : null) : null),
    el('div', { class: 'task-moves' },
      iconButton('left', left ? `Move ${card.title} to ${labelOf(COLUMNS, left)}` : 'Already in the first column', () => move(left, 'left'), { disabled: !left, 'data-focus': `left:${card.id}` }),
      iconButton('up', `Move ${card.title} up`, () => {
        shiftCardInColumn(card.id, -1, isShown);
        draw(`up:${card.id}`);
      }, { disabled: i === 0, 'data-focus': `up:${card.id}` }),
      iconButton('down', `Move ${card.title} down`, () => {
        shiftCardInColumn(card.id, 1, isShown);
        draw(`down:${card.id}`);
      }, { disabled: i === siblings.length - 1, 'data-focus': `down:${card.id}` }),
      iconButton('right', right ? `Move ${card.title} to ${labelOf(COLUMNS, right)}` : 'Already in the last column', () => move(right, 'right'), { disabled: !right, 'data-focus': `right:${card.id}` })));
    return li;
  }

  function column(col, project) {
    const cards = project.cards.filter((c) => c.column === col.id && isShown(c));
    const list = el('ul', { class: 'task-list', 'aria-labelledby': `col-${col.id}` }, ...cards.map((card) => task(card, cards)));
    if (cards.length === 0) list.append(el('li', { class: 'task-empty' }, col.id === 'done' ? 'Nothing finished yet' : 'Nothing here'));

    const node = el('section', { class: `column column-${col.id}` },
      el('div', { class: 'column-head' },
        el('h2', { id: `col-${col.id}` }, col.label),
        el('span', { class: 'column-count', 'aria-label': `${cards.length} to-dos` }, String(cards.length))),
      list,
      col.id === 'done' ? null : el('button', {
        type: 'button', class: 'sticky-button add-task', 'data-focus': `add:${col.id}`, onclick: () => add(col.id),
      }, icon('plus'), 'Add'));

    node.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const before = [...list.querySelectorAll('.task:not(.dragging)')].find((item) => {
        const box = item.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      if (before) list.insertBefore(marker, before);
      else list.append(marker);
      node.classList.add('drop-here');
    });
    node.addEventListener('dragleave', (e) => {
      if (node.contains(e.relatedTarget)) return;
      node.classList.remove('drop-here');
      if (marker.parentNode === list) marker.remove();
    });
    node.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      let next = marker.nextElementSibling;
      while (next && !next.dataset.card) next = next.nextElementSibling;
      const id = dragId;
      dragId = null;
      moveCard(id, col.id, next?.dataset.card ?? null);
      draw();
    });
    return node;
  }

  function header(project) {
    const shown = project.cards.filter(isShown);
    const { done, total } = progressOf(shown);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const open = (id) => project.cards.filter((c) => c.column !== 'done' && (id === 'all' || c.discipline === id)).length;
    const heading = filter === 'all' ? 'To-dos' : `${labelOf(DISCIPLINES, filter)} to-dos`;

    return el('section', { class: 'card board-head' },
      el('div', { class: 'view-head' },
        el('h1', {}, heading),
        el('span', { class: 'head-stats' }, total ? `${done} of ${total} done` : 'Nothing yet')),
      el('div', {
        class: 'progress', role: 'progressbar', 'aria-label': 'Done', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct,
      }, el('span', { style: `width: ${pct}%` })),
      el('nav', { class: 'filters', 'aria-label': 'Show to-dos for' }, ...[ALL, ...DISCIPLINES].map((d) => el('a', {
        class: `filter filter-${d.id}`,
        href: d.id === 'all' ? '#/todos' : `#/todos/${d.id}`,
        'aria-current': d.id === filter ? 'page' : null,
      }, d.label, el('span', { class: 'filter-count', 'aria-label': `, ${open(d.id)} open` }, String(open(d.id)))))),
      project.cards.length === 0 ? el('p', { class: 'notice' }, 'Add a to-do with the + under any column. Drag notes between columns, or use the arrows on each note.') : null);
  }

  function build() {
    const project = currentProject();
    return [
      header(project),
      el('div', { class: 'board' }, ...COLUMNS.map((col) => column(col, project))),
    ];
  }

  draw();
}
