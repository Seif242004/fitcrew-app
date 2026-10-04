// "Add to home screen" for everyone:
//   Android / desktop Chrome & Edge: the browser's own install prompt (beforeinstallprompt).
//   iPhone / iPad: Safari has no install API, so a short guide with the real Share icon.
//   In-app browsers (WhatsApp, Instagram, Facebook...) cannot install at all: say so first.
import { h } from './dom.js';
import { sheet, icon } from './ui.js';

let deferred = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; dispatchEvent(new Event('fitcrew-installable')); });
addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem('fc-installed', '1'); } catch { /* ignore */ } });

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = () => navigator.userAgent;
export const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = () => /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|Twitter/i.test(ua());

/** What this device can do: 'installed' | 'prompt' | 'ios' | 'inapp' | 'manual'. */
export function installMode() {
  if (isStandalone()) return 'installed';
  if (inAppBrowser()) return 'inapp';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'manual';
}

// Safari's share icon, drawn so people recognise it.
const shareIcon = () => h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', style: 'vertical-align:-4px' },
  h('path', { d: 'M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1' }));
const plusBox = () => h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true', style: 'vertical-align:-4px' },
  h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 4 }), h('path', { d: 'M12 8v8M8 12h8' }));

const step = (n, ...content) => h('li', { class: 'istep' }, h('span', { class: 'inum' }, n), h('span', {}, ...content));

/** Opens the right install help for this device. */
export async function showInstall() {
  const mode = installMode();
  if (mode === 'prompt') { deferred.prompt(); const { outcome } = await deferred.userChoice; if (outcome === 'accepted') deferred = null; return; }
  sheet('Add FitCrew to your phone', () => {
    if (mode === 'installed') return h('p', {}, 'FitCrew is already on your home screen. Open it from there.');
    if (mode === 'inapp') {
      return h('div', { class: 'stack' },
        h('p', {}, 'This link opened inside another app, which cannot add apps to your home screen.'),
        h('ol', { class: 'isteps' },
          step(1, 'Tap the ', h('b', {}, '⋯'), ' or ', h('b', {}, 'share'), ' button of this window.'),
          step(2, isIOS() ? 'Choose "Open in Safari".' : 'Choose "Open in Chrome" or "Open in browser".'),
          step(3, 'Then come back here and tap "Add to home screen".')));
    }
    if (mode === 'ios') {
      return h('div', { class: 'stack' },
        h('ol', { class: 'isteps' },
          step(1, 'Tap ', h('b', {}, 'Share'), ' ', shareIcon(), ' at the bottom of Safari (top right on iPad).'),
          step(2, 'Scroll down and tap ', h('b', {}, 'Add to Home Screen'), ' ', plusBox(), '.'),
          step(3, 'Tap ', h('b', {}, 'Add'), '. FitCrew appears on your home screen like any app.'),
          step(4, 'Open it from the home screen, then turn on reminders in Profile.')),
        h('p', { class: 'sub' }, 'Notifications on iPhone need iOS 16.4 or newer and only work once FitCrew is opened from the home screen.'));
    }
    return h('div', { class: 'stack' },
      h('ol', { class: 'isteps' },
        step(1, 'Open the browser menu ', h('b', {}, '⋮'), ' (top right).'),
        step(2, 'Tap ', h('b', {}, 'Install app'), ' or ', h('b', {}, 'Add to Home screen'), '.'),
        step(3, 'Open FitCrew from your home screen.')));
  });
}

/** A dismissible card for Today. Hidden when installed or dismissed in the last 14 days. */
export function installCard() {
  if (isStandalone()) return null;
  try { const t = Number(localStorage.getItem('fc-install-dismissed') ?? 0); if (Date.now() - t < 14 * 864e5) return null; } catch { /* storage off: show it */ }
  const card = h('section', { class: 'section install-card' },
    h('div', { class: 'meal-head' },
      h('span', { class: 'ico-app' }, h('img', { src: '/icons/icon-192.png', alt: '', width: 40, height: 40 })),
      h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Put FitCrew on your home screen'), h('span', { class: 'sub' }, 'Opens full screen like an app, with reminders.')),
      h('button', { class: 'more', 'aria-label': 'Not now', onclick: () => { try { localStorage.setItem('fc-install-dismissed', String(Date.now())); } catch { /* ignore */ } card.remove(); } }, icon('close', 18))),
    h('button', { class: 'btn block', style: 'margin:8px 0 12px', onclick: showInstall }, installMode() === 'prompt' ? 'Install' : 'Show me how'));
  return card;
}
