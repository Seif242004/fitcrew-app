// Coach picks: which split suits this person? The AI chooses from every split that fits their
// days, with a short reason written to them. The rule-based chooser (chooseSplit in workout.js)
// is the fallback when the AI is off, slow or answers something invalid, so a plan is never
// blocked. The AI only picks the split; exercises, sets and safety checks stay deterministic.
//
// Privacy: sends experience, days, intensity, goal, equipment, injuries text and
// body-fat estimate. No name, email or photos.

import { aiConfig, DEFAULT_MODEL } from './plan-ai.js';
import { getSetting } from './db.js';
import { SPLITS, splitsFor, chooseSplit, INTENSITY } from './workout.js';

/** First {...} block of a model reply (some models wrap JSON in prose or <think> tags). */
export function parseJsonReply(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The AI did not answer in JSON');
  return JSON.parse(t.slice(a, b + 1));
}

export function splitPrompt(profile, candidates) {
  const p = profile;
  const system = 'You are an experienced strength and hypertrophy coach. You choose the weekly training split that will give this person the best results they can stick to. Reply with JSON only.';
  const user = [
    'Person:',
    `- experience: ${p.experience ?? 'beginner'}; trains ${p.daysPerWeek} days a week; wants ${p.intensity ?? 'moderate'} sessions (${INTENSITY[p.intensity ?? 'moderate']?.about ?? ''})`,
    `- goal: ${p.goal ?? 'maintain'}; equipment: ${p.equipment ?? 'gym'}${p.injuries ? `; injuries or limits: "${String(p.injuries).slice(0, 200)}"` : ''}`,
    p.bodyFatPct ? `- body fat about ${p.bodyFatPct}%` : '',
    '',
    'Choose ONE split id from:',
    ...candidates.map((id) => `- ${id}: ${SPLITS[id].name} (${SPLITS[id].about})`),
    '',
    'Weigh: training each muscle about twice a week, recovery between sessions, session length for the intensity, and what a beginner can learn well.',
    'Answer exactly: {"split": "<id>", "reason": "one or two short sentences, written to the person, saying why this split suits them"}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/**
 * Returns { split, reason, by: 'ai' | 'rules' }. profile.daysPerWeek is clamped to 2..6 like the
 * generator does.
 */
export async function pickSplit({ profile, db = null, env = process.env, fetchImpl = fetch, timeoutMs = 12_000 }) {
  const days = Math.min(6, Math.max(2, Math.round(profile.daysPerWeek ?? 3)));
  const person = { ...profile, daysPerWeek: days };
  const rules = { ...chooseSplit(person), by: 'rules' };
  const candidates = splitsFor(days);
  const cfg = aiConfig(env);
  if (!cfg || candidates.length < 2) return rules;
  const model = (db && (getSetting(db, 'aiModelPreferred', null) ?? getSetting(db, 'aiModelWorking', null))) || cfg.model || DEFAULT_MODEL;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 400, messages: splitPrompt(person, candidates) }),
    });
    if (!res.ok) return rules;
    const data = parseJsonReply((await res.json()).choices?.[0]?.message?.content);
    const split = String(data.split ?? '').trim();
    if (!candidates.includes(split)) return rules;
    const reason = String(data.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 280) || rules.reason;
    return { split, reason, by: 'ai', model };
  } catch {
    return rules;
  } finally { clearTimeout(timer); }
}
