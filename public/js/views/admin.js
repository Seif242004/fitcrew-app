import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { sheet, toast, confirmSheet, field, numInput, foodPicker, exercisePicker, seg, icon, emptyState } from '../ui.js';
import { loadMe } from '../session.js';
import { scoreBars } from './progress.js';

const ALLERGENS = [['egg', 'Eggs'], ['dairy', 'Dairy'], ['nuts', 'Tree nuts'], ['peanut', 'Peanuts'], ['gluten', 'Gluten'], ['fish', 'Fish'], ['sesame', 'Sesame'], ['soy', 'Soy']];
const ROLES = [['mainProtein', 'Lunch or dinner protein'], ['vegMain', 'Vegetarian main'], ['bfProtein', 'Breakfast protein'], ['carb', 'Carb side'], ['bfCarb', 'Breakfast carb'], ['fruit', 'Fruit'], ['veg', 'Vegetable'], ['fat', 'Fat or oil'], ['snack', 'Snack protein'], ['boost', 'Protein top-up']];
const ago = (iso) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function viewAs(user, path) {
  state.as = { id: user.id, name: user.name };
  await loadMe();
  navigate(path);
}

const back = (to, label) => h('p', { style: 'margin:0 0 10px -4px' }, h('button', { class: 'link', style: 'text-decoration:none;font-weight:600', onclick: () => navigate(to) }, `‹ ${label}`));

// ---------------------------------------------------------------- home
export async function adminHome() {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const [{ users }, settings] = await Promise.all([api('GET', `/api/admin/users?today=${localDate()}`), api('GET', '/api/admin/settings')]);
    const review = users.filter((u) => u.pendingPlanId || u.pendingWorkoutPlanId || u.openRequests);
    const checkins = settings.pendingCheckins ?? 0;
    main.replaceChildren(
      h('h1', { class: 'title' }, 'Admin'),
      h('button', { class: 'btn block', style: 'margin-top:14px', onclick: inviteSheet }, icon('plus', 20), 'Invite someone'),
      aiPanel(settings),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Needs a person')),
        checkins ? h('button', { class: 'list-row', onclick: () => navigate('/admin/checkins') }, icon('camera', 22),
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, `${checkins} gym photo${checkins > 1 ? 's' : ''} look${checkins > 1 ? '' : 's'} like a repeat`), h('span', { class: 'sub' }, 'Already counted. Revoke if fake')), icon('chevR', 20)) : null,
        review.length ? review.map((u) => h('button', { class: 'list-row', onclick: () => navigate(u.pendingPlanId ? `/admin/plan/${u.pendingPlanId}` : u.pendingWorkoutPlanId ? `/admin/workout/${u.pendingWorkoutPlanId}` : `/admin/user/${u.id}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, u.name), h('span', { class: 'sub' }, [u.pendingPlanId ? 'New diet plan waiting for approval' : null, u.pendingWorkoutPlanId ? 'New workout plan waiting for approval' : null, u.openRequests ? `${u.openRequests} change request${u.openRequests > 1 ? 's' : ''}` : null].filter(Boolean).join(' · '))), icon('chevR', 20)))
          : checkins ? null : h('p', { class: 'sub', style: 'padding:8px 0 16px' }, settings.aiAutoApprove ? 'Nothing waiting. The AI approves safe plans itself; only plans that fail a safety rule land here.' : 'Nothing waiting. New plans and change requests show up here.')),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'People'), h('span', { class: 'sub' }, `${users.length}`)),
        users.map((u) => h('button', { class: 'list-row', onclick: () => navigate(`/admin/user/${u.id}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, u.name, u.role === 'admin' ? ' · admin' : '', u.private ? ' · private' : '', u.active ? '' : ' · deactivated'),
            h('span', { class: 'sub' }, !u.hasProfile ? 'Has not finished setup' : !u.activePlanId ? 'No active plan' : u.avg7 === null ? 'No finished days yet' : `7-day average ${u.avg7}`)), icon('chevR', 20)))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Manage')),
        [['Gym check-ins', 'Attendance photos: approve, reject or revoke', () => navigate('/admin/checkins')],
         ['Competition prize', settings.competitionPrize ? `This month: ${settings.competitionPrize}` : 'What the month\'s winner gets. Shown on the Crew page.', () => prizeSheet(settings.competitionPrize, run)],
         ['Reset leaderboard points', 'Everyone starts from zero today: points, season and streaks. Logs are kept.', () => confirmSheet('Reset everyone\'s points?', 'The leaderboard, season totals and streaks start again from today. Nothing logged is deleted, and personal progress charts are unchanged.', 'Reset points', async () => {
           try { await api('POST', '/api/admin/reset-scores', { today: localDate() }); toast('Points reset. Everyone starts from zero today.'); } catch (e) { toast(e.message, 'bad'); }
         }, true)],
         ['Start everyone over', 'Wipe every member\'s plans, logs, training and photos. Accounts and sign-ins stay.', () => freshStartSheet()],
         ['Clean up old plans', 'Delete rejected drafts and plans that ended over 2 weeks ago, for everyone', () => cleanupSheet(null, run)],
         ['Foods', 'Edit the food list and nutrition values', () => navigate('/admin/foods')],
         ['Exercises', 'Edit the exercise library', () => navigate('/admin/exercises')],
         ['Activity log', 'Everything admins changed', () => navigate('/admin/audit')],
         ['Download backup', 'A copy of the whole database. Keep it private.', () => { location.href = '/api/admin/backup'; }]]
          .map(([label, hint, go]) => h('button', { class: 'list-row', onclick: go }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, label), h('span', { class: 'sub' }, hint)), icon('chevR', 20)))));
  }, run);
  await run();
}

function inviteSheet() {
  sheet('Invite someone', (close) => {
    const note = h('input', { type: 'text', placeholder: 'Who is this for? (optional)', 'aria-label': 'Who is this invite for' });
    const priv = h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Private member' });
    const privRow = h('label', { class: 'list-row', style: 'cursor:pointer' }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Private member'), h('span', { class: 'sub' }, 'Nobody but admins will ever see them, from the moment they sign up.')), priv);
    const out = h('div', { class: 'stack' });
    const make = h('button', { class: 'btn block', onclick: async () => {
      try {
        const { code } = await api('POST', '/api/admin/invites', { note: note.value, private: priv.checked });
        // The code rides in the link, so the friend only taps it.
        const link = `${location.origin}/#/register?code=${encodeURIComponent(code)}`;
        const text = `Join our FitCrew 💪\n${link}\n\nOpen it in Safari (iPhone) or Chrome (Android), create your account, then add it to your home screen: iPhone: Share → Add to Home Screen. Android: menu ⋮ → Install app.\n\nInvite code if asked: ${code}`;
        const share = async () => {
          if (navigator.share) { try { await navigator.share({ title: 'Join FitCrew', text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
          try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into WhatsApp.'); } catch { toast(text); }
        };
        out.replaceChildren(
          h('p', { class: 'num', style: 'font-size:44px;letter-spacing:.08em' }, code),
          h('p', { class: 'sub' }, 'Valid for 7 days, works once. The link already contains the code.'),
          h('button', { class: 'btn block', onclick: share }, navigator.share ? 'Share invite (WhatsApp…)' : 'Copy the invite message'),
          h('a', { class: 'btn ghost block', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, 'Send on WhatsApp'));
        make.remove(); note.remove(); privRow.remove();
      } catch (e) { toast(e.message, 'bad'); }
    } }, 'Create invite code');
    return h('div', { class: 'stack' }, h('p', { class: 'sub' }, 'Each code lets one person create an account. Nobody can join without one.'), note, privRow, make, out);
  });
}

// ---------------------------------------------------------------- one person
export async function adminUser({ id }) {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const d = await api('GET', `/api/admin/users/${id}?today=${localDate()}`);
    const u = d.user;
    const t = d.targets;
    const self = u.id === state.me.user.id;
    main.replaceChildren(
      back('/admin', 'Admin'),
      h('h1', { class: 'title' }, u.name),
      h('p', { class: 'sub' }, `${u.email} · ${u.role === 'admin' ? 'Administrator' : 'Member'}${u.private ? ' · private (only admins see them)' : ''}${u.active ? '' : ' · deactivated'}`),
      d.profile ? h('button', { class: 'btn block', style: 'margin-top:14px', onclick: () => viewAs(u, '/today') }, `Open the app as ${u.name.split(' ')[0]}`) : null,
      d.profile ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Actions')),
        h('button', { class: 'list-row', onclick: async (ev) => {
          // The AI menu can take ~30 s: lock the row and say so.
          const b = ev.currentTarget; if (b.disabled) return;
          const hint = b.querySelector('.sub'); b.disabled = true; hint.textContent = 'Drafting… this can take up to a minute';
          try { const r = await api('POST', `/api/admin/users/${id}/plans/generate`, {}); navigate(`/admin/plan/${r.planId}`); }
          catch (e) { toast(e.message, 'bad'); b.disabled = false; hint.textContent = 'AI picks the meals, the solver sizes portions'; }
        } }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Draft a new diet plan'), h('span', { class: 'sub' }, 'AI picks the meals, the solver sizes portions')), icon('chevR', 20)),
        h('button', { class: 'list-row', onclick: async () => { try { const r = await api('POST', `/api/admin/users/${id}/workout-plans/generate`, {}); navigate(`/admin/workout/${r.planId}`); } catch (e) { toast(e.message, 'bad'); } } },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Draft a new workout plan'), h('span', { class: 'sub' }, 'From their experience, days and equipment')), icon('chevR', 20)),
        h('button', { class: 'list-row', onclick: () => viewAs(u, '/onboarding?edit=1') },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Edit their details'), h('span', { class: 'sub' }, 'Body, goal, food choices, training')), icon('chevR', 20))) : null,
      !d.profile ? h('p', { class: 'notice', style: 'margin-top:16px' }, `${u.name} has not finished setting up yet.`) : null,
      t ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Daily targets'), h('button', { class: 'link', onclick: () => targetsSheet(id, d, run) }, 'Change')),
        h('p', { style: 'margin-top:12px' }, h('span', { class: 'num', style: 'font-size:40px' }, fmt(t.kcal)), ' kcal'),
        h('p', { class: 'sub' }, `Protein ${t.proteinG} g · Carbs ${t.carbsG} g · Fat ${t.fatG} g`),
        t.overridden ? h('p', { class: 'sub' }, `Set by you. Calculated: ${fmt(d.computedTargets.kcal)} kcal.`) : null,
        ...(t.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:8px' }, w))) : null,
      d.scores.length ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Last 14 days')), h('div', { style: 'margin-top:12px' }, scoreBars(d.scores, localDate()))) : null,
      d.profile ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Gym attendance'), h('span', { class: 'sub' }, `${d.attendance.attended} of ${d.attendance.planned} in 4 weeks`)),
        d.checkins.length ? d.checkins.slice(0, 6).map((c) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, fmtDate(c.date)), h('span', { class: 'sub' }, c.hasPhoto ? 'Photo check-in' : 'Marked by an admin')),
          h('span', { class: `status ${c.status === 'approved' ? 'ok' : c.status === 'pending' ? 'warn' : 'bad'}` }, c.status))) : h('p', { class: 'sub', style: 'padding:6px 0' }, 'No check-ins yet.'),
        h('div', { class: 'row-flex', style: 'padding:10px 0' },
          h('button', { class: 'btn small ghost', onclick: () => markSheet(u, run) }, 'Mark attended'),
          h('button', { class: 'btn small ghost', onclick: () => navigate('/admin/checkins') }, 'Review check-ins'))) : null,
      d.requests.some((r) => r.status === 'open') ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Change requests')),
        d.requests.filter((r) => r.status === 'open').map((r) => h('div', { class: 'list-row' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, r.note), h('span', { class: 'sub' }, ago(r.created_at))),
          h('button', { class: 'btn small ghost', onclick: async () => { await api('POST', `/api/admin/requests/${r.id}/resolve`, { note: '' }); run(); } }, 'Done')))) : null,
      d.plans.length ? planList('Diet plans', d.plans, '/admin/plan', '/api/admin/plans', run) : null,
      d.workoutPlans?.length ? planList('Workout plans', d.workoutPlans, '/admin/workout', '/api/admin/workout-plans', run) : null,
      d.plans.length + (d.workoutPlans?.length ?? 0) > 2 ? h('p', { style: 'margin-top:12px' }, h('button', { class: 'link', onclick: () => cleanupSheet(u, run) }, `Clean up ${u.name.split(' ')[0]}'s old plans`)) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Account')),
        h('button', { class: 'list-row', onclick: () => renameSheet(u, run) }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Change name')), icon('chevR', 20)),
        self ? null : h('label', { class: 'list-row', style: 'cursor:pointer' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Private member'), h('span', { class: 'sub' }, u.private ? 'Only admins see them: not on the board, not in the feed, not competing.' : 'Hide them from every other member: board, feed, competition and reactions.')),
          h('input', { type: 'checkbox', class: 'switch', checked: Boolean(u.private), 'aria-label': 'Private member', onchange: async (e) => {
            const on = e.currentTarget.checked;
            try { await api('PUT', `/api/admin/users/${id}`, { private: on }); toast(on ? `${u.name} is private now` : `${u.name} is visible to the crew again`); run(); }
            catch (err) { toast(err.message, 'bad'); e.currentTarget.checked = !on; }
          } })),
        h('button', { class: 'list-row', onclick: () => passwordSheet(u) }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Set a new password'), h('span', { class: 'sub' }, 'They are signed out everywhere')), icon('chevR', 20)),
        self ? null : h('button', { class: 'list-row', onclick: () => confirmSheet(u.role === 'admin' ? 'Make a member?' : 'Make an admin?', u.role === 'admin' ? `${u.name} will lose admin access.` : `${u.name} will be able to see and edit everyone's data.`, 'Confirm', async () => { try { await api('PUT', `/api/admin/users/${id}`, { role: u.role === 'admin' ? 'user' : 'admin' }); run(); } catch (e) { toast(e.message, 'bad'); } }) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, u.role === 'admin' ? 'Remove admin access' : 'Make admin')), icon('chevR', 20)),
        self ? null : h('button', { class: 'list-row', onclick: () => confirmSheet(u.active ? 'Deactivate this account?' : 'Reactivate this account?', u.active ? `${u.name} will be signed out and cannot sign in. Their data is kept.` : `${u.name} will be able to sign in again.`, u.active ? 'Deactivate' : 'Reactivate', async () => { try { await api('PUT', `/api/admin/users/${id}`, { active: !u.active }); run(); } catch (e) { toast(e.message, 'bad'); } }, u.active) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, u.active ? 'Deactivate account' : 'Reactivate account')), icon('chevR', 20))));
  }, run);
  await run();
}

function targetsSheet(id, d, done) {
  sheet('Daily targets', (close) => {
    const t = d.targets;
    const i = { kcal: numInput(t.kcal, { min: 800, max: 6000 }), p: numInput(t.proteinG, { min: 30, max: 400 }), c: numInput(t.carbsG, { min: 0, max: 900 }), f: numInput(t.fatG, { min: 15, max: 300 }) };
    const sum = h('p', { class: 'sub', 'aria-live': 'polite' });
    const upd = () => { sum.textContent = `Macros add up to ${fmt(Number(i.p.value) * 4 + Number(i.c.value) * 4 + Number(i.f.value) * 9)} kcal.`; };
    Object.values(i).forEach((el) => el.addEventListener('input', upd));
    upd();
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, `Calculated for them: ${fmt(d.computedTargets.kcal)} kcal, protein ${d.computedTargets.proteinG} g, carbs ${d.computedTargets.carbsG} g, fat ${d.computedTargets.fatG} g.`),
      field('Calories', i.kcal), h('div', { class: 'grid3' }, field('Protein (g)', i.p), field('Carbs (g)', i.c), field('Fat (g)', i.f)), sum,
      h('div', { class: 'row-flex' },
        h('button', { class: 'btn', onclick: async () => { try { await api('PUT', `/api/admin/users/${id}/targets`, { override: { kcal: Number(i.kcal.value), proteinG: Number(i.p.value), carbsG: Number(i.c.value), fatG: Number(i.f.value) } }); close(); toast('Targets saved. Draft a new plan to use them.'); done(); } catch (e) { toast(e.message, 'bad'); } } }, 'Save targets'),
        t.overridden ? h('button', { class: 'btn ghost', onclick: async () => { await api('PUT', `/api/admin/users/${id}/targets`, { override: null }); close(); done(); } }, 'Use calculated') : null));
  });
}

function renameSheet(u, done) {
  sheet('Change name', (close) => {
    const name = h('input', { type: 'text', value: u.name, 'aria-label': 'Name' });
    return h('div', { class: 'stack' }, name, h('button', { class: 'btn block', onclick: async () => { try { await api('PUT', `/api/admin/users/${u.id}`, { name: name.value }); close(); done(); } catch (e) { toast(e.message, 'bad'); } } }, 'Save'));
  });
}

function passwordSheet(u) {
  sheet(`New password for ${u.name}`, (close) => {
    const pw = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'New password', placeholder: 'At least 8 characters' });
    return h('div', { class: 'stack' }, h('p', { class: 'sub' }, 'Tell them the new password in person or in a private message.'), pw,
      h('button', { class: 'btn block', onclick: async () => { try { await api('POST', `/api/admin/users/${u.id}/reset-password`, { password: pw.value }); close(); toast('Password changed'); } catch (e) { toast(e.message, 'bad'); } } }, 'Set password'));
  });
}

// ---------------------------------------------------------------- plan editor
export async function adminPlan({ id }) {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const [{ plan }, { foods }] = await Promise.all([api('GET', `/api/admin/plans/${id}`), api('GET', '/api/foods')]);
    const byId = new Map(foods.map((f) => [f.id, f]));
    const days = structuredClone(plan.days);
    let sel = 0; let dirty = false;
    const editable = plan.status === 'pending' || plan.status === 'active' || plan.status === 'archived';

    const macrosOf = (item) => {
      const f = byId.get(item.foodId);
      const k = f ? item.grams / 100 : 0;
      return f ? { kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k } : { kcal: item.kcal, p: item.p, c: item.c, f: item.f };
    };
    const totals = (items) => items.reduce((a, it) => { const m = macrosOf(it); return { kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { kcal: 0, p: 0, c: 0, f: 0 });

    const tabs = h('div', { class: 'chips', style: 'margin:6px 0' });
    const body = h('div', {});
    const draw = () => {
      tabs.replaceChildren(...days.map((_, i) => h('button', { class: 'chip', 'aria-pressed': String(i === sel), onclick: () => { sel = i; draw(); } }, `Day ${i + 1}`)));
      const dayT = totals(days[sel].meals.flatMap((m) => m.items));
      body.replaceChildren(
        h('p', { class: 'sub', style: 'margin:8px 0' }, `Target ${fmt(plan.targets.kcal)} kcal, protein ${plan.targets.proteinG} g. This day: ${fmt(dayT.kcal)} kcal · P ${fmt(dayT.p)} · C ${fmt(dayT.c)} · F ${fmt(dayT.f)}`),
        ...days[sel].meals.map((m, mi) => h('section', { class: 'section' },
          h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, m.name), h('span', { class: 'sub' }, `${fmt(totals(m.items).kcal)} kcal`)),
          m.items.map((it, ii) => {
            const g = numInput(it.grams, { min: 0, max: 2000, 'aria-label': `Grams of ${it.name}`, style: 'width:92px;min-height:44px' });
            g.addEventListener('change', () => { it.grams = Number(g.value); dirty = true; draw(); });
            return h('div', { class: 'item' },
              h('button', { class: 'item-main', onclick: () => sheet('Change food', (close) => foodPicker((f) => { it.foodId = f.id; it.name = f.name; dirty = true; close(); draw(); })), 'aria-label': `Change ${it.name}` }, h('span', { class: 'item-name' }, it.name), h('span', { class: 'item-amt' }, `${fmt(macrosOf(it).kcal)} kcal · P ${fmt(macrosOf(it).p)} g`)),
              g, h('span', { class: 'sub' }, 'g'),
              h('button', { class: 'icon-btn', 'aria-label': `Remove ${it.name}`, onclick: () => { m.items.splice(ii, 1); dirty = true; draw(); } }, icon('trash', 20)));
          }),
          h('button', { class: 'add-row', onclick: () => sheet(`Add to ${m.name}`, (close) => foodPicker((f) => { days[sel].meals[mi].items.push({ foodId: f.id, name: f.name, grams: 100 }); dirty = true; close(); draw(); })) }, icon('plus', 22), 'Add a food'))));
    };
    draw();

    const start = h('input', { type: 'date', value: localDate(), 'aria-label': 'Plan start date' });
    const payload = () => ({ days: days.map((d) => ({ meals: d.meals.map((m) => ({ name: m.name, items: m.items.map((i) => ({ foodId: i.foodId, grams: i.grams })) })) })) });
    const save = async () => { await api('PUT', `/api/admin/plans/${id}`, payload()); dirty = false; };

    main.replaceChildren(
      back(`/admin/user/${plan.userId}`, 'Back'),
      h('h1', { class: 'title' }, `Plan version ${plan.version}`),
      h('p', { class: 'sub' }, `${plan.status === 'pending' ? 'Waiting for approval' : plan.status} · average ${fmt(plan.summary.kcal)} kcal, protein ${plan.summary.p} g, carbs ${plan.summary.c} g, fat ${plan.summary.f} g`),
      plan.source ? h('p', { class: 'sub' }, plan.source === 'templates' ? 'Menu: meal templates' : plan.source === 'ai' ? 'Menu: AI-picked, portions by the solver' : 'Menu: AI-picked, some days from templates') : null,
      plan.review ? h('p', { class: plan.review.issues.length ? 'notice' : 'sub', style: 'margin-top:10px' }, plan.review.issues.length ? `The AI held this plan back: ${plan.review.issues.join(' ')}` : 'The AI checked this plan and found no problems.') : null,
      ...[plan.aiNote, ...(plan.warnings ?? [])].filter(Boolean).map((w) => h('p', { class: 'notice', style: 'margin-top:10px' }, w)),
      tabs, body,
      editable ? h('section', { class: 'section stack' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, plan.status === 'active' ? 'This plan is live' : 'Approve')),
        plan.status === 'active' ? null : field('Starts on', start, 'Day 1 of the plan is this date.'),
        h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
          h('button', { class: 'btn ghost', onclick: async () => { try { await save(); toast('Saved'); run(); } catch (e) { toast(e.message, 'bad'); } } }, plan.status === 'active' ? 'Save changes to the live plan' : 'Save draft'),
          plan.status === 'active' ? null : h('button', { class: 'btn', onclick: async () => { try { if (dirty) await save(); await api('POST', `/api/admin/plans/${id}/approve`, { startDate: start.value }); toast('Plan approved'); navigate(`/admin/user/${plan.userId}`); } catch (e) { toast(e.message, 'bad'); } } }, 'Approve and publish'),
          plan.status === 'pending' ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Reject this draft?', 'The draft is discarded. You can draft a new one from the person\'s page.', 'Reject', async () => { await api('POST', `/api/admin/plans/${id}/reject`, {}); navigate(`/admin/user/${plan.userId}`); }, true) }, 'Reject') : null)) : null,
      plan.status === 'active' ? null : h('p', { style: 'margin-top:16px' }, h('button', { class: 'link', style: 'color:var(--bad)', onclick: () => deletePlan('/api/admin/plans', plan, () => navigate(`/admin/user/${plan.userId}`)) }, 'Delete this plan')));
  }, run);
  await run();
}

// ---------------------------------------------------------------- foods
export async function adminFoods() {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const { foods } = await api('GET', '/api/foods');
    const list = h('div', {});
    const q = h('input', { type: 'text', placeholder: 'Search foods', 'aria-label': 'Search foods' });
    const drawList = () => {
      const s = q.value.trim().toLowerCase();
      list.replaceChildren(...foods.filter((f) => !s || f.name.toLowerCase().includes(s)).map((f) => h('button', { class: 'list-row', onclick: () => foodSheet(f, run) },
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, f.name, f.custom ? ' · yours' : ''), h('span', { class: 'sub' }, `${fmt(f.kcal)} kcal · P ${f.p} · C ${f.c} · F ${f.f} per 100 g`)), icon('chevR', 20))));
    };
    q.addEventListener('input', drawList);
    drawList();
    main.replaceChildren(back('/admin', 'Admin'), h('h1', { class: 'title' }, 'Foods'),
      h('div', { class: 'row-flex', style: 'margin:14px 0' }, h('div', { style: 'flex:1' }, q), h('button', { class: 'btn', onclick: () => foodSheet(null, run) }, 'Add food')),
      h('p', { class: 'sub', style: 'margin-bottom:6px' }, 'Values are per 100 g, as eaten (cooked weight for cooked foods).'), list);
  }, run);
  await run();
}

function foodSheet(food, done) {
  sheet(food ? 'Edit food' : 'Add a food', (close) => {
    const f = food ?? { name: '', cat: 'protein', kcal: '', p: '', c: '', f: '', roles: [], tags: [], veg: false, step: 5, max: 500 };
    const roles = new Set(f.roles); const tags = new Set(f.tags);
    const name = h('input', { type: 'text', value: f.name, 'aria-label': 'Food name' });
    const cat = h('select', { 'aria-label': 'Category' }, [['protein', 'Protein'], ['dairy', 'Dairy'], ['carb', 'Carb'], ['fruit', 'Fruit'], ['veg', 'Vegetable'], ['fat', 'Fat']].map(([v, l]) => h('option', { value: v, selected: f.cat === v ? true : null }, l)));
    const i = { kcal: numInput(f.kcal, { min: 0, max: 900 }), p: numInput(f.p, { min: 0, max: 100 }), c: numInput(f.c, { min: 0, max: 100 }), f: numInput(f.f, { min: 0, max: 100 }), step: numInput(f.step, { min: 1, max: 100 }), max: numInput(f.max, { min: 1, max: 3000 }) };
    const veg = h('input', { type: 'checkbox', checked: f.veg, style: 'width:24px;height:24px' });
    const toggles = (set, items) => h('div', { class: 'chips' }, items.map(([id, label]) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(set.has(id)) }, label);
      b.addEventListener('click', () => { if (set.has(id)) set.delete(id); else set.add(id); b.setAttribute('aria-pressed', String(set.has(id))); });
      return b;
    }));
    const save = async () => {
      const body = { name: name.value, cat: cat.value, kcal: i.kcal.value, p: i.p.value, c: i.c.value, f: i.f.value, step: i.step.value, max: i.max.value, veg: veg.checked, roles: [...roles], tags: [...tags] };
      try { if (food) await api('PUT', `/api/admin/foods/${food.id}`, body); else await api('POST', '/api/admin/foods', body); close(); toast('Saved'); done(); } catch (e) { toast(e.message, 'bad'); }
    };
    return h('div', { class: 'stack' },
      field('Name', name), field('Category', cat),
      h('div', { class: 'grid2' }, field('Calories', i.kcal), field('Protein (g)', i.p)),
      h('div', { class: 'grid2' }, field('Carbs (g)', i.c), field('Fat (g)', i.f)),
      h('div', { class: 'grid2' }, field('Round portions to (g)', i.step), field('Largest portion (g)', i.max)),
      h('label', { class: 'row-flex' }, veg, h('span', {}, 'Suitable for vegetarians')),
      h('div', {}, h('p', { style: 'font-weight:600;margin-bottom:8px' }, 'Where plans may use it'), toggles(roles, ROLES)),
      h('div', {}, h('p', { style: 'font-weight:600;margin-bottom:8px' }, 'Contains'), toggles(tags, ALLERGENS)), h('div', {}, h('p', { style: 'font-weight:600;margin-bottom:8px' }, 'Price'), toggles(tags, [['pricey', 'Expensive (left out on a tight budget)']])),
      h('div', { class: 'row-flex' }, h('button', { class: 'btn', onclick: save }, 'Save'),
        food ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Remove this food?', 'It disappears from the food list and new plans. Existing plans that use it keep working.', 'Remove', async () => { await api('DELETE', `/api/admin/foods/${food.id}`); close(); done(); }, true) }, 'Remove') : null));
  });
}

// ---------------------------------------------------------------- activity log
export async function adminAudit() {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const { entries } = await api('GET', '/api/admin/audit');
    main.replaceChildren(back('/admin', 'Admin'), h('h1', { class: 'title' }, 'Activity log'),
      h('p', { class: 'sub', style: 'margin:6px 0' }, 'Every change an admin makes to someone else\'s data is recorded here.'),
      entries.length ? entries.map((e) => h('div', { class: 'list-row', style: 'cursor:default' },
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, e.action.replace(/[._]/g, ' ')), h('span', { class: 'sub' }, `${e.actor ?? 'Someone'}${e.target ? ` → ${e.target}` : ''} · ${ago(e.at)}`)))) : emptyState('Nothing yet', 'Changes will appear here.'));
  }, run);
  await run();
}

// ---------------------------------------------------------------- plans list, delete, clean-up
/** A person's plans with a delete button on every plan that is not live. */
function planList(title, plans, viewPath, apiPath, done) {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, title), h('span', { class: 'sub' }, `${plans.length}`)),
    plans.map((p) => h('div', { class: 'list-row' },
      h('button', { class: 'grow plain-btn', onclick: () => navigate(`${viewPath}/${p.id}`) },
        h('span', { class: 'strong' }, `Version ${p.version} `, h('span', { class: `status ${p.status === 'active' ? 'ok' : p.status === 'pending' ? 'warn' : 'idle'}` }, p.status === 'pending' ? 'needs review' : p.status)),
        h('span', { class: 'sub' }, `${p.start_date ? `Started ${fmtDate(p.start_date)}` : `Drafted ${ago(p.created_at)}`}${p.note ? ` · ${p.note}` : ''}`)),
      p.status === 'active' ? null : h('button', { class: 'icon-btn', 'aria-label': `Delete version ${p.version}`, onclick: () => deletePlan(apiPath, p, done) }, icon('trash', 20)))));
}

function deletePlan(apiPath, p, done) {
  confirmSheet(`Delete version ${p.version}?`, p.status === 'archived' ? 'It is removed for good. Days this plan covered lose their score history.' : 'It is removed for good.', 'Delete', async () => {
    try { await api('DELETE', `${apiPath}/${p.id}`); toast('Plan deleted'); done(); } catch (e) { toast(e.message, 'bad'); }
  }, true);
}

function cleanupSheet(user, done) {
  confirmSheet(user ? `Clean up ${user.name}'s plans?` : 'Clean up old plans for everyone?',
    'Deletes rejected drafts and diet and workout plans that ended more than 2 weeks ago. Live plans, drafts waiting for review and the last 2 weeks of scores are kept.', 'Clean up', async () => {
      try {
        const r = await api('POST', '/api/admin/cleanup', { userId: user?.id, keepDays: 14, today: localDate() });
        toast(r.deleted.diet + r.deleted.training ? `Deleted ${r.deleted.diet} diet and ${r.deleted.training} workout plan${r.deleted.training === 1 ? '' : 's'}` : 'Nothing old enough to delete');
        done();
      } catch (e) { toast(e.message, 'bad'); }
    });
}

function markSheet(u, done) {
  sheet(`Mark ${u.name.split(' ')[0]} as attended`, (close) => {
    const date = h('input', { type: 'date', value: localDate(), max: localDate(), 'aria-label': 'Date' });
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'For when the photo did not work. It counts like an approved check-in.'),
      field('Date', date),
      h('button', { class: 'btn block', onclick: async () => {
        try { await api('POST', `/api/admin/users/${u.id}/checkins`, { date: date.value }); close(); toast('Attendance marked'); done(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Mark attended'));
  });
}

// ---------------------------------------------------------------- gym check-ins
export async function adminCheckins() {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const { pending, recent } = await api('GET', `/api/admin/checkins?today=${localDate()}`);
    // Check-ins are approved the moment they are sent. The admin's job is to revoke fakes:
    // photos that match an earlier one are flagged at the top until someone has looked at them.
    const review = async (c, status, undo = true) => {
      try {
        await api('POST', `/api/admin/checkins/${c.id}/review`, { status });
        toast(status === 'approved' ? `${c.name}'s check-in counts again` : `${c.name}'s check-in revoked: 15 points removed`, '', undo ? { label: 'Undo', run: () => review(c, status === 'approved' ? 'rejected' : 'approved', false) } : null);
        run();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const keep = async (c) => { try { await api('POST', `/api/admin/checkins/${c.id}/review`, { status: 'approved', reason: 'Checked by the admin' }); toast('Marked as checked'); run(); } catch (e) { toast(e.message, 'bad'); } };
    const card = (c, actions) => h('div', { class: 'ci-card' },
      c.hasPhoto ? h('a', { href: `/api/checkins/${c.id}/photo`, target: '_blank', rel: 'noopener', 'aria-label': `Open ${c.name}'s photo` }, h('img', { src: `/api/checkins/${c.id}/photo`, alt: `${c.name} check-in photo`, loading: 'lazy' })) : h('div', { class: 'noimg' }, 'No photo'),
      h('div', {},
        h('p', { class: 'h3' }, c.name),
        h('p', { class: 'sub' }, fmtDate(c.date, { weekday: 'long', day: 'numeric', month: 'short' })),
        c.verdict?.flag && !c.verdict?.admin ? h('p', { class: 'sub', style: 'margin-top:4px;color:var(--warn)' }, c.verdict.reason) : c.verdict?.admin?.reason ? h('p', { class: 'sub', style: 'margin-top:4px' }, c.verdict.admin.reason) : null,
        h('div', { class: 'actions' }, actions)));
    const all = [...pending, ...recent];
    const flagged = all.filter((c) => c.status !== 'rejected' && c.verdict?.flag && !c.verdict?.admin);
    const rest = all.filter((c) => !flagged.includes(c));
    const actionsFor = (c) => c.status === 'rejected'
      ? [h('span', { class: 'status bad', style: 'margin-right:8px' }, 'Revoked'), h('button', { class: 'btn small ghost', onclick: () => review(c, 'approved') }, 'Count it again')]
      : [h('span', { class: 'status ok', style: 'margin-right:8px' }, 'Counted'), h('button', { class: 'btn small danger', onclick: () => review(c, 'rejected') }, 'Revoke')];
    main.replaceChildren(
      back('/admin', 'Admin'),
      h('h1', { class: 'title' }, 'Gym check-ins'),
      h('p', { class: 'sub', style: 'margin-top:-8px' }, 'Every gym photo counts straight away. Revoke any that look fake; the 15 points come off and the member is told.'),
      flagged.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Looks like a repeat'), h('span', { class: 'sub' }, `${flagged.length}`)),
        flagged.map((c) => card(c, [h('button', { class: 'btn small ghost', onclick: () => keep(c) }, 'It is fine'), h('button', { class: 'btn small danger', onclick: () => review(c, 'rejected') }, 'Revoke')]))) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Last 2 weeks')),
        rest.length ? rest.map((c) => card(c, actionsFor(c)))
          : h('p', { class: 'sub', style: 'padding:8px 0 16px' }, 'No check-ins yet.')));
  }, run);
  await run();
}

// ---------------------------------------------------------------- workout plan editor
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday first

export async function adminWorkoutPlan({ id }) {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const { plan } = await api('GET', `/api/admin/workout-plans/${id}`);
    const days = structuredClone(plan.days);
    let cardio = plan.cardio ? { ...plan.cardio } : null;
    let dirty = false;
    const body = h('div', {});
    const num = (obj, key, min, max, label, opts = {}) => {
      const el = numInput(obj[key] ?? '', { min, max, inputmode: 'numeric', 'aria-label': label, ...opts });
      el.addEventListener('change', () => { obj[key] = el.value === '' ? undefined : Number(el.value); dirty = true; });
      return h('label', { class: 'field' }, h('span', {}, label), el);
    };
    const txt = (obj, key, label, placeholder = '') => {
      const el = h('input', { type: 'text', value: obj[key] ?? '', placeholder, 'aria-label': label });
      el.addEventListener('change', () => { obj[key] = el.value.trim(); dirty = true; });
      return h('label', { class: 'field' }, h('span', {}, label), el);
    };
    const draw = () => {
      body.replaceChildren(...days.map((d, di) => h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, d.name), h('span', { class: 'sub' }, WEEKDAYS[d.weekday])),
        d.warmup?.length ? h('p', { class: 'sub', style: 'margin-bottom:6px' }, `Warm-up: ${d.warmup.map((w) => w.name).join(', ')}`) : null,
        d.exercises.map((e, ei) => h('div', { class: 'stack', style: 'padding:10px 0;border-bottom:1px solid var(--line, var(--hair))' },
          h('p', { class: 'strong' }, `${ei + 1}. ${e.name}`, h('span', { class: 'sub', style: 'display:block' }, e.muscle)),
          h('div', { class: 'row-flex', style: 'justify-content:flex-end;flex-wrap:nowrap;margin-top:4px' },
            h('span', { class: 'row-flex', style: 'flex-wrap:nowrap' },
              e.video ? h('a', { class: 'vbtn', href: e.video, target: '_blank', rel: 'noopener', 'aria-label': `Demo of ${e.name}` }, icon('play', 18)) : null,
              h('button', { class: 'icon-btn', 'aria-label': `Move ${e.name} up`, disabled: ei === 0 ? true : null, onclick: () => { [d.exercises[ei - 1], d.exercises[ei]] = [d.exercises[ei], d.exercises[ei - 1]]; dirty = true; draw(); } }, h('span', { style: 'display:inline-grid;transform:rotate(90deg)' }, icon('chevL', 18))),
              h('button', { class: 'btn small ghost', onclick: () => sheet(`Swap ${e.name}`, (close) => exercisePicker((x) => { Object.assign(e, { exerciseId: x.id, name: x.name, muscle: x.muscle, video: x.video }); dirty = true; close(); draw(); })) }, 'Swap'),
              h('button', { class: 'icon-btn', 'aria-label': `Remove ${e.name}`, onclick: () => { d.exercises.splice(ei, 1); dirty = true; draw(); } }, icon('trash', 20)))),
          h('div', { class: 'grid3' }, num(e, 'sets', 1, 10, 'Sets'), num(e, 'repMin', 1, 200, 'Min reps'), num(e, 'repMax', 1, 300, 'Max reps')),
          h('div', { class: 'grid3' }, num(e, 'rir', 0, 5, 'RIR'), num(e, 'restSec', 15, 600, 'Rest (s)'), txt(e, 'tempo', 'Tempo', '2-0-1-0')),
          txt(e, 'note', 'Note for this exercise (optional)', 'e.g. pause 1 s at the bottom'))),
        h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
          h('button', { class: 'add-row', style: 'width:auto', onclick: () => sheet(`Add to ${d.name}`, (close) => exercisePicker((x) => { d.exercises.push({ exerciseId: x.id, name: x.name, muscle: x.muscle, video: x.video, sets: 3, repMin: 10, repMax: 12, rir: 1, restSec: 90, tempo: '2-0-1-0' }); dirty = true; close(); draw(); })) }, icon('plus', 22), 'Add an exercise'),
          h('button', { class: 'link', onclick: () => confirmSheet('Remove this session?', `${d.name} on ${WEEKDAYS[d.weekday]} is removed from the plan.`, 'Remove', () => { days.splice(di, 1); dirty = true; draw(); }, true) }, 'Remove session')))),
      h('section', { class: 'section stack' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Cardio'), h('button', { class: 'link', onclick: () => { cardio = cardio ? null : { kind: 'Walk', label: 'Incline treadmill walk', minutes: 20, when: 'After training', note: '' }; dirty = true; draw(); } }, cardio ? 'Remove' : 'Add cardio')),
        cardio ? h('div', { class: 'stack', style: 'padding-bottom:12px' },
          h('div', { class: 'grid2' }, txt(cardio, 'label', 'Name', 'Incline treadmill walk'), num(cardio, 'minutes', 1, 120, 'Minutes')),
          txt(cardio, 'note', 'Note', 'Heart rate about 100–130')) : h('p', { class: 'sub', style: 'padding-bottom:12px' }, 'No cardio in this plan.')));
    };
    draw();

    const start = h('input', { type: 'date', value: localDate(), 'aria-label': 'Plan start date' });
    const payload = () => ({
      cardio,
      days: days.map((d) => ({
        weekday: d.weekday, name: d.name, focus: d.focus,
        warmup: (d.warmup ?? []).map((w) => ({ exerciseId: w.exerciseId, sets: w.sets, repMin: w.repMin, repMax: w.repMax })),
        exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, repMin: e.repMin, repMax: e.repMax, restSec: e.restSec, rir: e.rir, tempo: e.tempo, note: e.note })),
      })),
    });
    const save = async () => { await api('PUT', `/api/admin/workout-plans/${id}`, payload()); dirty = false; };
    const live = plan.status === 'active';
    const editable = ['pending', 'active', 'archived'].includes(plan.status);

    main.replaceChildren(
      back(`/admin/user/${plan.userId}`, 'Back'),
      h('h1', { class: 'title' }, `Workout plan version ${plan.version}`),
      h('p', { class: 'sub' }, `${plan.status === 'pending' ? 'Waiting for approval' : plan.status} · ${plan.daysPerWeek} sessions a week · ${plan.split ?? ''} · ${plan.experience ?? ''}`),
      plan.splitChoice ? h('p', { class: 'sub', style: 'margin-top:8px' }, `Split ${plan.splitChoice.by === 'ai' ? `picked by the AI${plan.splitChoice.model ? ` (${plan.splitChoice.model})` : ''}` : plan.splitChoice.by === 'member' ? 'chosen by the member' : 'picked by the rules (AI unavailable)'}: ${plan.splitChoice.reason}`) : null,
      plan.review ? h('p', { class: plan.review.issues.length ? 'notice' : 'sub', style: 'margin-top:8px' }, plan.review.issues.length ? `The AI held this plan back: ${plan.review.issues.join(' ')}` : 'The AI admin checked this plan: split fits the days, volume and safety rules pass.') : null,
      ...(plan.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:10px' }, w)),
      body,
      editable ? h('section', { class: 'section stack' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, live ? 'This plan is live' : 'Approve')),
        live ? null : field('Starts on', start, 'Sessions follow the weekdays above from this date.'),
        h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
          h('button', { class: 'btn ghost', onclick: async () => { try { await save(); toast('Saved'); run(); } catch (e) { toast(e.message, 'bad'); } } }, live ? 'Save changes to the live plan' : 'Save draft'),
          live ? null : h('button', { class: 'btn', onclick: async () => { try { if (dirty) await save(); await api('POST', `/api/admin/workout-plans/${id}/approve`, { startDate: start.value }); toast('Workout plan approved'); navigate(`/admin/user/${plan.userId}`); } catch (e) { toast(e.message, 'bad'); } } }, 'Approve and publish'),
          plan.status === 'pending' ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Reject this draft?', 'The draft is discarded. You can draft a new one from the person\'s page.', 'Reject', async () => { await api('POST', `/api/admin/workout-plans/${id}/reject`, {}); navigate(`/admin/user/${plan.userId}`); }, true) }, 'Reject') : null)) : null,
      live ? null : h('p', { style: 'margin-top:16px' }, h('button', { class: 'link', style: 'color:var(--bad)', onclick: () => deletePlan('/api/admin/workout-plans', plan, () => navigate(`/admin/user/${plan.userId}`)) }, 'Delete this plan')));
  }, run);
  await run();
}

// ---------------------------------------------------------------- exercise library
const MUSCLES = ['chest', 'back', 'shoulders', 'traps', 'quads', 'hamstrings', 'glutes', 'adductors', 'biceps', 'triceps', 'forearms', 'calves', 'core'];
const EQUIP = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'];
const PATTERNS = ['squat', 'hinge', 'lunge', 'glute', 'adduct', 'hpush', 'vpush', 'hpull', 'vpull', 'quad', 'ham', 'calf', 'bicep', 'tricep', 'forearm', 'sidedelt', 'reardelt', 'shrug', 'fly', 'core', 'warmup'];
const PATTERN_LABEL = { squat: 'Squat / leg press', hinge: 'Hip hinge', lunge: 'Lunge', glute: 'Glute', adduct: 'Adductors', hpush: 'Chest press', vpush: 'Shoulder press', hpull: 'Row', vpull: 'Pulldown', quad: 'Quad isolation', ham: 'Hamstring curl', calf: 'Calf', bicep: 'Biceps', tricep: 'Triceps', forearm: 'Forearms', sidedelt: 'Side delts', reardelt: 'Rear delts', shrug: 'Traps', fly: 'Chest fly', core: 'Core', warmup: 'Warm-up' };

export async function adminExercises() {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const { exercises } = await api('GET', '/api/exercises');
    const list = h('div', {});
    const q = h('input', { type: 'text', placeholder: 'Search exercises', 'aria-label': 'Search exercises' });
    const drawList = () => {
      const s = q.value.trim().toLowerCase();
      list.replaceChildren(...exercises.filter((e) => !s || e.name.toLowerCase().includes(s) || e.muscle.includes(s)).map((e) => h('button', { class: 'list-row', onclick: () => exerciseSheet(e, run) },
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, e.name, e.custom ? ' · yours' : ''), h('span', { class: 'sub' }, `${e.muscle} · ${e.equip}`)), icon('chevR', 20))));
    };
    q.addEventListener('input', drawList);
    drawList();
    main.replaceChildren(back('/admin', 'Admin'), h('h1', { class: 'title' }, 'Exercises'),
      h('div', { class: 'row-flex', style: 'margin:14px 0' }, h('div', { style: 'flex:1' }, q), h('button', { class: 'btn', onclick: () => exerciseSheet(null, run) }, 'Add exercise')),
      list);
  }, run);
  await run();
}

function exerciseSheet(ex, done) {
  sheet(ex ? 'Edit exercise' : 'Add an exercise', (close) => {
    const e = ex ?? { name: '', muscle: 'chest', equip: 'barbell', pattern: 'hpush', inc: 2.5, timed: false, notes: '' };
    const name = h('input', { type: 'text', value: e.name, 'aria-label': 'Exercise name' });
    const sel = (opts, cur, label, fmtL = (x) => x[0].toUpperCase() + x.slice(1)) => h('select', { 'aria-label': label }, opts.map((o) => h('option', { value: o, selected: cur === o ? true : null }, fmtL(o))));
    const muscle = sel(MUSCLES, e.muscle, 'Muscle');
    const equip = sel(EQUIP, e.equip, 'Equipment');
    const pattern = sel(PATTERNS, e.pattern, 'Movement', (p) => PATTERN_LABEL[p]);
    const inc = numInput(e.inc, { min: 0, max: 20 });
    const timed = h('input', { type: 'checkbox', checked: e.timed, style: 'width:24px;height:24px' });
    const notes = h('textarea', { rows: 3, 'aria-label': 'Technique notes' }, e.notes ?? '');
    const video = h('input', { type: 'url', value: e.video && !/results\?search_query/.test(e.video) ? e.video : '', placeholder: 'https://www.youtube.com/watch?v=…', 'aria-label': 'Demo video link' });
    const save = async () => {
      const b = { name: name.value, muscle: muscle.value, equip: equip.value, pattern: pattern.value, inc: Number(inc.value), timed: timed.checked, notes: notes.value, video: video.value.trim() };
      try { if (ex) await api('PUT', `/api/admin/exercises/${ex.id}`, b); else await api('POST', '/api/admin/exercises', b); close(); toast('Saved'); done(); } catch (err) { toast(err.message, 'bad'); }
    };
    return h('div', { class: 'stack' },
      field('Name', name),
      h('div', { class: 'grid2' }, field('Muscle', muscle), field('Equipment', equip)),
      field('Movement', pattern, 'Plans use this to pick a balanced mix.'),
      field('Weight step (kg)', inc, 'How much to add when the top of the rep range is reached.'),
      h('label', { class: 'row-flex' }, timed, h('span', {}, 'Timed hold (seconds instead of reps)')),
      field('Technique notes', notes),
      field('Demo video', video, 'YouTube, Vimeo or Google Drive. Without one, the app links a YouTube search.'),
      h('div', { class: 'row-flex' }, h('button', { class: 'btn', onclick: save }, 'Save'),
        ex ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Remove this exercise?', 'It is hidden from the library and new plans. Logged history is kept.', 'Remove', async () => { await api('DELETE', `/api/admin/exercises/${ex.id}`); close(); done(); }, true) }, 'Remove') : null));
  });
}

/** The AI admin: auto-approval switch and connection status. */
/**
 * Start everyone over (including you): every member keeps their account and stays signed in, but
 * lands in setup again with nothing from before. Needs the backup first and the exact phrase.
 */
function freshStartSheet() {
  const phrase = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Type START OVER' });
  sheet('Start everyone over?', (close) => {
    const go = h('button', { class: 'btn danger block', disabled: true, onclick: async () => {
      go.disabled = true;
      try {
        await api('POST', '/api/admin/fresh-start', { confirm: phrase.value.trim(), today: localDate() });
        close(); toast('Done. Everyone starts from setup on their next open.');
        await loadMe(); navigate('/onboarding');
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
    } }, 'Delete everyone\'s data');
    phrase.addEventListener('input', () => { go.disabled = phrase.value.trim() !== 'START OVER'; });
    return h('div', { class: 'stack' },
      h('p', {}, 'Every member, you included, loses their profile, diet and training plans, food and set logs, weights, photos, check-ins, coach chat, the crew feed and the competition history.'),
      h('p', { class: 'sub' }, 'Kept: accounts, passwords, everyone stays signed in, notifications, the food and exercise libraries and your settings. Each person goes through setup again on their next open.'),
      h('a', { class: 'btn ghost block', href: '/api/admin/backup' }, 'Download a backup first'),
      field('Type START OVER to confirm', phrase),
      go);
  });
}

/** Set the reward for the monthly competition. Shown on the Crew page and in the winner's notification. */
function prizeSheet(current, done) {
  const input = h('input', { type: 'text', maxlength: 80, value: current ?? '', placeholder: 'e.g. Dinner at Zooba, paid by the others' });
  sheet('Competition prize', (close) => h('div', { class: 'stack' },
    h('p', { class: 'sub' }, 'Most points in a calendar month wins. The prize is stored with each month\'s result, so changing it later does not rewrite history.'),
    field('Prize', input, 'Leave empty for no prize.'),
    h('button', { class: 'btn block', onclick: async () => {
      try { await api('PUT', '/api/admin/competition', { prize: input.value.trim() }); toast(input.value.trim() ? 'Prize saved' : 'Prize removed'); close(); done(); } catch (e) { toast(e.message, 'bad'); }
    } }, 'Save prize')));
  setTimeout(() => input.focus(), 50);
}

function aiPanel(settings) {
  const sw = h('input', { type: 'checkbox', class: 'switch', checked: settings.aiAutoApprove, 'aria-label': 'Let the AI approve safe plans' });
  sw.addEventListener('change', async () => {
    try { await api('PUT', '/api/admin/settings', { aiAutoApprove: sw.checked }); toast(sw.checked ? 'The AI approves safe plans now' : 'Every plan waits for you now'); }
    catch (e) { sw.checked = !sw.checked; toast(e.message, 'bad'); }
  });
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'AI admin'),
      h('span', { class: `status ${settings.aiConfigured ? 'ok' : 'warn'}` }, settings.aiConfigured ? 'Coach connected' : 'No AI key')),
    h('label', { class: 'list-row', style: 'cursor:pointer' },
      h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Approve safe plans automatically'),
        h('span', { class: 'sub' }, 'Checks calories, protein, safety floor, excluded foods and portions. Injuries always come to you.')), sw),
    h('p', { class: 'sub', style: 'padding:8px 0 4px' }, settings.aiConfigured
      ? `Coach model: ${settings.aiModel}. Check-ins run on ${settings.timezone} time.`
      : 'Add FITCREW_AI_KEY to the server settings to switch on the coach. Reviews, reminders and swaps work without it.'),
    settings.aiLastError ? h('p', { class: 'notice', style: 'margin:4px 0 8px' }, `Last AI error (${new Date(settings.aiLastError.at).toLocaleString('en-GB')}): ${settings.aiLastError.message}${settings.aiLastError.body ? ` · ${settings.aiLastError.body.slice(0, 160)}` : ''} [${settings.aiLastError.model}]`) : null,
    settings.aiConfigured ? testRow() : null);
}

function testRow() {
  const out = h('p', { class: 'sub', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn ghost small', onclick: async () => {
    btn.disabled = true; out.textContent = 'Contacting the AI…';
    try {
      const r = await api('POST', '/api/admin/ai-test', {});
      out.textContent = r.ok ? `Working: ${r.model} answered in ${(r.ms / 1000).toFixed(1)} s.` : `Failed: ${r.message}${r.status ? ` (HTTP ${r.status})` : ''}${r.body ? ` · ${r.body.slice(0, 160)}` : ''} [${r.model}]`;
      out.className = r.ok ? 'status ok' : 'error';
    } catch (e) { out.textContent = e.message; out.className = 'error'; }
    btn.disabled = false;
  } }, 'Test AI connection');
  const bench = h('div', {});
  const benchBtn = h('button', { class: 'btn ghost small', onclick: async () => {
    benchBtn.disabled = true;
    bench.replaceChildren(h('p', { class: 'sub' }, 'Timing every suitable model with a real request (up to 30 s)…'));
    try {
      const r = await api('POST', '/api/admin/ai-benchmark', {});
      if (!r.ok) { bench.replaceChildren(h('p', { class: 'error' }, r.message)); return; }
      bench.replaceChildren(...r.results.map((x) => h('div', { class: 'list-row' },
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, x.model, x.model === r.current ? ' · in use' : ''),
          h('span', { class: x.correct ? 'sub' : 'error' }, x.ok ? `${(x.ms / 1000).toFixed(1)} s · ${x.correct ? 'logs food correctly' : x.toolCall ? 'tool call was wrong' : 'did not use the tool'}` : x.error)),
        x.correct && x.model !== r.current ? h('button', { class: 'btn small', onclick: async () => {
          await api('PUT', '/api/admin/settings', { aiModel: x.model }); toast(`The coach now uses ${x.model}`); benchBtn.click();
        } }, 'Use') : null)));
    } catch (e) { bench.replaceChildren(h('p', { class: 'error' }, e.message)); }
    finally { benchBtn.disabled = false; }
  } }, 'Find the fastest model');
  return h('div', {}, h('div', { class: 'row-flex', style: 'padding:4px 0 8px' }, btn, benchBtn, out), bench);
}
