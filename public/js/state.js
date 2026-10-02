export const state = {
  me: null,        // { user, profile, targets, hasActivePlan, hasPendingPlan }
  as: null,        // { id, name } when the admin is viewing/editing another user
  date: null,      // date being viewed on the Today screen
  trainDate: null, // date being viewed on the Train screen
};

// Local calendar date (YYYY-MM-DD) on the user's phone, not UTC.
export function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function shiftDate(str, n) {
  const d = new Date(`${str}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(str, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${str}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
