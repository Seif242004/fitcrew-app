import { state } from './state.js';

// Paths that act on "the person being viewed". When the admin is viewing as someone,
// these calls carry that person's id so the server edits their data (and audits it).
const SUBJECT_PATHS = ['/api/me', '/api/profile', '/api/plan', '/api/today', '/api/log', '/api/metrics', '/api/adherence', '/api/train', '/api/workout-plan', '/api/photos'];

export async function api(method, path, body) {
  let url = path;
  let payload = body;
  if (state.as && SUBJECT_PATHS.some((p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`))) {
    if (method === 'GET') url += `${path.includes('?') ? '&' : '?'}userId=${state.as.id}`;
    else payload = { ...(body ?? {}), userId: state.as.id };
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    const e = new Error('No connection. Check your internet and try again.');
    e.offline = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error ?? 'Something went wrong');
    e.status = res.status;
    throw e;
  }
  return data;
}
