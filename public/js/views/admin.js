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
    const { users } = await api('GET', `/api/admin/users?today=${localDate()}`);
    const review = users.filter((u) => u.pendingPlanId || u.pendingWorkoutPlanId || u.openRequests);
    main.replaceChildren(
      h('h1', { class: 'title' }, 'Admin'),
      h('div', { class: 'row-flex', style: 'margin-top:14px;flex-wrap:wrap' },
        h('button', { class: 'btn small', onclick: inviteSheet }, 'Invite someone'),
        h('button', { class: 'btn small ghost', onclick: () => navigate('/admin/foods') }, 'Foods'),
        h('button', { class: 'btn small ghost', onclick: () => navigate('/admin/exercises') }, 'Exercises'),
        h('button', { class: 'btn small ghost', onclick: () => { location.href = '/api/admin/backup'; } }, 'Download backup'),
        h('button', { class: 'btn small ghost', onclick: () => navigate('/admin/audit') }, 'Activity log')),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Needs your review')),
        review.length ? review.map((u) => h('button', { class: 'list-row', onclick: () => navigate(u.pendingPlanId ? `/admin/plan/${u.pendingPlanId}` : u.pendingWorkoutPlanId ? `/admin/workout/${u.pendingWorkoutPlanId}` : `/admin/user/${u.id}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, u.name), h('span', { class: 'sub' }, [u.pendingPlanId ? 'New diet plan waiting for approval' : null, u.pendingWorkoutPlanId ? 'New workout plan waiting for approval' : null, u.openRequests ? `${u.openRequests} change request${u.openRequests > 1 ? 's' : ''}` : null].filter(Boolean).join(' · '))), icon('chevR', 20)))
          : h('p', { class: 'muted', style: 'padding:14px 0' }, 'Nothing waiting. New plans and change requests show up here.')),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'People'), h('span', { class: 'sub' }, `${users.length}`)),
        users.map((u) => h('button', { class: 'list-row', onclick: () => navigate(`/admin/user/${u.id}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, u.name, u.role === 'admin' ? ' · admin' : '', u.active ? '' : ' · deactivated'),
            h('span', { class: 'sub' }, !u.hasProfile ? 'Has not finished setup' : !u.activePlanId ? 'No active plan' : u.avg7 === null ? 'No finished days yet' : `7-day average ${u.avg7}`)), icon('chevR', 20)))));
  }, run);
  await run();
}

function inviteSheet() {
  sheet('Invite someone', (close) => {
    const note = h('input', { type: 'text', placeholder: 'Who is this for? (optional)', 'aria-label': 'Who is this invite for' });
    const out = h('div', { class: 'stack' });
    const make = h('button', { class: 'btn block', onclick: async () => {
      try {
        const { code } = await api('POST', '/api/admin/invites', { note: note.value });
        const link = `${location.origin}/#/register`;
        const text = `Join FitCrew: ${link}\nInvite code: ${code}`;
        out.replaceChildren(
          h('p', { class: 'num', style: 'font-size:44px;letter-spacing:.08em' }, code),
          h('p', { class: 'sub' }, 'Valid for 7 days, works once.'),
          h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a message.'); } catch { toast(text); } } }, 'Copy the message'));
        make.remove(); note.remove();
      } catch (e) { toast(e.message, 'bad'); }
    } }, 'Create invite code');
    return h('div', { class: 'stack' }, h('p', { class: 'sub' }, 'Each code lets one person create an account. Nobody can join without one.'), note, make, out);
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
      h('p', { class: 'sub' }, `${u.email} · ${u.role === 'admin' ? 'Administrator' : 'Member'}${u.active ? '' : ' · deactivated'}`),
      h('div', { class: 'row-flex', style: 'margin-top:14px;flex-wrap:wrap' },
        d.profile ? h('button', { class: 'btn small', onclick: () => viewAs(u, '/today') }, `Open as ${u.name.split(' ')[0]}`) : null,
        d.profile ? h('button', { class: 'btn small ghost', onclick: () => viewAs(u, '/onboarding?edit=1') }, 'Edit their details') : null,
        d.profile ? h('button', { class: 'btn small ghost', onclick: async () => { try { const r = await api('POST', `/api/admin/users/${id}/plans/generate`, {}); navigate(`/admin/plan/${r.planId}`); } catch (e) { toast(e.message, 'bad'); } } }, 'Draft a new diet plan') : null,
        d.profile ? h('button', { class: 'btn small ghost', onclick: async () => { try { const r = await api('POST', `/api/admin/users/${id}/workout-plans/generate`, {}); navigate(`/admin/workout/${r.planId}`); } catch (e) { toast(e.message, 'bad'); } } }, 'Draft a new workout plan') : null),
      !d.profile ? h('p', { class: 'notice', style: 'margin-top:16px' }, `${u.name} has not finished setting up yet.`) : null,
      t ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Daily targets'), h('button', { class: 'link', onclick: () => targetsSheet(id, d, run) }, 'Change')),
        h('p', { style: 'margin-top:12px' }, h('span', { class: 'num', style: 'font-size:40px' }, fmt(t.kcal)), ' kcal'),
        h('p', { class: 'sub' }, `Protein ${t.proteinG} g · Carbs ${t.carbsG} g · Fat ${t.fatG} g`),
        t.overridden ? h('p', { class: 'sub' }, `Set by you. Calculated: ${fmt(d.computedTargets.kcal)} kcal.`) : null,
        ...(t.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:8px' }, w))) : null,
      d.scores.length ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Last 14 days')), h('div', { style: 'margin-top:12px' }, scoreBars(d.scores, localDate()))) : null,
      d.requests.some((r) => r.status === 'open') ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Change requests')),
        d.requests.filter((r) => r.status === 'open').map((r) => h('div', { class: 'list-row' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, r.note), h('span', { class: 'sub' }, ago(r.created_at))),
          h('button', { class: 'btn small ghost', onclick: async () => { await api('POST', `/api/admin/requests/${r.id}/resolve`, { note: '' }); run(); } }, 'Done')))) : null,
      d.plans.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Plans')),
        d.plans.map((p) => h('button', { class: 'list-row', onclick: () => navigate(`/admin/plan/${p.id}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, `Version ${p.version}`), h('span', { class: 'sub' }, `${p.start_date ? `Started ${fmtDate(p.start_date)}` : `Drafted ${ago(p.created_at)}`}${p.note ? ` · ${p.note}` : ''}`)),
          h('span', { class: `status ${p.status === 'active' ? 'ok' : p.status === 'pending' ? 'warn' : 'idle'}` }, p.status === 'pending' ? 'Needs review' : p.status))) ) : null,
      d.workoutPlans?.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Workout plans')),
        d.workoutPlans.map((p) => h('button', { class: 'list-row', onclick: () => navigate(`/admin/workout/${p.id}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, `Version ${p.version}`), h('span', { class: 'sub' }, `${p.start_date ? `Started ${fmtDate(p.start_date)}` : `Drafted ${ago(p.created_at)}`}${p.note ? ` · ${p.note}` : ''}`)),
          h('span', { class: `status ${p.status === 'active' ? 'ok' : p.status === 'pending' ? 'warn' : 'idle'}` }, p.status === 'pending' ? 'Needs review' : p.status)))) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Account')),
        h('button', { class: 'list-row', onclick: () => renameSheet(u, run) }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Change name')), icon('chevR', 20)),
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
      ...(plan.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:10px' }, w)),
      tabs, body,
      editable ? h('section', { class: 'section stack' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, plan.status === 'active' ? 'This plan is live' : 'Approve')),
        plan.status === 'active' ? null : field('Starts on', start, 'Day 1 of the plan is this date.'),
        h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
          h('button', { class: 'btn ghost', onclick: async () => { try { await save(); toast('Saved'); run(); } catch (e) { toast(e.message, 'bad'); } } }, plan.status === 'active' ? 'Save changes to the live plan' : 'Save draft'),
          plan.status === 'active' ? null : h('button', { class: 'btn', onclick: async () => { try { if (dirty) await save(); await api('POST', `/api/admin/plans/${id}/approve`, { startDate: start.value }); toast('Plan approved'); navigate(`/admin/user/${plan.userId}`); } catch (e) { toast(e.message, 'bad'); } } }, 'Approve and publish'),
          plan.status === 'pending' ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Reject this draft?', 'The draft is discarded. You can draft a new one from the person\'s page.', 'Reject', async () => { await api('POST', `/api/admin/plans/${id}/reject`, {}); navigate(`/admin/user/${plan.userId}`); }, true) }, 'Reject') : null)) : null);
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
      h('div', {}, h('p', { style: 'font-weight:700;margin-bottom:8px' }, 'Where plans may use it'), toggles(roles, ROLES)),
      h('div', {}, h('p', { style: 'font-weight:700;margin-bottom:8px' }, 'Contains'), toggles(tags, ALLERGENS)),
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

// ---------------------------------------------------------------- workout plan editor
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday first

export async function adminWorkoutPlan({ id }) {
  const main = paint('admin', loading());
  const run = () => guard(main, async () => {
    const { plan } = await api('GET', `/api/admin/workout-plans/${id}`);
    const days = structuredClone(plan.days);
    let dirty = false;
    const body = h('div', {});
    const draw = () => {
      body.replaceChildren(...days.map((d, di) => h('section', { class: 'section' },
        h('div', { class: 'section-head' },
          h('h2', { class: 'h2' }, d.name),
          h('span', { class: 'sub' }, WEEKDAYS[d.weekday])),
        d.exercises.map((e, ei) => {
          const mk = (key, min, max, label) => {
            const el = numInput(e[key], { min, max, inputmode: 'numeric', 'aria-label': `${label} for ${e.name}` });
            el.addEventListener('change', () => { e[key] = Number(el.value); dirty = true; });
            return h('label', { class: 'field' }, h('span', {}, label), el);
          };
          return h('div', { class: 'stack', style: 'padding:10px 0;border-bottom:1px solid var(--line)' },
            h('div', { class: 'row-flex', style: 'justify-content:space-between' },
              h('span', { class: 'strong' }, e.name, h('span', { class: 'sub', style: 'display:block' }, e.muscle)),
              h('span', { class: 'row-flex' },
                h('button', { class: 'btn small ghost', onclick: () => sheet(`Swap ${e.name}`, (close) => exercisePicker((x) => { Object.assign(e, { exerciseId: x.id, name: x.name, muscle: x.muscle }); dirty = true; close(); draw(); })) }, 'Swap'),
                h('button', { class: 'icon-btn', 'aria-label': `Remove ${e.name}`, onclick: () => { d.exercises.splice(ei, 1); dirty = true; draw(); } }, icon('trash', 20)))),
            h('div', { class: 'grid3' }, mk('sets', 1, 10, 'Sets'), mk('repMin', 1, 200, 'Min reps'), mk('repMax', 1, 300, 'Max reps')),
            mk('restSec', 15, 600, 'Rest (seconds)'));
        }),
        h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
          h('button', { class: 'add-row', style: 'width:auto', onclick: () => sheet(`Add to ${d.name}`, (close) => exercisePicker((x) => { d.exercises.push({ exerciseId: x.id, name: x.name, muscle: x.muscle, sets: 3, repMin: 8, repMax: 12, restSec: 90 }); dirty = true; close(); draw(); })) }, icon('plus', 22), 'Add an exercise'),
          h('button', { class: 'link', onclick: () => confirmSheet('Remove this session?', `${d.name} on ${WEEKDAYS[d.weekday]} is removed from the plan.`, 'Remove', () => { days.splice(di, 1); dirty = true; draw(); }, true) }, 'Remove session')))));
    };
    draw();

    const start = h('input', { type: 'date', value: localDate(), 'aria-label': 'Plan start date' });
    const payload = () => ({ days: days.map((d) => ({ weekday: d.weekday, name: d.name, exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, repMin: e.repMin, repMax: e.repMax, restSec: e.restSec })) })) });
    const save = async () => { await api('PUT', `/api/admin/workout-plans/${id}`, payload()); dirty = false; };
    const live = plan.status === 'active';
    const editable = ['pending', 'active', 'archived'].includes(plan.status);

    main.replaceChildren(
      back(`/admin/user/${plan.userId}`, 'Back'),
      h('h1', { class: 'title' }, `Workout plan version ${plan.version}`),
      h('p', { class: 'sub' }, `${plan.status === 'pending' ? 'Waiting for approval' : plan.status} · ${plan.daysPerWeek} sessions a week · ${String(plan.split ?? '').replace(/-/g, ' ')} · ${plan.experience}`),
      ...(plan.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:10px' }, w)),
      body,
      editable ? h('section', { class: 'section stack' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, live ? 'This plan is live' : 'Approve')),
        live ? null : field('Starts on', start, 'Sessions follow the weekdays above from this date.'),
        h('div', { class: 'row-flex', style: 'flex-wrap:wrap' },
          h('button', { class: 'btn ghost', onclick: async () => { try { await save(); toast('Saved'); run(); } catch (e) { toast(e.message, 'bad'); } } }, live ? 'Save changes to the live plan' : 'Save draft'),
          live ? null : h('button', { class: 'btn', onclick: async () => { try { if (dirty) await save(); await api('POST', `/api/admin/workout-plans/${id}/approve`, { startDate: start.value }); toast('Workout plan approved'); navigate(`/admin/user/${plan.userId}`); } catch (e) { toast(e.message, 'bad'); } } }, 'Approve and publish'),
          plan.status === 'pending' ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Reject this draft?', 'The draft is discarded. You can draft a new one from the person\'s page.', 'Reject', async () => { await api('POST', `/api/admin/workout-plans/${id}/reject`, {}); navigate(`/admin/user/${plan.userId}`); }, true) }, 'Reject') : null)) : null);
  }, run);
  await run();
}

// ---------------------------------------------------------------- exercise library
const MUSCLES = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps', 'calves', 'core'];
const EQUIP = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'];
const PATTERNS = ['squat', 'hinge', 'lunge', 'glute', 'hpush', 'vpush', 'hpull', 'vpull', 'quad', 'ham', 'calf', 'bicep', 'tricep', 'sidedelt', 'reardelt', 'fly', 'core'];
const PATTERN_LABEL = { squat: 'Squat', hinge: 'Hip hinge', lunge: 'Lunge', glute: 'Glute', hpush: 'Horizontal push', vpush: 'Vertical push', hpull: 'Horizontal pull', vpull: 'Vertical pull', quad: 'Quad isolation', ham: 'Hamstring isolation', calf: 'Calf', bicep: 'Biceps', tricep: 'Triceps', sidedelt: 'Side delts', reardelt: 'Rear delts', fly: 'Fly', core: 'Core' };

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
    const save = async () => {
      const b = { name: name.value, muscle: muscle.value, equip: equip.value, pattern: pattern.value, inc: Number(inc.value), timed: timed.checked, notes: notes.value };
      try { if (ex) await api('PUT', `/api/admin/exercises/${ex.id}`, b); else await api('POST', '/api/admin/exercises', b); close(); toast('Saved'); done(); } catch (err) { toast(err.message, 'bad'); }
    };
    return h('div', { class: 'stack' },
      field('Name', name),
      h('div', { class: 'grid2' }, field('Muscle', muscle), field('Equipment', equip)),
      field('Movement', pattern, 'Plans use this to pick a balanced mix.'),
      field('Weight step (kg)', inc, 'How much to add when the top of the rep range is reached.'),
      h('label', { class: 'row-flex' }, timed, h('span', {}, 'Timed hold (seconds instead of reps)')),
      field('Technique notes', notes),
      h('div', { class: 'row-flex' }, h('button', { class: 'btn', onclick: save }, 'Save'),
        ex ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Remove this exercise?', 'It is hidden from the library and new plans. Logged history is kept.', 'Remove', async () => { await api('DELETE', `/api/admin/exercises/${ex.id}`); close(); done(); }, true) }, 'Remove') : null));
  });
}
