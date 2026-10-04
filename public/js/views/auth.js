import { h } from '../dom.js';
import { api } from '../api.js';
import { plain } from '../shell.js';
import { navigate } from '../router.js';
import { field } from '../ui.js';
import { loadMe } from '../session.js';
import { showInstall, isStandalone } from '../install.js';

const COPY = {
  login: { title: 'Sign in', lead: 'Your diet and training, in one place.', cta: 'Sign in', path: '/api/login' },
  register: { title: 'Join the crew', lead: 'Enter the invite code you were given.', cta: 'Create account', path: '/api/register' },
  setup: { title: 'Create the admin account', lead: 'First time here. This account is the administrator with full control, so use a password you will not forget.', cta: 'Create admin account', path: '/api/setup' },
};

export function authView(mode) {
  const c = COPY[mode];
  const err = h('p', { class: 'error', role: 'alert' });
  const name = h('input', { type: 'text', autocomplete: 'name', required: true });
  const mail = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true, autocapitalize: 'none' });
  const pass = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minlength: mode === 'login' ? null : 8 });
  // Invite links carry the code (#/register?code=ABC123): fill it in so the friend only types name, email, password.
  const fromLink = new URLSearchParams(location.hash.split('?')[1] ?? '').get('code') ?? '';
  const code = h('input', { type: 'text', autocapitalize: 'characters', autocomplete: 'off', required: true, value: fromLink });
  const btn = h('button', { class: 'btn block', type: 'submit' }, c.cta);

  const onSubmit = async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      const body = { email: mail.value.trim(), password: pass.value };
      if (mode !== 'login') body.name = name.value.trim();
      if (mode === 'register') body.code = code.value.trim();
      await api('POST', c.path, body);
      await loadMe();
      navigate('/today');
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  };

  plain(
    h('h1', { class: 'title' }, 'FitCrew'),
    h('p', { class: 'sub', style: 'margin-bottom:28px' }, c.lead),
    h('form', { class: 'stack', onsubmit: onSubmit, novalidate: false },
      h('h2', { class: 'h2' }, c.title),
      mode !== 'login' ? field('Your name', name) : null,
      mode === 'register' ? field('Invite code', code) : null,
      field('Email', mail),
      field('Password', pass, mode === 'login' ? null : 'At least 8 characters.'),
      err,
      btn),
    mode === 'login' ? h('p', { style: 'margin-top:22px' }, 'Have an invite code? ', h('a', { href: '#/register' }, 'Join here')) : null,
    mode === 'register' ? h('p', { style: 'margin-top:22px' }, 'Already have an account? ', h('a', { href: '#/login' }, 'Sign in')) : null,
    isStandalone() ? null : h('p', { style: 'margin-top:12px' }, h('button', { class: 'link', type: 'button', onclick: showInstall }, 'Add FitCrew to your home screen')));
  (mode === 'login' ? mail : mode === 'register' && !fromLink ? code : name).focus();
}
