import { h } from '../dom.js';
import { api } from '../api.js';
import { state, fmt } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { toast, confirmSheet, icon } from '../ui.js';
import { signOut, loadMe } from '../session.js';

export async function profileView() {
  const main = paint('profile', loading());
  await guard(main, async () => {
    await loadMe();
    const me = state.me;
    const t = me.targets;
    const hidden = Boolean(me.profile?.hideFromLeaderboard);
    const toggleHide = async () => {
      try { await api('PUT', '/api/profile', { profile: { ...me.profile, hideFromLeaderboard: !hidden } }); toast(!hidden ? 'Hidden from the leaderboard' : 'Visible on the leaderboard'); profileView(); } catch (e) { toast(e.message, 'bad'); }
    };
    main.replaceChildren(
      h('h1', { class: 'title' }, me.user.name),
      h('p', { class: 'sub' }, `${me.user.email} · ${me.user.role === 'admin' ? 'Administrator' : 'Member'}`),
      t ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Daily targets'), h('span', { class: 'sub' }, t.overridden ? 'Set by the admin' : '')),
        h('p', { style: 'margin-top:12px' }, h('span', { class: 'num', style: 'font-size:40px' }, fmt(t.kcal)), ' kcal'),
        h('p', { class: 'sub' }, `Protein ${t.proteinG} g · Carbs ${t.carbsG} g · Fat ${t.fatG} g`),
        h('p', { class: 'sub' }, `Resting burn ${fmt(t.bmr)} kcal (${t.bmrFormula === 'katch-mcardle' ? 'Katch-McArdle' : 'Mifflin-St Jeor'})${t.bodyFatPct ? `, body fat ${t.bodyFatPct}%${t.bodyFatEstimated ? ' estimated' : ''}` : ''}`),
        ...(t.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:8px' }, w))) : null,
      h('section', { class: 'section' },
        h('button', { class: 'list-row', onclick: () => navigate('/onboarding?edit=1') }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Edit my details and food choices'), h('span', { class: 'sub' }, 'Weight, goal, foods you like or avoid, training')), icon('chevR', 20)),
        me.profile ? h('button', { class: 'list-row', onclick: toggleHide }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, hidden ? 'Show me on the leaderboard' : 'Hide me from the leaderboard'), h('span', { class: 'sub' }, hidden ? 'You are hidden from the other members' : 'Other members can see your score')), icon('chevR', 20)) : null,
        me.user.role === 'admin' ? h('button', { class: 'list-row', onclick: () => navigate('/admin') }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Admin'), h('span', { class: 'sub' }, 'People, plans, foods and activity')), icon('chevR', 20)) : null),
      h('div', { style: 'margin-top:28px' }, h('button', { class: 'btn ghost', onclick: () => confirmSheet('Sign out?', 'You will need your email and password to get back in.', 'Sign out', async () => { await signOut(); navigate('/login'); }) }, 'Sign out')));
  }, profileView);
}
