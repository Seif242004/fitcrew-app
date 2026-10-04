import { api } from './api.js';
import { state } from './state.js';

export async function loadMe() {
  state.me = await api('GET', '/api/me');
  forgetIfFreshStart(state.me.freshStartAt);
  return state.me;
}

/**
 * After the admin's "Start everyone over", wipe this phone's FitCrew leftovers (seen tips and
 * tour, dismissed cards, cached screens, queued writes for data that no longer exists).
 */
function forgetIfFreshStart(at) {
  if (!at) return;
  try {
    if (localStorage.getItem('fc.freshSeen') === at) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('fc.')) localStorage.removeItem(k);
    localStorage.setItem('fc.freshSeen', at);
  } catch { /* storage blocked: nothing stored to forget */ }
}

export async function signOut() {
  try { await api('POST', '/api/logout', {}); } catch { /* already signed out */ }
  state.me = null;
  state.as = null;
  state.date = null;
}
