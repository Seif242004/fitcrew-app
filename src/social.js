// The crew side of FitCrew: the monthly points competition, the activity feed with reactions,
// and the weekly recap.
//
// Competition: points are day scores (0-100 a day) added up over the calendar month. The month
// with the most points wins the prize the admin sets. When a new month starts, last month's
// standings are stored (competition_results) the first time anyone opens the board, the winner
// gets a "champion" entry in the feed and everyone gets a notification. An admin reset
// (scoreResetDate) means nothing before that date counts.
//
// Feed: short, positive events written by the server (check-ins, PRs, finished sessions, 70+ days,
// streak milestones, monthly winners). One entry per thing per day (activity.key). Members hidden
// from the leaderboard are hidden from the feed too, except to themselves and admins.

import { getSetting, setSetting } from './db.js';
import { streak } from './adherence.js';
import { e1rm } from './workout.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const REACTIONS = { fire: '🔥', strong: '💪', clap: '👏', fist: '👊' };
const STREAK_MILESTONES = [3, 7, 14, 21, 30, 45, 60, 90, 100];

const addDaysStr = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** { key: 'YYYY-MM', label, from, to } for the month containing `date`. */
export function monthOf(date) {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { key: `${y}-${mm}`, label: `${MONTHS[m - 1]} ${y}`, name: MONTHS[m - 1], from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
export const prevMonthOf = (date) => monthOf(addDaysStr(monthOf(date).from, -1));

/** Insert or refresh a feed entry. key makes it one-per-thing (e.g. "checkin:2026-10-04"). */
export function addActivity(db, uid, kind, key, text, data = null) {
  db.prepare(`INSERT INTO activity (user_id, kind, key, text, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, key) DO UPDATE SET text = excluded.text, data = excluded.data`).run(uid, kind, key, String(text).slice(0, 160), data ? JSON.stringify(data) : null);
}
export const removeActivity = (db, uid, key) => db.prepare('DELETE FROM activity WHERE user_id = ? AND key = ?').run(uid, key);

export function registerSocial(c) {
  const { route, bad, notFound, str, needDate, isDate, audit, todayUtc, scoresBetween, attendance, weekStart, pushToUser } = c;

  const resetDate = (db) => getSetting(db, 'scoreResetDate', null);
  const clampFrom = (db, d) => { const r = resetDate(db); return r && d < r ? r : d; };
  // hidden: the member chose to hide their score (still visible to themselves and admins).
  // private: set by an admin; the person does not exist for any other member (not even in the
  // competition). Only admins see them. Admins themselves are never private-filtered.
  const members = (db) => db.prepare('SELECT u.id, u.name, u.private, p.data FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.active = 1').all()
    .map((u) => ({ id: u.id, name: u.name, private: Boolean(u.private), hidden: Boolean(JSON.parse(u.data).hideFromLeaderboard) }));
  const privateIds = (db) => new Set(db.prepare('SELECT id FROM users WHERE private = 1').all().map((r) => r.id));
  // Profile picture URL for a member, or null (the app shows their initial instead).
  const avatarOf = (db, uid) => { const u = db.prepare('SELECT id, avatar_at FROM users WHERE id = ?').get(uid); return u?.avatar_at ? `/api/avatar/${u.id}?v=${encodeURIComponent(u.avatar_at)}` : null; };
  const isPrivate = (db, uid) => Boolean(db.prepare('SELECT private FROM users WHERE id = ?').get(uid)?.private);

  /** Points between two dates for every member, best first. Ties: more 70+ days, then name. */
  function standings(db, from, to) {
    const start = clampFrom(db, from);
    return members(db).map((u) => {
      const scores = start <= to ? scoresBetween(db, u.id, start, to) : [];
      const points = scores.reduce((a, s) => a + s.total, 0);
      return { userId: u.id, name: u.name, hidden: u.hidden, private: u.private, points, days: scores.length, days70: scores.filter((s) => s.total >= 70).length, scores };
    }).sort((a, b) => (a.private - b.private) || b.points - a.points || b.days70 - a.days70 || a.name.localeCompare(b.name));
  }
  /** The people actually competing: private members never win, rank or count. */
  const competing = (rows) => rows.filter((r) => !r.private);

  /**
   * Close last month once: store the standings, announce the winner in the feed and by
   * notification. Runs lazily on the first board view of a new month.
   */
  async function closeLastMonth(db, today) {
    const pm = prevMonthOf(today);
    if (db.prepare('SELECT 1 FROM competition_results WHERE month = ?').get(pm.key)) return;
    const reset = resetDate(db);
    if (reset && reset > pm.to) { // the season started after that month: nothing to award
      db.prepare('INSERT OR IGNORE INTO competition_results (month, data, prize) VALUES (?, ?, ?)').run(pm.key, JSON.stringify({ standings: [], winner: null }), null);
      return;
    }
    const rows = competing(standings(db, pm.from, pm.to)).map(({ scores, ...r }) => r);
    const winner = rows[0]?.points > 0 ? rows[0] : null;
    const prize = getSetting(db, 'competitionPrize', '') || null;
    const inserted = db.prepare('INSERT OR IGNORE INTO competition_results (month, data, prize) VALUES (?, ?, ?)').run(pm.key, JSON.stringify({ standings: rows, winner: winner && { userId: winner.userId, name: winner.name, points: winner.points } }), prize).changes;
    if (!inserted || !winner) return;
    addActivity(db, winner.userId, 'champion', `champion:${pm.key}`, `won the ${pm.name} competition with ${winner.points.toLocaleString('en-US')} points`, { month: pm.key, points: winner.points });
    for (const u of members(db)) {
      if (u.private) continue; // private members are not part of the competition
      const body = u.id === winner.userId ? `You won ${pm.name} with ${winner.points.toLocaleString('en-US')} points${prize ? `. Prize: ${prize}` : ''}!` : `${winner.name} won ${pm.name} with ${winner.points.toLocaleString('en-US')} points. New month, new race.`;
      pushToUser(db, u.id, { title: `${pm.name} champion`, body, url: '/#/group', tag: 'champion' }).catch(() => {});
    }
  }

  // ------------------------------------------------ leaderboard (monthly competition)
  route('GET', '/api/group', 'user', async (ctx) => {
    const today = needDate(ctx.query.get('today') ?? todayUtc(), 'today');
    await closeLastMonth(ctx.db, today);
    const month = monthOf(today);
    const ws = weekStart(today);
    const reset = resetDate(ctx.db);
    const trophies = new Map();
    const champions = ctx.db.prepare('SELECT month, data, prize FROM competition_results ORDER BY month DESC LIMIT 12').all()
      .map((r) => ({ month: r.month, prize: r.prize, winner: JSON.parse(r.data).winner }))
      .filter((r) => r.winner);
    for (const ch of champions) trophies.set(ch.winner.userId, (trophies.get(ch.winner.userId) ?? 0) + 1);
    const admin = ctx.user.role === 'admin';
    const canSee = (u) => (admin || !u.private) && (!u.hidden || u.userId === ctx.user.id || admin);
    const rows = standings(ctx.db, month.from, today).filter(canSee);
    const me = isPrivate(ctx.db, ctx.user.id) ? standings(ctx.db, month.from, today).find((r) => r.userId === ctx.user.id) : null;
    const board = rows.map((r) => {
      const plan = Boolean(ctx.db.prepare("SELECT 1 FROM workout_plans WHERE user_id = ? AND status = 'active'").get(r.userId));
      const week = r.scores.filter((s) => s.date >= ws).reduce((a, s) => a + s.total, 0);
      // Streak looks further back than the month (but never before a reset).
      const longer = scoresBetween(ctx.db, r.userId, clampFrom(ctx.db, addDaysStr(today, -100)), today);
      return {
        name: r.name, avatar: avatarOf(ctx.db, r.userId), isMe: r.userId === ctx.user.id, hidden: r.hidden, private: r.private,
        points: r.points, days: r.days, days70: r.days70, avg: r.days ? Math.round(r.points / r.days) : null, week,
        streak: streak(longer, today), today: r.scores.find((s) => s.date === today)?.total ?? null,
        gym: plan ? attendance(ctx.db, r.userId, clampFrom(ctx.db, month.from), today) : null,
        trainedToday: Boolean(ctx.db.prepare("SELECT 1 FROM checkins WHERE user_id = ? AND date = ? AND status = 'approved'").get(r.userId, today)),
        trophies: trophies.get(r.userId) ?? 0,
      };
    });
    const daysLeft = Math.round((Date.parse(`${month.to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1;
    return {
      month: { ...month, daysLeft }, week: { from: ws, to: addDaysStr(ws, 6) },
      prize: getSetting(ctx.db, 'competitionPrize', '') || null, resetAt: reset, board,
      // A private member does not appear on the board, even to themselves; they still see their own month.
      private: me ? { points: me.points, days: me.days, days70: me.days70 } : null,
      champions: champions.slice(0, 6).map((ch) => ({ month: ch.month, label: monthOf(`${ch.month}-01`).label, name: ch.winner.name, points: ch.winner.points, isMe: ch.winner.userId === ctx.user.id, prize: ch.prize })),
    };
  });

  route('PUT', '/api/admin/competition', 'admin', (ctx) => {
    const prize = str(ctx.body.prize, 80, 'prize');
    setSetting(ctx.db, 'competitionPrize', prize);
    audit(ctx.db, ctx.user.id, 'competition.prize_set', null, { prize });
    return { ok: true, prize: prize || null };
  });

  // Start every member from zero (points, month, streaks). Logs and personal charts are kept.
  route('POST', '/api/admin/reset-scores', 'admin', (ctx) => {
    const today = needDate(ctx.body.today ?? todayUtc(), 'today');
    setSetting(ctx.db, 'scoreResetDate', today);
    audit(ctx.db, ctx.user.id, 'scores.reset', null, { from: today });
    return { ok: true, resetAt: today };
  });

  // ------------------------------------------------ feed and reactions
  route('GET', '/api/feed', 'user', (ctx) => {
    const today = isDate(ctx.query.get('today')) ? ctx.query.get('today') : todayUtc();
    const hidden = new Set(members(ctx.db).filter((u) => u.hidden).map((u) => u.id));
    const priv = privateIds(ctx.db);
    const admin = ctx.user.role === 'admin';
    const rows = ctx.db.prepare(`SELECT a.id, a.user_id, a.kind, a.text, a.created_at, u.name FROM activity a JOIN users u ON u.id = a.user_id
      WHERE u.active = 1 AND a.created_at >= ? ORDER BY a.id DESC LIMIT 60`).all(`${addDaysStr(today, -14)} 00:00:00`)
      .filter((r) => admin || ((!hidden.has(r.user_id) || r.user_id === ctx.user.id) && (!priv.has(r.user_id) || r.user_id === ctx.user.id))).slice(0, 40);
    const ids = rows.map((r) => r.id);
    // Reactions from private members never reach anyone but admins (they cannot react anyway).
    const reacts = (ids.length ? ctx.db.prepare(`SELECT activity_id, user_id, kind FROM reactions WHERE activity_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [])
      .filter((x) => admin || !priv.has(x.user_id));
    return {
      items: rows.map((r) => {
        const mine = reacts.filter((x) => x.activity_id === r.id);
        return {
          id: r.id, kind: r.kind, name: r.name, avatar: avatarOf(ctx.db, r.user_id), isMe: r.user_id === ctx.user.id, private: admin && priv.has(r.user_id), text: r.text, at: r.created_at,
          reactions: Object.keys(REACTIONS).map((k) => ({ kind: k, emoji: REACTIONS[k], count: mine.filter((x) => x.kind === k).length, mine: mine.some((x) => x.kind === k && x.user_id === ctx.user.id) })),
        };
      }),
    };
  });

  route('POST', '/api/feed/:id/react', 'user', (ctx) => {
    const id = Number(ctx.params.id);
    const kind = String(ctx.body.kind ?? '');
    if (!REACTIONS[kind]) throw bad('Unknown reaction');
    // A reaction would show a private member's name to the post's owner.
    if (isPrivate(ctx.db, ctx.user.id)) throw c.forbidden('Private members cannot react');
    const a = ctx.db.prepare('SELECT user_id FROM activity WHERE id = ?').get(id);
    if (!a) throw notFound('That post is gone');
    if (isPrivate(ctx.db, a.user_id) && ctx.user.role !== 'admin' && a.user_id !== ctx.user.id) throw notFound('That post is gone');
    const had = ctx.db.prepare('SELECT 1 FROM reactions WHERE activity_id = ? AND user_id = ? AND kind = ?').get(id, ctx.user.id, kind);
    if (had) ctx.db.prepare('DELETE FROM reactions WHERE activity_id = ? AND user_id = ? AND kind = ?').run(id, ctx.user.id, kind);
    else {
      ctx.db.prepare('INSERT INTO reactions (activity_id, user_id, kind) VALUES (?, ?, ?)').run(id, ctx.user.id, kind);
      if (a.user_id !== ctx.user.id) pushToUser(ctx.db, a.user_id, { title: 'FitCrew', body: `${ctx.user.name.split(' ')[0]} reacted ${REACTIONS[kind]} to your post`, url: '/#/group', tag: 'reaction' }).catch(() => {});
    }
    return { ok: true, on: !had };
  });

  /**
   * After anything that changes a day's score: the first time today crosses 70, post it, and post
   * streak milestones. Cheap unless the threshold is crossed.
   */
  function dayChanged(db, uid, date) {
    const today = todayUtc();
    if (date < addDaysStr(today, -1) || date > addDaysStr(today, 1)) return;
    if (db.prepare('SELECT 1 FROM activity WHERE user_id = ? AND key = ?').get(uid, `day:${date}`)) return;
    const s = scoresBetween(db, uid, date, date)[0];
    if (!s || s.total < 70) return;
    addActivity(db, uid, 'day', `day:${date}`, `hit ${s.total} points today`, { score: s.total });
    const n = streak(scoresBetween(db, uid, clampFrom(db, addDaysStr(date, -100)), date), date);
    if (STREAK_MILESTONES.includes(n)) addActivity(db, uid, 'streak', `streak:${n}:${date}`, `is on a ${n}-day streak`, { days: n });
  }

  // ------------------------------------------------ weekly recap
  // The week in numbers. On Fridays it covers the week so far, otherwise the last full week.
  const PART_MAX = { calories: 20, protein: 20, meals: 20, logging: 10, workout: 30, water: 5 };
  // A day's share of a part's points. Training: a logged rest day (20, no gym) is full marks for
  // that day, so a plan with more rest days is never called weak on training.
  const partShare = (k, p) => (k === 'workout'
    ? ((p.workout ?? 0) + (p.bonus ?? 0)) / (p.workout === 20 && !p.bonus ? 20 : 30)
    : Math.min(1, (p[k] ?? 0) / PART_MAX[k]));
  const PART_TIP = {
    calories: 'Calories were the weak spot. Log meals as you eat them and use "Rebalance" when a meal runs big.',
    protein: 'Protein was the weak spot. Never skip the protein item; swap it instead.',
    meals: 'Meals were often far from their plan. Eat each meal close to its plan (or swap what you do not like) instead of skipping or doubling it.',
    logging: 'Logging late cost points. A quick "I ate my lunch" to the coach counts.',
    workout: 'Training points were the weak spot. Check in at the gym on training days: the photo is all 30 points, whatever you train.',
    water: 'Water was the easy points left on the table. Drink your daily target for 5 points a day; keep a bottle with you.',
    over: 'Going over your calories cost points this week. Log extras into their meal as you have them, and tap Rebalance when a meal runs big.',
  };
  function recap(db, uid, today) {
    const ws = weekStart(today);
    const friday = new Date(`${today}T00:00:00Z`).getUTCDay() === 5;
    const from = friday ? ws : addDaysStr(ws, -7);
    const to = friday ? today : addDaysStr(ws, -1);
    const all = standings(db, from, to);
    const me = all.find((r) => r.userId === uid);
    if (!me || !me.days) return null;
    const sets = db.prepare('SELECT s.exercise_id, s.weight_kg, s.reps, e.name FROM set_logs s LEFT JOIN exercises e ON e.id = s.exercise_id WHERE s.user_id = ? AND s.date BETWEEN ? AND ?').all(uid, from, to);
    if (!me.points && !sets.length) return null; // nothing logged all week: no recap to show
    const visible = competing(all).filter((r) => !r.hidden || r.userId === uid);
    const parts = Object.keys(PART_MAX).map((k) => ({ part: k, avg: (me.scores.reduce((a, s) => a + partShare(k, s.parts), 0) / me.scores.length) * PART_MAX[k] }));
    const overAvg = me.scores.reduce((a, s) => a + (s.parts.over ?? 0), 0) / me.scores.length;
    const weakest = overAvg <= -5 ? { part: 'over' } : parts.filter((p) => p.avg < PART_MAX[p.part] * 0.85).sort((a, b) => a.avg / PART_MAX[a.part] - b.avg / PART_MAX[b.part])[0];
    const best = sets.reduce((b, s) => (e1rm(s.weight_kg, s.reps) > (b?.score ?? 0) ? { name: s.name ?? s.exercise_id, weightKg: s.weight_kg, reps: s.reps, score: e1rm(s.weight_kg, s.reps) } : b), null);
    const prs = db.prepare("SELECT COUNT(*) n FROM activity WHERE user_id = ? AND kind = 'pr' AND created_at BETWEEN ? AND ?").get(uid, `${from} 00:00:00`, `${to} 23:59:59`).n;
    const w = db.prepare('SELECT date, weight_kg FROM body_metrics WHERE user_id = ? AND weight_kg IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date').all(uid, addDaysStr(from, -3), to);
    return {
      from, to, points: me.points, avg: Math.round(me.points / me.days), days: me.days, days70: me.days70,
      // Private members are not ranked against anyone.
      rank: me.private ? null : visible.findIndex((r) => r.userId === uid) + 1, of: me.private ? null : visible.length,
      gym: attendance(db, uid, from, to), sets: sets.length,
      bestLift: best && { name: best.name, weightKg: best.weightKg, reps: best.reps }, prs,
      weightChange: w.length >= 2 ? Math.round((w.at(-1).weight_kg - w[0].weight_kg) * 10) / 10 : null,
      tip: weakest ? PART_TIP[weakest.part] : 'Every part of the score was strong. Keep the same rhythm next week.',
    };
  }

  route('GET', '/api/recap', 'user', (ctx) => {
    const today = isDate(ctx.query.get('today')) ? ctx.query.get('today') : todayUtc();
    return { recap: recap(ctx.db, ctx.user.id, today) };
  });

  return { dayChanged, recap };
}
