import { h } from '../dom.js';
import { tour, resetTips } from '../tour.js';
import { api } from '../api.js';
import { state, fmt, localDate } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { toast, confirmSheet, icon } from '../ui.js';
import { signOut, loadMe } from '../session.js';
import { pushSupport, pushEnabled, enablePush, disablePush } from '../notify.js';
import { showInstall, isStandalone } from '../install.js';

export async function profileView() {
  const main = paint('profile', loading());
  await guard(main, async () => {
    const [, adh] = await Promise.all([loadMe(), api('GET', `/api/adherence?days=30&today=${localDate()}`).catch(() => null)]);
    const me = state.me;
    const t = me.targets;
    const hidden = Boolean(me.profile?.hideFromLeaderboard);
    const toggleHide = async () => {
      try { await api('PUT', '/api/profile', { profile: { ...me.profile, hideFromLeaderboard: !hidden } }); toast(!hidden ? 'Hidden from the leaderboard' : 'Visible on the leaderboard'); profileView(); } catch (e) { toast(e.message, 'bad'); }
    };
    // A settings row with a tinted leading icon (the profile reads like a phone's settings page).
    const row = (ic, title, sub, onclick, trail = 'chevR', tone = '') => h('button', { class: 'list-row set-row', onclick },
      h('span', { class: `set-ic ${tone}` }, icon(ic, 18)),
      h('span', { class: 'grow' }, h('span', { class: 'strong' }, title), sub ? h('span', { class: 'sub' }, sub) : null), trail ? icon(trail, 18) : null);
    const pf = me.profile;
    const goal = pf ? ({ cut: 'Losing fat', bulk: 'Building muscle', maintain: 'Maintaining', recomp: 'Recomposition' }[pf.goal] ?? 'Your goal') : null;
    const days = pf?.trainDays ? pf.trainDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).sort((a, b) => ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(a) - ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(b)).join(', ') : pf ? `${pf.daysPerWeek} sessions a week` : '';
    // Macro tile: grams, share of calories, and a bar in the macro's plate colour.
    const tile = (label, k, g, kcalPer) => {
      const pct = t.kcal ? Math.round((g * kcalPer * 100) / t.kcal) : 0;
      return h('div', { class: `mtile ${k}` }, h('span', { class: 'mtile-label' }, label), h('span', { class: 'mtile-val' }, h('b', {}, g), ' g'),
        h('span', { class: 'mtile-bar' }, h('i', { style: `width:${Math.min(100, pct * 2)}%` })), h('span', { class: 'mtile-pct' }, `${pct}% of calories`));
    };
    main.replaceChildren(
      h('section', { class: 'profile-hero' },
        h('span', { class: 'hero-avatar', 'aria-hidden': 'true' }, me.user.name.trim()[0]?.toUpperCase() ?? '?'),
        h('div', { class: 'hero-text' },
          h('h1', { class: 'hero-name' }, me.user.name),
          h('p', { class: 'sub' }, me.user.email),
          h('div', { class: 'hero-badges' },
            h('span', { class: `tag ${me.user.role === 'admin' ? 'gold' : ''}` }, me.user.role === 'admin' ? 'Admin' : 'Member'),
            goal ? h('span', { class: 'tag' }, goal) : null,
            null)),
        pf ? h('div', { class: 'hero-stats' },
          h('div', {}, h('b', {}, pf.weightKg ?? '–'), h('span', {}, 'kg')),
          h('div', {}, h('b', {}, pf.goal === 'maintain' ? '0' : `${pf.goal === 'cut' ? '−' : '+'}${pf.weeklyRateKg}`), h('span', {}, 'kg a week')),
          h('div', {}, h('b', {}, adh?.streak ?? 0), h('span', {}, 'day streak'))) : null),
      t ? h('section', { class: 'section targets-card' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Daily targets'), h('span', { class: 'sub' }, t.overridden ? 'Set by the admin' : 'Calculated for you')),
        h('p', { class: 'targets-kcal' }, h('span', { class: 'num' }, fmt(t.kcal)), h('span', {}, ' kcal a day')),
        h('div', { class: 'mtiles' }, tile('Protein', 'p', t.proteinG, 4), tile('Carbs', 'c', t.carbsG, 4), tile('Fat', 'f', t.fatG, 9)),
        h('p', { class: 'meta', style: 'margin:12px 0 4px' }, `Resting burn ${fmt(t.bmr)} kcal (${t.bmrFormula === 'katch-mcardle' ? 'Katch-McArdle' : 'Mifflin-St Jeor'})${t.bodyFatPct ? ` · body fat ${t.bodyFatPct}%${t.bodyFatEstimated ? ', estimated' : ''}` : ''}`),
        ...(t.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin:8px 0' }, w))) : null,
      h('p', { class: 'group-label' }, 'You'),
      h('section', { class: 'section set-list' },
        row('chart', 'Progress', 'Weight, scores, measurements and photos', () => navigate('/progress'), 'chevR', 'green'),
        row('plan', 'My details and food choices', 'Weight, goal, what you never eat', () => navigate('/onboarding?edit=1'), 'chevR', 'red'),
        pf ? row('train', 'Training plan and days', days, () => navigate('/train/plan'), 'chevR', 'blue') : null,
        me.user.private ? h('div', { class: 'list-row set-row', style: 'cursor:default' }, h('span', { class: 'set-ic' }, icon('info', 18)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Private account'), h('span', { class: 'sub' }, 'Only the admin can see you. You are not on the leaderboard or in the crew feed.'))) : null,
        pf && !me.user.private ? row('group', hidden ? 'Show me on the leaderboard' : 'Hide me from the leaderboard', hidden ? 'You are hidden from the other members' : 'Other members can see your score', toggleHide, 'chevR', 'gold') : null),
      h('p', { class: 'group-label' }, 'App'),
      h('section', { class: 'section set-list' },
        isStandalone() ? null : row('plus', 'Add FitCrew to your home screen', 'Full screen like an app, needed for reminders on iPhone', showInstall, null, 'green'),
        pf ? row('spark', 'Replay the app tour', 'A one-minute walk through everything', async () => { resetTips(); await tour({ force: true }); }, 'chevR', 'blue') : null,
        me.user.role === 'admin' ? row('info', 'Admin', 'People, plans, foods and activity', () => navigate('/admin'), 'chevR', 'gold') : null),
      await notificationsPanel(me),
      h('div', { style: 'margin-top:28px' }, h('button', { class: 'btn ghost block', onclick: () => confirmSheet('Sign out?', 'You will need your email and password to get back in.', 'Sign out', async () => { await signOut(); navigate('/login'); }) }, 'Sign out')));
  }, profileView);
}

const JOB_LABELS = [['morning', 'Morning brief', '8:00'], ['nudge', 'Nothing-logged nudge', '14:00'], ['evening', 'Evening check', '21:00'], ['crew', 'Crew update', '22:00'], ['weekly', 'Weekly review', 'Fri 12:00']];

/** Phone notifications on/off, plus which check-ins to get. */
async function notificationsPanel(me) {
  const sup = pushSupport();
  const on = sup.ok && await pushEnabled();
  const notify = me.profile?.notify ?? {};
  const row = h('button', { class: 'list-row', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      if (on) { await disablePush(); toast('Notifications off on this phone'); }
      else { await enablePush(); await api('POST', '/api/push/test', {}); toast('Notifications on. A test one is on its way.'); }
      profileView();
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
  } }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, on ? 'Phone notifications are on' : 'Turn on phone notifications'),
    h('span', { class: 'sub' }, sup.ok ? (on ? 'Tap to turn them off on this device' : 'Your coach checks in morning and evening') : sup.why)), icon('bell', 20));
  const toggles = me.profile ? JOB_LABELS.map(([k, label, at]) => {
    const enabled = notify[k] !== false;
    return h('label', { class: 'list-row', style: 'cursor:pointer' },
      h('span', { class: 'grow' }, h('span', { class: 'strong' }, label), h('span', { class: 'sub' }, at)),
      h('input', { type: 'checkbox', class: 'switch', checked: enabled, 'aria-label': label, onchange: async (e) => {
        try { await api('PUT', '/api/profile', { profile: { ...me.profile, notify: { ...notify, [k]: e.currentTarget.checked } } }); await loadMe(); }
        catch (err) { toast(err.message, 'bad'); e.currentTarget.checked = !e.currentTarget.checked; }
      } }));
  }) : [];
  return [h('p', { class: 'group-label' }, 'Reminders'), h('section', { class: 'section set-list' }, row, ...toggles)];
}
