// The Account view: signing in, creating an account, and managing it.

import { friendlyError, getBackend } from '../backend.js';
import {
  clearLocalData, joinAccount, leaveAccount, pendingCount, syncNow,
} from '../store.js';
import {
  confirmDialog, el, segmented, toast,
} from '../ui.js';
import { notSetUp } from './common.js';

/** Which form a signed-out person is looking at. Kept across redraws. */
let mode = 'signin';

function textField(label, attrs) {
  const input = el('input', { type: 'text', autocomplete: 'off', ...attrs });
  return { input, field: el('label', { class: 'field' }, label, input) };
}

function signedOutView(backend, ctx, redraw) {
  const username = textField('Username', {
    maxLength: 20, autocomplete: 'username', autocapitalize: 'none', spellcheck: false,
  });
  const password = textField('Password', {
    type: 'password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password',
  });
  const confirm = textField('Password again', { type: 'password', autocomplete: 'new-password' });
  const isPublic = el('input', { type: 'checkbox', checked: true });
  const isNew = mode === 'create';
  const submit = el('button', { type: 'submit', class: 'button primary' }, isNew ? 'Create account' : 'Sign in');

  const onSubmit = async (e) => {
    e.preventDefault();
    const name = username.input.value.trim();
    const problem = backend.usernameError(name)
      ?? (isNew ? backend.passwordError(password.input.value) : null)
      ?? (isNew && password.input.value !== confirm.input.value ? 'The two passwords don\'t match.' : null);
    if (problem) {
      toast(problem);
      return;
    }
    if (!isNew && !password.input.value) {
      toast('Enter your password.');
      return;
    }
    submit.disabled = true;
    try {
      if (isNew) await backend.signUp(name, password.input.value, isPublic.checked);
      else await backend.signIn(name, password.input.value);
    } catch (err) {
      console.warn('Streakle account:', err);
      toast(err?.code === 23514 || err?.code === '23514' ? 'That username isn\'t allowed. Try a different one.' : friendlyError(err));
      submit.disabled = false;
      return;
    }
    // Signed in. What's on this device joins the account, and the account's history comes down.
    submit.textContent = 'Loading your history…';
    await joinAccount({ isNew });
    const clean = name.toLowerCase();
    toast(isNew ? `Welcome, ${clean}! Your games are saved to your account now.` : `Signed in as ${clean}.`);
    if (ctx.params.code) window.location.hash = `#/add/${ctx.params.code}`;
    else window.location.hash = '#/today';
  };

  return el('section', { class: 'card' },
    el('h1', {}, 'Your account'),
    el('p', {}, 'Your list, scores and streaks are saved to your account, so clearing your browser or switching devices loses nothing. You need one to compare with friends.'),
    ctx.params.code ? el('p', { class: 'notice' }, 'Sign in or make an account, and we\'ll add your friend right after.') : null,
    segmented({
      label: 'Sign in or create an account',
      value: mode,
      options: [{ value: 'signin', label: 'Sign in' }, { value: 'create', label: 'Create account' }],
      onChange: (value) => {
        mode = value;
        redraw();
      },
    }),
    el('form', { class: 'stack account-form', onsubmit: onSubmit },
      username.field,
      password.field,
      isNew ? confirm.field : null,
      isNew ? el('label', { class: 'check-field' }, isPublic, el('span', {}, 'Also show me on Everyone boards')) : null,
      submit),
    el('p', { class: 'muted small' }, isNew
      ? 'Usernames are 3 to 20 letters, numbers or _. Your username is also your name on boards until you change it. There\'s no email, so pick a password you\'ll remember. If you forget it, ask William to reset it.'
      : 'Forgot your password? There\'s no email, so ask William to reset it.'));
}

function profileCard(backend, account, redraw) {
  const name = el('input', {
    type: 'text', maxLength: 24, value: account.name, autocomplete: 'off', 'aria-label': 'Your name on boards',
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
    el('h2', {}, 'Your name on boards'),
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
    el('label', { class: 'check-field' }, isPublic, el('span', {}, 'Show me on Everyone boards')));
}

function passwordCard(backend) {
  const current = el('input', { type: 'password', autocomplete: 'current-password' });
  const fresh = el('input', { type: 'password', autocomplete: 'new-password' });
  const submit = el('button', { type: 'submit', class: 'button small' }, 'Change password');
  return el('section', { class: 'card' },
    el('h2', {}, 'Change your password'),
    el('form', {
      class: 'stack account-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const problem = backend.passwordError(fresh.value);
        if (problem) {
          toast(problem);
          return;
        }
        submit.disabled = true;
        try {
          await backend.changePassword(current.value, fresh.value);
          current.value = '';
          fresh.value = '';
          toast('Password changed. Any other devices are signed out.');
        } catch (err) {
          toast(friendlyError(err));
        }
        submit.disabled = false;
      },
    },
    el('label', { class: 'field' }, 'Current password', current),
    el('label', { class: 'field' }, 'New password', fresh),
    submit));
}

async function signOut(backend) {
  await syncNow();
  const unsent = pendingCount();
  if (unsent > 0) {
    const sure = await confirmDialog({
      title: 'Sign out anyway?',
      body: `${unsent} result${unsent === 1 ? ' hasn\'t' : 's haven\'t'} reached your account yet, probably because you're offline. Signing out removes ${unsent === 1 ? 'it' : 'them'} from this browser.`,
      confirm: 'Sign out',
      danger: true,
    });
    if (!sure) return;
  }
  try {
    await backend.signOut();
  } catch (err) {
    console.warn('Streakle sign out:', err);
  }
  await clearLocalData();
  window.location.hash = '#/today';
  window.location.reload();
}

function signedInView(backend, account, redraw) {
  return [
    el('section', { class: 'card' },
      el('h1', {}, 'Your account'),
      el('p', {}, 'Signed in as ', el('strong', { class: 'username' }, account.username), '.'),
      el('p', { class: 'muted small' }, 'Your list, scores and streaks are saved to your account. Sign in with the same username on any device to get them back.'),
      el('button', { type: 'button', class: 'button', onclick: () => signOut(backend) }, 'Sign out')),
    profileCard(backend, account, redraw),
    passwordCard(backend),
    el('section', { class: 'card' },
      el('h2', {}, 'Delete your account'),
      el('p', { class: 'muted small' }, 'Deletes your account, scores and friendships from the server. Your history stays in this browser until you clear it.'),
      el('button', {
        type: 'button',
        class: 'button danger small',
        onclick: async () => {
          const sure = await confirmDialog({
            title: 'Delete your account?',
            body: 'Your account, saved scores and friendships will be gone for good, and your username will be free for someone else.',
            confirm: 'Delete',
            danger: true,
          });
          if (!sure) return;
          try {
            await backend.deleteAccount();
            await leaveAccount();
            toast('Your account is deleted. Your history is still in this browser.');
            redraw();
          } catch (err) {
            toast(friendlyError(err));
          }
        },
      }, 'Delete my account')),
  ];
}

/**
 * @param {HTMLElement} host
 * @param {{ params: Record<string, string>, isCurrent: () => boolean }} ctx
 */
export async function renderAccount(host, ctx) {
  const backend = await getBackend();
  if (!ctx.isCurrent()) return;
  if (!backend.isConfigured) {
    host.replaceChildren(notSetUp());
    return;
  }

  const redraw = async () => {
    try {
      const account = await backend.getAccount();
      if (!ctx.isCurrent()) return;
      host.replaceChildren(...(account
        ? signedInView(backend, account, redraw)
        : [signedOutView(backend, ctx, redraw)]));
    } catch (err) {
      console.warn('Streakle account:', err);
      if (ctx.isCurrent()) host.replaceChildren(el('p', { class: 'notice' }, friendlyError(err)));
    }
  };

  host.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  await redraw();
}
