// Crew tab: the monthly competition, the crew's activity feed with reactions, and the hall of fame.
// Points are day scores (0-100 a day) added up over the calendar month; most points at the end of
// the month wins the prize the admin sets. The board moves during the day.
import { h } from '../dom.js';
import { screenTip } from '../tour.js';
import { api } from '../api.js';
import { state, localDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard, onPull } from '../shell.js';
import { emptyState, sheet, toast, icon, avatarEl } from '../ui.js';

export async function groupView() {
  const main = paint('group', loading());
  const run = () => guard(main, async () => {
    const today = localDate();
    const [g, feed] = await Promise.all([
      api('GET', `/api/group?today=${today}`),
      api('GET', `/api/feed?today=${today}`).catch(() => ({ items: [] })),
    ]);
    const { board, month, prize, champions, resetAt } = g;
    if (!board.length) { main.replaceChildren(emptyState('Nobody on the board yet', 'People appear here once they finish setting up their plan.')); return; }
    const scored = board.filter((b) => b.points > 0 && !b.private); // private members (admin view only) never rank
    const rest = board.filter((b) => !(scored.includes(b) && scored.indexOf(b) < 3));
    const freshStart = resetAt && resetAt >= month.from;
    main.replaceChildren(
      h('div', { class: 'spread', style: 'align-items:baseline' },
        h('h1', { class: 'title' }, 'The crew'),
        h('button', { class: 'link', onclick: () => howSheet(month) }, 'How points work')),
      g.private ? h('aside', { class: 'tip' }, h('span', { class: 'tip-ic' }, icon('info', 18)), h('div', { class: 'grow' }, h('b', {}, 'You are private'), h('p', {}, `Only the admin can see you. You are not on the board and not in the competition. Your points this month: ${fmt(g.private.points)}.`))) : screenTip('crew', 'The crew', 'Most points this month wins the prize. Tap a smiley under a post to cheer someone on.'),
      hero(month, prize, scored[0]),
      scored.length ? podium(scored.slice(0, 3)) : h('p', { class: 'notice', style: 'margin-top:16px' }, freshStart ? 'Fresh start: everyone is on zero. Log today to get on the board.' : `No points yet in ${month.name}. Log your meals and training to get on the board.`),
      rest.length ? h('section', { class: 'section' }, rest.map((b) => {
        const rank = scored.includes(b) ? scored.indexOf(b) + 1 : null;
        return h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'rank' }, rank ?? '–'),
          avatarEl(b, 36),
          h('span', { class: 'grow' },
            h('span', { class: 'strong' }, b.isMe ? `${b.name} (you)` : b.name, trophyBadge(b.trophies)),
            h('span', { class: 'sub' }, detail(b))),
          h('span', { class: 'num', style: `font-size:28px;${b.points ? '' : 'color:var(--ink-3)'}` }, fmt(b.points)));
      })) : null,
      feedSection(feed.items),
      champions.length ? hallOfFame(champions) : null,
      resetAt ? h('p', { class: 'meta', style: 'margin-top:14px' }, `Season started ${fmtDate(resetAt, { day: 'numeric', month: 'long' })}.`) : null);
  }, run);
  onPull(run); // pull down to reload the board and the feed
  await run();
}

// ------------------------------------------------ competition header

/** Month name, days left with a progress bar, the prize and who is leading. */
function hero(month, prize, leader) {
  const total = Number(month.to.slice(8));
  const done = Math.max(0, Math.min(total, total - month.daysLeft + 1));
  const lead = leader ? (leader.isMe ? 'You are leading' : `${leader.name} is leading`) : 'Nobody has points yet';
  return h('section', { class: 'comp-hero' },
    h('div', { class: 'spread' },
      h('div', {},
        h('div', { class: 'eyebrow' }, `${month.name} competition`),
        h('div', { class: 'comp-left' }, month.daysLeft === 1 ? 'Last day' : `${month.daysLeft} days left`)),
      h('span', { class: 'comp-trophy', 'aria-hidden': 'true' }, icon('trophy', 28))),
    h('div', { class: 'comp-bar', role: 'progressbar', 'aria-label': 'Month progress', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
      h('span', { style: `width:${(done / total) * 100}%` })),
    h('p', { class: 'comp-prize' }, prize ? h('span', {}, h('b', {}, 'Prize: '), prize) : h('span', { class: 'sub' }, state.me?.user?.role === 'admin' ? 'No prize set. Set one in Admin > Competition.' : 'Most points at the end of the month wins.')),
    h('p', { class: 'sub', style: 'margin:0' }, `${lead} · ends ${fmtDate(month.to, { day: 'numeric', month: 'long' })}`));
}

const trophyBadge = (n) => (n > 0 ? h('span', { class: 'trophies', title: `${n} month${n === 1 ? '' : 's'} won`, 'aria-label': `${n} months won` }, icon('trophy', 13), n > 1 ? `×${n}` : '') : null);
const gymText = (b) => (b.gym ? `gym ${b.gym.attended}/${b.gym.planned}` : '');
const streakText = (b) => (b.streak > 0 ? `${b.streak}-day streak` : 'no streak');
const detail = (b) => [
  b.points > 0 ? `${b.avg} a day` : 'No points yet', b.week > 0 ? `${fmt(b.week)} this week` : '', streakText(b), gymText(b),
  b.hidden ? 'hidden' : '', b.private ? 'private, not competing' : '',
].filter(Boolean).join(' · ');

/** Top three on a podium (2nd, 1st, 3rd), so the leader is in the middle and tallest. Same lines on every card. */
function podium(top) {
  const order = [top[1], top[0], top[2]];
  return h('div', { class: 'podium' }, order.map((b, k) => {
    if (!b) return h('span', {});
    const place = k === 1 ? 1 : k === 0 ? 2 : 3;
    return h('div', { class: `step p${place} ${b.isMe ? 'me' : ''}`, 'aria-label': `${place}. ${b.name}, ${b.points} points this month` },
      h('div', { class: 'medal' }, place === 1 ? icon('trophy', 18) : place),
      avatarEl(b, place === 1 ? 52 : 44, 'step-pic'),
      h('div', { class: 'who' }, b.isMe ? 'You' : b.name, trophyBadge(b.trophies)),
      h('div', { class: 'pts' }, fmt(b.points)),
      h('small', {}, `${b.avg} a day`),
      h('small', {}, streakText(b)),
      h('small', { class: `gym ${b.trainedToday ? 'on' : ''}` }, b.gym ? `gym ${b.gym.attended}/${b.gym.planned}` : '–'));
  }));
}

// ------------------------------------------------ activity feed

const KIND_ICON = { checkin: 'camera', pr: 'flame', session: 'train', day: 'check', streak: 'spark', champion: 'trophy' };

/** "18:40" today, "Yesterday 18:40", or "Mon 18:40". created_at is UTC from SQLite. */
function when(at) {
  const d = new Date(`${at.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = localDate(d);
  const today = localDate();
  const yest = localDate(new Date(Date.now() - 86400000));
  return day === today ? time : day === yest ? `Yesterday ${time}` : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

const FEED_FIRST = 6; // the rest sits behind "Show more" so the board stays the focus

function feedSection(items) {
  const list = h('div', {});
  const more = h('button', { class: 'link', style: 'width:100%' });
  let shown = FEED_FIRST;
  const draw = () => {
    list.replaceChildren(...items.slice(0, shown).map((it) => feedItem(it)));
    more.hidden = items.length <= shown;
    more.textContent = `Show ${Math.min(10, items.length - shown)} more`;
  };
  more.onclick = () => { shown += 10; draw(); };
  draw();
  return h('section', { class: 'section feed' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Crew activity'), items.length ? h('span', { class: 'sub' }, 'last 2 weeks') : null),
    items.length ? [list, more] : h('p', { class: 'sub', style: 'margin:0 0 12px' }, 'Check-ins, personal records and 70+ days show up here. Be the first today.'));
}

/**
 * One post. Reactions already given show as chips (tap to add or remove yours); a single
 * smiley button opens the four choices, so a quiet feed is not a wall of buttons.
 */
function feedItem(it) {
  const reacts = h('div', { class: 'reacts' });
  let picking = false;
  const toggle = async (r) => {
    // Optimistic toggle; roll back if the server refuses.
    r.mine = !r.mine; r.count += r.mine ? 1 : -1; picking = false; draw();
    if (r.mine) navigator.vibrate?.(8);
    try { await api('POST', `/api/feed/${it.id}/react`, { kind: r.kind }); } catch (e) { r.mine = !r.mine; r.count += r.mine ? 1 : -1; draw(); toast(e.message, 'bad'); }
  };
  const chip = (r) => h('button', { class: `react ${r.mine ? 'on' : ''}`, type: 'button', 'aria-pressed': String(r.mine), 'aria-label': `${r.kind}, ${r.count}${r.mine ? ', yours' : ''}`, onclick: () => toggle(r) },
    h('span', { 'aria-hidden': 'true' }, r.emoji), r.count ? h('span', { class: 'n' }, r.count) : null);
  const draw = () => {
    // Your own posts, and private members (a reaction would show their name), see counts only.
    if (it.isMe || state.me?.user?.private) { reacts.replaceChildren(...it.reactions.filter((r) => r.count).map((r) => h('span', { class: 'react static' }, r.emoji, h('span', { class: 'n' }, r.count)))); return; }
    if (picking) { reacts.replaceChildren(...it.reactions.map(chip), h('button', { class: 'react add', type: 'button', 'aria-label': 'Close', onclick: () => { picking = false; draw(); } }, icon('close', 14))); return; }
    reacts.replaceChildren(...it.reactions.filter((r) => r.count).map(chip),
      h('button', { class: 'react add', type: 'button', 'aria-label': `React to ${it.name}'s post`, onclick: () => { picking = true; draw(); } }, icon('smile', 16), h('span', { class: 'n' }, '+')));
  };
  draw();
  return h('article', { class: `feed-item k-${it.kind}` },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, it.name.trim()[0]?.toUpperCase() ?? '?',
      it.avatar ? h('img', { src: it.avatar, alt: '', loading: 'lazy', onerror: (e) => e.currentTarget.remove() }) : null,
      h('span', { class: 'kind' }, icon(KIND_ICON[it.kind] ?? 'spark', 11))),
    h('div', { class: 'grow' },
      h('p', { class: 'feed-text' }, h('b', {}, it.isMe ? 'You' : it.name), ' ', it.isMe ? youText(it.text) : it.text, it.private ? h('span', { class: 'meta' }, ' · private, only admins see this') : null),
      h('div', { class: 'feed-foot' }, h('span', { class: 'meta' }, when(it.at)), reacts)));
}

// Posts are written in the third person ("is on a 7-day streak"); read them back to the owner naturally.
const youText = (t) => t.replace(/^is /, 'are ').replace(/^was /, 'were ');

// ------------------------------------------------ hall of fame

function hallOfFame(champions) {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Hall of fame')),
    champions.map((c) => h('div', { class: 'list-row', style: 'cursor:default' },
      h('span', { class: 'rank gold', 'aria-hidden': 'true' }, icon('trophy', 18)),
      h('span', { class: 'grow' },
        h('span', { class: 'strong' }, c.isMe ? `${c.name} (you)` : c.name),
        h('span', { class: 'sub' }, [c.label, c.prize].filter(Boolean).join(' · '))),
      h('span', { class: 'num', style: 'font-size:22px' }, fmt(c.points)))));
}

function howSheet(month) {
  sheet('How points work', () => h('div', { class: 'guide' },
    [['40', 'Calories within 10% of your target (20) and protein at 90% or more (20), counted from food that counts: your plan, swaps, diet foods you add, and eating out that fits a meal.'],
      ['20', 'Meals matched: each meal compared with its plan (calories, protein, carbs, fat). Within 10% is full marks, then 1% lost per 1% off; bigger meals count for more. A different meal with the same macros still scores, even a shawarma or a burger meal.'],
      ['10', 'Logging on the day itself.'],
      ['30', 'A gym check-in on the Train tab: one photo is all 30, whatever you train (gym, CrossFit, a class). Logging sets is optional, for your records.'],
      ['20', 'Rest day: 20 when the day is logged, for as many rest days as your plan has each week. Train on a rest day and check in for +10, the same 30 as a training day.'],
      ['5', 'Water: drink your daily target for 5. More adds a little, less for each extra litre, up to 7 (6 L on a 3 L target).'],
      ['−', 'Going over your calories when cutting (more than 5%) or maintaining (more than 10%) costs 1 point per % over, up to 30. Everything you ate counts here. Bulking has no penalty.']]
      .map(([k, v]) => h('div', { class: 'guide-row' }, h('span', { class: 'rxc static' }, k === '−' ? 'Over' : `${k} pts`), h('p', {}, v))),
    h('p', { class: 'sub' }, 'Eating out (pizza, burgers, sweets, a latte) counts toward your calories. It earns points only inside a meal that still matches its plan; a cheat meal far from the plan earns nothing.'),
    h('p', { class: 'sub' }, `Up to 100 points a day plus 7 for water, added up over the calendar month. Whoever has the most points on ${fmtDate(month.to, { day: 'numeric', month: 'long' })} wins ${month.name}; ties go to more 70+ days. Every month starts from zero. Weight is never scored.`)));
}
