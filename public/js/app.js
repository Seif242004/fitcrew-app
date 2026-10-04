import { state } from './state.js';
import { api } from './api.js';
import { addRoute, navigate, start } from './router.js';
import { loadMe } from './session.js';
import { hookBar } from './shell.js';
import './install.js'; // listens for the browser's install prompt from the first moment
import { authView } from './views/auth.js';
import { onboardingView } from './views/onboarding.js';
import { todayView } from './views/today.js';
import { planView } from './views/plan.js';
import { trainView, historyView, weekPlanView, exerciseHistoryView } from './views/train.js';
import { progressView } from './views/progress.js';
import { groupView } from './views/group.js';
import { coachView } from './views/coach.js';
import { profileView } from './views/profile.js';
import { adminHome, adminUser, adminPlan, adminFoods, adminAudit, adminWorkoutPlan, adminExercises, adminCheckins } from './views/admin.js';

/** Wraps a screen so it only runs for a signed-in user who has finished setup. */
function protect(view, { needsProfile = true, adminOnly = false } = {}) {
  return async (params, qs) => {
    if (!state.me) {
      try { await loadMe(); } catch (e) {
        if (e.status !== 401) { document.getElementById('app').textContent = e.message; return; }
        const { needsSetup } = await api('GET', '/api/status');
        navigate(needsSetup ? '/setup' : '/login');
        return;
      }
    }
    if (adminOnly && state.me.user.role !== 'admin') { navigate('/today'); return; }
    if (needsProfile && !state.me.profile && !state.skipOnboarding && !state.as) { navigate('/onboarding'); return; }
    return view(params, qs);
  };
}

const open = (mode) => async () => {
  if (!state.me) { try { await loadMe(); } catch { /* not signed in: stay on this screen */ } }
  if (state.me && mode !== 'setup') { navigate('/today'); return; }
  if (mode === 'login') {
    const { needsSetup } = await api('GET', '/api/status');
    if (needsSetup) { navigate('/setup'); return; }
  }
  authView(mode);
};

addRoute('/login', open('login'));
addRoute('/register', open('register'));
addRoute('/setup', open('setup'));
addRoute('/onboarding', protect((_, qs) => onboardingView(qs.get('edit') === '1'), { needsProfile: false }));
addRoute('/today', protect(todayView));
addRoute('/plan', protect(planView));
addRoute('/train', protect(trainView));
addRoute('/train/plan', protect(weekPlanView));
addRoute('/history', protect(historyView));
addRoute('/history/:id', protect(exerciseHistoryView));
addRoute('/progress', protect(progressView));
addRoute('/group', protect(groupView));
addRoute('/coach', protect(coachView));
addRoute('/profile', protect(profileView, { needsProfile: false }));
addRoute('/admin', protect(adminHome, { needsProfile: false, adminOnly: true }));
addRoute('/admin/user/:id', protect(adminUser, { needsProfile: false, adminOnly: true }));
addRoute('/admin/plan/:id', protect(adminPlan, { needsProfile: false, adminOnly: true }));
addRoute('/admin/workout/:id', protect(adminWorkoutPlan, { needsProfile: false, adminOnly: true }));
addRoute('/admin/checkins', protect(adminCheckins, { needsProfile: false, adminOnly: true }));
addRoute('/admin/exercises', protect(adminExercises, { needsProfile: false, adminOnly: true }));
addRoute('/admin/foods', protect(adminFoods, { needsProfile: false, adminOnly: true }));
addRoute('/admin/audit', protect(adminAudit, { needsProfile: false, adminOnly: true }));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

hookBar();
start();
