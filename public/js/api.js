import { state } from './state.js';

// Paths that act on "the person being viewed". When the admin is viewing as someone,
// these calls carry that person's id so the server edits their data (and audits it).
const SUBJECT_PATHS = ['/api/me', '/api/profile', '/api/plan', '/api/today', '/api/log', '/api/metrics', '/api/adherence', '/api/train', '/api/workout-plan', '/api/photos', '/api/checkins', '/api/body'];

// Screens that should still open in a basement gym with no signal (last copy seen on this phone).
const OFFLINE_GETS = ['/api/train?', '/api/today?', '/api/me'];
function offlineCopy(url) {
  if (!OFFLINE_GETS.some((p) => url.startsWith(p))) return null;
  let data;
  try { data = JSON.parse(localStorage.getItem(`fc.get:${url}`) ?? 'null'); } catch { return null; }
  if (!data) return null;
  // Replay queued set ticks onto the cached training day so the screen matches what was done.
  if (url.startsWith('/api/train?') && Array.isArray(data.blocks)) {
    for (const job of readQ()) {
      const b = data.blocks.find((x) => x.exerciseId === job.body?.exerciseId);
      if (!b || job.body.date !== data.date) continue;
      if (job.path === '/api/train/set') b.sets = [...b.sets.filter((x) => x.setNo !== job.body.setNo), { setNo: job.body.setNo, weightKg: job.body.weightKg, reps: job.body.reps }];
      if (job.path === '/api/train/set/remove') b.sets = b.sets.filter((x) => x.setNo !== job.body.setNo);
    }
  }
  return { ...data, offline: true };
}

export async function api(method, path, body) {
  let url = path;
  let payload = body;
  if (state.as && SUBJECT_PATHS.some((p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`))) {
    if (method === 'GET') url += `${path.includes('?') ? '&' : '?'}userId=${state.as.id}`;
    else payload = { ...(body ?? {}), userId: state.as.id };
  }
  // fetch() only throws when no response arrived at all (server restarting, phone switching
  // networks). Retry a few times with backoff before telling the user they are offline.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      break;
    } catch {
      if (attempt < 3 && navigator.onLine !== false) { await new Promise((r) => setTimeout(r, 600 * 2 ** attempt)); continue; }
      // Offline: today's training and food screens fall back to the last copy seen on this phone.
      const cached = method === 'GET' ? offlineCopy(url) : null;
      if (cached) return cached;
      const e = new Error('No connection. Check your internet and try again.');
      e.offline = true;
      throw e;
    }
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && method === 'GET' && OFFLINE_GETS.some((p) => url.startsWith(p))) { try { localStorage.setItem(`fc.get:${url}`, JSON.stringify(data)); } catch { /* full */ } }
  if (!res.ok) {
    const e = new Error(data.error ?? 'Something went wrong');
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------- offline queue
// Basement gyms have bad signal. Writes that are safe to replay later (ticking sets, logging
// food, water) are queued on the phone when there is no connection and sent, in order, when it
// comes back. The screen updates straight away; a chip shows how many are waiting.
// Only these paths are queued; anything else (photos, plans, settings) needs a live connection.
const QUEUEABLE = ['/api/train/set', '/api/train/set/remove', '/api/train/exercise/complete', '/api/log', '/api/log/remove', '/api/water', '/api/train/cardio'];
const QKEY = 'fc.queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) ?? '[]'); } catch { return []; } };
const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } drawChip(q); };
export const queuedCount = () => readQ().length;

/** Small fixed chip above the tab bar: "3 changes waiting to sync". */
function drawChip(q = readQ()) {
  let el = document.getElementById('syncchip');
  if (!q.length) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'syncchip'; el.className = 'syncchip'; el.type = 'button';
    el.addEventListener('click', () => flushQueue());
    document.body.append(el);
  }
  const sets = q.filter((x) => x.path.startsWith('/api/train')).length;
  const what = sets === q.length ? (q.length === 1 ? 'set' : 'sets') : q.length === 1 ? 'change' : 'changes';
  el.textContent = `${q.length} ${what} waiting to sync`;
  el.setAttribute('aria-label', `${q.length} ${what} waiting to sync. Tap to try now`);
}

let flushing = null;
/** Send queued writes in order. Stops at the first network failure; drops writes the server refuses. */
export function flushQueue() {
  if (flushing) return flushing;
  // Note: reset `flushing` in .finally(), not inside the async body. With an empty queue the
  // body finishes synchronously, before the assignment below, which would leave it stuck.
  flushing = (async () => {
    let q = readQ();
    while (q.length) {
      try { await api(q[0].method, q[0].path, q[0].body); }
      catch (e) { if (e.offline) break; /* refused (e.g. plan changed): drop it, never block the queue */ }
      q = readQ().slice(1); writeQ(q);
    }
    if (!q.length) document.dispatchEvent(new CustomEvent('fc:synced'));
  })().finally(() => { flushing = null; });
  return flushing;
}

/**
 * Like api(), but a queueable write that cannot reach the server is stored and replayed later.
 * Returns { queued: true } in that case so the caller keeps its optimistic screen.
 * While anything is queued, new writes join the back of the queue to keep the order.
 */
export async function send(method, path, body) {
  const queueable = method === 'POST' && QUEUEABLE.includes(path) && !state.as;
  if (queueable && readQ().length) { await flushQueue(); if (readQ().length) { writeQ([...readQ(), { method, path, body }]); return { queued: true }; } }
  if (queueable && navigator.onLine === false) { writeQ([...readQ(), { method, path, body }]); return { queued: true }; }
  try { return await api(method, path, body); } catch (e) {
    if (queueable && e.offline) { writeQ([...readQ(), { method, path, body }]); return { queued: true }; }
    throw e;
  }
}

addEventListener('online', () => flushQueue());
addEventListener('load', () => { drawChip(); if (navigator.onLine !== false) flushQueue(); });
setInterval(() => { if (readQ().length && navigator.onLine !== false) flushQueue(); }, 30000);
