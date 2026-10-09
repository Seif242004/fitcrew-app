// Per-person, per-exercise personal records, kept in the set_records table.
//
// The Train screens used to re-read a person's whole set history to find their all-time best
// (and every logged set re-read the whole exercise history to detect a PR). Cloudflare bills each
// row scanned as rows_read, and that cost grew with every workout. Now each (person, exercise)
// has one row that is updated when a set is logged and recomputed from that one exercise's sets
// when a set is removed, so the cost no longer grows with history.
//
//   best_*    the best set by "score" (estimated 1RM; reps / 1000 for bodyweight sets); the most
//             recent date wins a tie. This is the record shown on the Train screen.
//   max_e1rm  the highest estimated 1RM ever (0 for bodyweight); a new PR must beat it.
import { e1rm } from './workout.js';

/** Ranking score of a set: estimated 1RM, or reps / 1000 for bodyweight sets. */
export const setScore = (weightKg, reps) => (weightKg > 0 ? e1rm(weightKg, reps) : reps / 1000);

/** The stored record for one exercise, or undefined. */
export const getRecord = (db, uid, exId) =>
  db.prepare('SELECT * FROM set_records WHERE user_id = ? AND exercise_id = ?').get(uid, exId);

const write = (db, uid, exId, r) => db.prepare(
  `INSERT INTO set_records (user_id, exercise_id, best_date, best_weight, best_reps, best_score, max_e1rm) VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (user_id, exercise_id) DO UPDATE SET best_date = excluded.best_date, best_weight = excluded.best_weight,
     best_reps = excluded.best_reps, best_score = excluded.best_score, max_e1rm = excluded.max_e1rm`)
  .run(uid, exId, r.date, r.weightKg, r.reps, r.score, r.maxE1rm);

/** A set was just saved as a new set: fold it into the record (no history read). */
export function noteSet(db, uid, exId, { date, weightKg, reps }) {
  const cur = getRecord(db, uid, exId);
  const score = setScore(weightKg, reps);
  const maxE1rm = Math.max(cur?.max_e1rm ?? 0, e1rm(weightKg, reps));
  const better = !cur || score > cur.best_score || (score === cur.best_score && date > cur.best_date);
  if (better) write(db, uid, exId, { date, weightKg, reps, score, maxE1rm });
  else if (maxE1rm !== cur.max_e1rm) db.prepare('UPDATE set_records SET max_e1rm = ? WHERE user_id = ? AND exercise_id = ?').run(maxE1rm, uid, exId);
}

/** Rebuild one exercise's record from its sets (after an edit or removal). Reads that exercise only. */
export function refreshRecord(db, uid, exId) {
  const rows = db.prepare('SELECT date, weight_kg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? ORDER BY date DESC').all(uid, exId);
  if (!rows.length) { db.prepare('DELETE FROM set_records WHERE user_id = ? AND exercise_id = ?').run(uid, exId); return; }
  let best = null; let maxE1rm = 0;
  for (const r of rows) {
    const score = setScore(r.weight_kg, r.reps);
    maxE1rm = Math.max(maxE1rm, e1rm(r.weight_kg, r.reps));
    if (!best || score > best.score) best = { date: r.date, weightKg: r.weight_kg, reps: r.reps, score };
  }
  write(db, uid, exId, { ...best, maxE1rm });
}

/** One-off build for databases that already hold sets (runs once, then noteSet / refreshRecord keep it current). */
export function rebuildAllRecords(db) {
  db.prepare('DELETE FROM set_records').run();
  const pairs = db.prepare('SELECT DISTINCT user_id, exercise_id FROM set_logs').all();
  for (const p of pairs) refreshRecord(db, p.user_id, p.exercise_id);
}
