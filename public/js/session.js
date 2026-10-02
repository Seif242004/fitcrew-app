import { api } from './api.js';
import { state } from './state.js';

export async function loadMe() {
  state.me = await api('GET', '/api/me');
  return state.me;
}

export async function signOut() {
  try { await api('POST', '/api/logout', {}); } catch { /* already signed out */ }
  state.me = null;
  state.as = null;
  state.date = null;
}
