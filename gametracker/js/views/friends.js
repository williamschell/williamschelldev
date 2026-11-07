// The Friends view: your friend code and your friends list. Signing in is on the Account view.

import { friendlyError, getBackend } from '../backend.js';
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

function signInPrompt(pendingCode) {
  return el('section', { class: 'card' },
    el('h1', {}, 'Compare with friends'),
    pendingCode ? el('p', { class: 'notice' }, 'Sign in or make an account, and we\'ll add your friend right after.') : null,
    el('p', {}, 'Sign in to add friends and see how your scores stack up. Only scores are shared. Grids and share text stay with you.'),
    el('p', {}, el('a', { class: 'button primary', href: pendingCode ? `#/account/add/${encodeURIComponent(pendingCode)}` : '#/account' }, 'Sign in or create an account')));
}

function codeCard(account, backend, redraw) {
  return el('section', { class: 'card' },
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
        host.replaceChildren(signInPrompt(pendingCode));
        return;
      }
      const list = await friendsList(backend, redraw);
      if (!ctx.isCurrent()) return;
      host.replaceChildren(
        codeCard(account, backend, redraw),
        addFriendCard(backend, redraw, pendingCode),
        list,
      );
    } catch (err) {
      console.warn('Streakle friends:', err);
      if (ctx.isCurrent()) host.replaceChildren(el('p', { class: 'notice' }, friendlyError(err)));
    }
  };

  host.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  await redraw();
}
