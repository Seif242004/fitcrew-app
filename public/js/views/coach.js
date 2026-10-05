import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate } from '../state.js';
import { paint, guard } from '../shell.js';
import { icon, toast } from '../ui.js';

// The coach: a conversation that also does things. Replies carry chips for what changed, and
// daily check-ins (morning brief, evening recap, crew update) arrive here as cards.

// Suggestions follow the person's actual day: the next meal they have not logged, an item in it
// they might want to swap, then the general ones.
// General prompts follow the clock: breakfast questions in the morning, wrapping up the day at night.
function general() {
  const hr = new Date().getHours();
  if (hr < 11) return ['What should I have for breakfast?', 'What is my workout today?', 'I drank 2 glasses of water', 'How am I doing this week?'];
  if (hr < 17) return ['I had koshari for lunch', 'I\'m hungry, what can I eat?', 'What is my workout today?', 'How am I doing this week?'];
  if (hr < 21) return ['I\'m training soon, what should I eat before?', 'I\'m hungry, what can I eat?', 'Where do I stand on the leaderboard?', 'I drank 2 glasses of water'];
  return ['How did I do today?', 'Log my dinner as eaten', 'I ate something not on my plan', 'Where do I stand on the leaderboard?'];
}
async function suggestions() {
  const GENERAL = general();
  try {
    const d = await api('GET', `/api/today?date=${localDate()}`);
    const next = d.meals?.find((m) => m.items.some((i) => !i.log));
    if (!next) return GENERAL;
    const item = next.items.find((i) => !i.log && !['veg', 'fat'].includes(i.cat)) ?? next.items[0];
    const short = String(item.name).split(/[,(]/)[0].trim().toLowerCase();
    return [`I ate my ${next.name.toLowerCase()}`, `Swap the ${short} in my ${next.name.toLowerCase()} today`, ...GENERAL];
  } catch { return GENERAL; }
}
const KIND_LABEL = { morning: 'Morning brief', nudge: 'Check-in', evening: 'Evening check', crew: 'Crew update', weekly: 'Your week' };
const time = (iso) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayOf = (iso) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export async function coachView() {
  const main = paint('coach');
  main.classList.add('coach-main');
  const log = h('div', { class: 'chat', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with your coach' });
  const input = h('textarea', { rows: 1, placeholder: 'Message your coach', 'aria-label': 'Message your coach', enterkeyhint: 'send' });
  const send = h('button', { class: 'send', 'aria-label': 'Send', disabled: true }, icon('send', 20));
  const chips = h('div', { class: 'chips scroll suggest' });
  const drawChips = async () => chips.replaceChildren(...(await suggestions()).map((t) => h('button', { class: 'chip', onclick: () => submit(t) }, t)));
  drawChips();
  const composer = h('div', { class: 'composer' }, chips, h('div', { class: 'compose-row' }, input, send));
  let busy = false;
  let lastDay = '';

  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; send.disabled = !input.value.trim() || busy; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); } });
  send.addEventListener('click', () => submit(input.value));

  const bubble = (m) => {
    const out = [];
    const day = dayOf(m.at);
    if (day !== lastDay) { lastDay = day; out.push(h('p', { class: 'chat-day' }, day === dayOf(new Date().toISOString().replace('T', ' ').slice(0, 19)) ? 'Today' : day)); }
    if (m.role === 'user') { out.push(h('div', { class: 'msg me' }, h('p', {}, m.content), h('span', { class: 'meta' }, time(m.at)))); return out; }
    const card = m.kind === 'checkin';
    const actions = m.data?.actions ?? [];
    out.push(h('div', { class: `msg coach ${card ? 'card' : ''} ${m.data?.failed ? 'failed' : ''}` },
      card ? h('span', { class: 'msg-kind' }, icon('bell', 14), KIND_LABEL[m.data?.job] ?? 'Coach') : null,
      ...m.content.split('\n').filter(Boolean).map((line) => h('p', { dir: 'auto' }, line)),
      actions.length ? h('div', { class: 'acts' }, actions.map((a) => h('span', { class: 'act' }, icon('check', 14), a))) : null,
      h('span', { class: 'meta' }, time(m.at))));
    return out;
  };

  const scrollEnd = (smooth) => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));
  const typing = h('div', { class: 'msg coach typing', 'aria-label': 'Coach is typing' }, h('i'), h('i'), h('i'));

  async function submit(text) {
    text = String(text ?? '').trim();
    if (!text || busy) return;
    busy = true; input.value = ''; grow();
    log.append(...bubble({ role: 'user', content: text, at: new Date().toISOString().replace('T', ' ').slice(0, 19) }));
    log.append(typing); scrollEnd(true);
    try {
      const now = new Date();
      const r = await api('POST', '/api/coach', { text, today: localDate(), clock: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` });
      typing.remove();
      log.lastElementChild?.remove(); // the optimistic user bubble; the server copy replaces it
      for (const m of r.messages) log.append(...bubble(m));
      if (r.changed) { state.dirty = true; drawChips(); } // Today / Plan reload on next visit
    } catch (e) {
      typing.remove(); toast(e.message, 'bad');
    } finally { busy = false; grow(); scrollEnd(true); input.focus(); }
  }

  const load = async () => {
    const { messages } = await api('GET', '/api/coach');
    if (state.me) state.me.coachUnread = 0;
    document.querySelector('.tab[href="#/coach"] .badge')?.remove();
    const intro = messages.length ? null : h('div', { class: 'coach-intro' },
      h('span', { class: 'coach-avatar' }, icon('coach', 28)),
      h('h1', { class: 'title', style: 'margin:12px 0 8px' }, 'Your coach'),
      h('p', { class: 'sub' }, 'Tell me what you ate and I log it. Ask to swap anything, change what you eat, or how you are doing. I check in every morning and evening.'),
      h('p', { class: 'meta', style: 'margin-top:12px' }, 'Your plan, logs and weight are shared with the AI provider to answer you. Photos are never shared.'));
    log.replaceChildren(...(intro ? [intro] : []), ...messages.flatMap(bubble));
    main.replaceChildren(log, composer);
    scrollEnd(false);
    const draft = sessionStorage.getItem('coachDraft');
    if (draft) { sessionStorage.removeItem('coachDraft'); submit(draft); }
  };
  await guard(main, load, () => coachView());
}
