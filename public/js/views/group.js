import { h } from '../dom.js';
import { api } from '../api.js';
import { localDate } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { emptyState } from '../ui.js';

export async function groupView() {
  const main = paint('group', loading());
  const run = () => guard(main, async () => {
    const { board } = await api('GET', `/api/group?today=${localDate()}`);
    if (!board.length) { main.replaceChildren(emptyState('Nobody on the board yet', 'People appear here once they finish setting up their plan.')); return; }
    main.replaceChildren(
      h('h1', { class: 'title' }, 'The crew'),
      h('p', { class: 'sub', style: 'margin:6px 0 18px;max-width:38ch' }, 'Ranked by consistency over the last 7 days, not by weight. A day is scored out of 100 for hitting calories and protein, eating the plan, logging on the day, and training.'),
      h('section', {}, board.map((b, i) => h('div', { class: 'list-row', style: 'cursor:default' },
        h('span', { class: 'rank' }, b.avg7 === null ? '–' : i + 1),
        h('span', { class: 'grow' },
          h('span', { class: 'strong' }, b.isMe ? `${b.name} (you)` : b.name),
          h('span', { class: 'sub' }, b.avg7 === null ? 'No finished days yet' : `${b.streak > 0 ? `${b.streak}-day streak` : 'No streak yet'}${b.today !== null ? ` · today ${b.today}` : ''}${b.hidden ? ' · hidden from others' : ''}`)),
        h('span', { class: 'num', style: 'font-size:34px' }, b.avg7 ?? '')))));
  }, run);
  await run();
}
