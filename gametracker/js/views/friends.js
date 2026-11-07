// The Friends view: joining, your name and code, and your friends list.

import { friendlyError, getBackend } from '../backend.js';
import { markAllUnsynced, syncNow } from '../store.js';
import {
  confirmDialog, el, icon, toast,
} from '../ui.js';
import { notSetUp } from './common.js';

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    // Clipboard access can be refused, and showing the text lets them copy it by hand.
    toast(text);
  }
}

const inviteLink = (code) => {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/add/${code}`;
};

function joinForm(backend, onJoined, pendingCode) {
  const name = el('input', {
    type: 'text', maxLength: 24, value: backend.randomDisplayName(), autocomplete: 'off',
  });
  const isPublic = el('input', { type: 'checkbox', checked: true });
  const submit = el('button', { type: 'submit', class: 'button primary' }, 'Start comparing');

  return el('section', { class: 'card' },
    el('h1', {}, 'Compare with friends'),
    pendingCode ? el('p', { class: 'notice' }, 'Pick a name first, and we\'ll add your friend right after.') : null,
    el('p', {}, 'There\'s no signup. Choosing a name creates a player tied to this browser.'),
    el('p', { class: 'muted small' }, 'Your scores from the past week get sent to the database, and so does each score you log after this. Grids and share text stay here. A different browser or device counts as a different player.'),
    el('form', {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        const value = name.value.trim();
        const problem = backend.displayNameError(value);
        if (problem) {
          toast(problem);
          return;
        }
        submit.disabled = true;
        try {
          await backend.join(value, isPublic.checked);
          await syncNow();
          onJoined();
        } catch (err) {
          console.warn('Streakle join:', err);
          toast(friendlyError(err));
          submit.disabled = false;
        }
      },
    },
    el('label', { class: 'field' }, 'Your name', name),
    el('label', { class: 'check-field' }, isPublic, el('span', {}, 'Also show me on Everyone boards')),
    submit));
}

function accountCard(backend, account, redraw) {
  const name = el('input', {
    type: 'text', maxLength: 24, value: account.name, autocomplete: 'off', 'aria-label': 'Your name',
  });
  const isPublic = el('input', {
    type: 'checkbox',
    checked: account.publicBoard,
    onchange: async () => {
      try {
        await backend.updateAccount(account.name, isPublic.checked);
        toast(isPublic.checked ? 'You\'ll show on Everyone boards.' : 'Only your friends can see your scores now.');
      } catch (err) {
        isPublic.checked = !isPublic.checked;
        toast(friendlyError(err));
      }
    },
  });

  return el('section', { class: 'card' },
    el('h2', {}, 'You'),
    el('form', {
      class: 'row',
      onsubmit: async (e) => {
        e.preventDefault();
        const value = name.value.trim();
        const problem = backend.displayNameError(value);
        if (problem) {
          toast(problem);
          return;
        }
        try {
          await backend.updateAccount(value, isPublic.checked);
          toast('Name saved.');
          redraw();
        } catch (err) {
          toast(friendlyError(err));
        }
      },
    }, name, el('button', { type: 'submit', class: 'button small' }, 'Save')),
    el('label', { class: 'check-field' }, isPublic, el('span', {}, 'Show me on Everyone boards')),
    el('h2', {}, 'Your friend code'),
    el('p', { class: 'friend-code' }, account.code),
    el('p', { class: 'muted small' }, 'Anyone with this code or link can become your friend straight away, so share it with people you know.'),
    el('div', { class: 'row' },
      el('button', {
        type: 'button',
        class: 'button primary small',
        onclick: () => copy(inviteLink(account.code), 'Invite link copied.'),
      }, icon('copy'), 'Copy invite link'),
      el('button', {
        type: 'button',
        class: 'button small',
        onclick: async () => {
          const sure = await confirmDialog({
            title: 'Change your code?',
            body: 'Old links and your old code will stop working. You\'ll keep the friends you have.',
            confirm: 'Change code',
          });
          if (!sure) return;
          try {
            await backend.rotateCode();
            redraw();
          } catch (err) {
            toast(friendlyError(err));
          }
        },
      }, 'Change code')));
}

function addFriendCard(backend, redraw, pendingCode) {
  const field = el('input', {
    type: 'text', maxLength: 10, value: pendingCode ?? '', placeholder: 'Friend code', autocomplete: 'off', spellcheck: false, 'aria-label': 'Friend code',
  });
  return el('section', { class: 'card' },
    el('h2', {}, 'Add a friend'),
    el('form', {
      class: 'row',
      onsubmit: async (e) => {
        e.preventDefault();
        const code = field.value.trim();
        if (!code) return;
        try {
          const name = await backend.addFriend(code);
          toast(`You and ${name} are friends.`);
          if (window.location.hash.startsWith('#/add/')) {
            window.history.replaceState(null, '', '#/friends');
          }
          redraw();
        } catch (err) {
          toast(friendlyError(err));
        }
      },
    }, field, el('button', { type: 'submit', class: 'sticky-button' }, icon('plus'), 'Add')));
}

async function friendsList(backend, redraw) {
  const list = await backend.listFriends();
  return el('section', { class: 'card' },
    el('h2', {}, `Friends (${list.length})`),
    list.length === 0
      ? el('p', { class: 'muted' }, 'Nobody yet. Send someone your invite link.')
      : el('ul', { class: 'friend-list' }, ...list.map((friend) => el('li', {},
        el('span', {}, friend.display_name),
        el('button', {
          type: 'button',
          class: 'link-button',
          'aria-label': `Remove ${friend.display_name}`,
          onclick: async () => {
            const sure = await confirmDialog({
              title: `Remove ${friend.display_name}?`,
              body: 'You\'ll both come off each other\'s friends lists.',
              confirm: 'Remove',
              danger: true,
            });
            if (!sure) return;
            try {
              await backend.removeFriend(friend.user_id);
              redraw();
            } catch (err) {
              toast(friendlyError(err));
            }
          },
        }, 'Remove')))));
}

function leaveCard(backend, redraw) {
  return el('section', { class: 'card' },
    el('h2', {}, 'Stop comparing'),
    el('p', { class: 'muted small' }, 'Deletes your player, shared scores and friendships from the database. Your list and history stay on this device.'),
    el('button', {
      type: 'button',
      class: 'button danger small',
      onclick: async () => {
        const sure = await confirmDialog({
          title: 'Delete your shared data?',
          body: 'Your name, shared scores and friendships will be gone from the database. This can\'t be undone.',
          confirm: 'Delete',
          danger: true,
        });
        if (!sure) return;
        try {
          await backend.leave();
          markAllUnsynced();
          redraw();
        } catch (err) {
          toast(friendlyError(err));
        }
      },
    }, 'Delete my shared data'));
}

/**
 * @param {HTMLElement} host
 * @param {{ params: Record<string, string>, isCurrent: () => boolean }} ctx
 */
export async function renderFriends(host, ctx) {
  const backend = await getBackend();
  if (!ctx.isCurrent()) return;
  if (!backend.isConfigured) {
    host.replaceChildren(notSetUp());
    return;
  }

  const redraw = async () => {
    const pendingCode = window.location.hash.startsWith('#/add/') ? ctx.params.code : null;
    try {
      const account = await backend.getAccount();
      if (!ctx.isCurrent()) return;
      if (!account) {
        host.replaceChildren(joinForm(backend, redraw, pendingCode));
        return;
      }
      const list = await friendsList(backend, redraw);
      if (!ctx.isCurrent()) return;
      host.replaceChildren(
        accountCard(backend, account, redraw),
        addFriendCard(backend, redraw, pendingCode),
        list,
        leaveCard(backend, redraw),
      );
    } catch (err) {
      console.warn('Streakle friends:', err);
      if (ctx.isCurrent()) host.replaceChildren(el('p', { class: 'notice' }, friendlyError(err)));
    }
  };

  host.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  await redraw();
}
