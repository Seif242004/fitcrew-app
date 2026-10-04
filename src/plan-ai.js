// Optional AI menu proposer for the diet plan generator.
//
// The model ONLY proposes which foods go together in each meal, chosen from the allowed food
// list by id. It never sets grams or macros: src/plan.js validates every proposed meal
// (mealsFromMenu) and sizes portions with the solver. Any failure (no key, timeout, bad JSON,
// invalid foods, targets not reachable) falls back to the built-in meal templates.
//
// Works with any OpenAI-compatible endpoint (NVIDIA Build, Ollama Cloud, Gemini's OpenAI layer):
//   FITCREW_AI_BASE_URL  e.g. https://integrate.api.nvidia.com/v1
//   FITCREW_AI_KEY       API key (leave empty to disable AI)
//   FITCREW_AI_MODEL     e.g. moonshotai/kimi-k2.6 (falls back automatically if the provider retires it)
//
// Privacy: only meal structure, food preferences and the food list are sent. No names,
// body measurements or photos.

import { generatePlan, planContext } from './plan.js';

// Providers retire model IDs (kimi-k2.5 disappeared from NVIDIA). If the configured model is
// missing, these are tried in order and the first that works is remembered (see coach.js).
// Measured from the crew's NVIDIA account (Oct 2026): gpt-oss-20b ~2 s with correct tool calls;
// Kimi K2.6 / Mistral Large / Nemotron Ultra are not enabled for free accounts (404 "Not found for
// account"); GLM 5.3, DeepSeek V4.1 Flash and Kimi K3 were over 30 s. Admin can re-run the benchmark.
export const DEFAULT_MODEL = 'openai/gpt-oss-20b';
export const FALLBACK_MODELS = ['openai/gpt-oss-20b', 'moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3'];

export function aiConfig(env = process.env) {
  const key = env.FITCREW_AI_KEY?.trim();
  if (!key) return null;
  return {
    key,
    baseUrl: (env.FITCREW_AI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    model: env.FITCREW_AI_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(env.FITCREW_AI_TIMEOUT_MS ?? 45_000),
  };
}

/** Build the chat prompt. Kept compact: food ids + names + roles only. */
export function buildPrompt(ctx, days, prefs = {}) {
  const meals = ctx.split.map(([name, kind, share]) => `${name} (${kind}, ~${Math.round(share * 100)}% of daily calories)`);
  const foods = ctx.pool.map((f) => `${f.id}: ${f.name} [${f.roles.join(',')}]`).join('\n');
  const liked = [...ctx.liked].filter((id) => ctx.poolById.has(id));
  const system =
    'You plan meals for a diet app used in Egypt. Propose realistic, culturally normal Egyptian meals ' +
    'that people actually eat together. Use ONLY food ids from the list. Do not invent foods. ' +
    'Do not give grams. Reply with JSON only, no prose, no markdown.';
  const user = [
    `Plan ${days} different days. Each day has these meals in order: ${meals.join('; ')}.`,
    'Rules:',
    '- Each meal has 2 to 5 foods, no food repeated within a meal.',
    '- Lunch is the cooked meal of the day: one protein, one carb, one vegetable, optionally one fat. Egyptian home dishes (molokhia, mahshi, okra, green beans or peas stew, koshari) belong at lunch, with their protein and rice.',
    '- At most ONE cooked Egyptian dish per day. Dinner is light, the Egyptian way: eggs, cheese, ful, tuna, smoked turkey, a chicken wrap or yogurt with bread, toast or oats. Never a cooked dish at dinner.',
    '- Do not repeat the main carb or the main protein of lunch at dinner (rice and chicken at lunch -> e.g. tuna sandwich or eggs and cheese at dinner).',
    '- A post-workout dinner is protein + carbs (chicken or fish with potatoes, rice or a wrap), not a cooked dish.',
    '- Breakfast: Egyptian breakfasts (ful, eggs, cheese, taameya, baladi bread, oats, yogurt).',
    '- Snacks: small (fruit, yogurt, milk, nuts, a shake).',
    '- Vary meals across the week; do not repeat the same lunch two days in a row.',
    prefs.vegetarian ? '- The user is vegetarian.' : '',
    liked.length ? `- Favour these liked foods: ${liked.join(', ')}.` : '',
    '',
    'Allowed foods (id: name [roles]):',
    foods,
    '',
    'Answer exactly in this JSON shape:',
    '{"days":[{"meals":[{"title":"short meal name","foodIds":["id","id"]}]}]}',
  ].filter(Boolean).join('\n');
  return { system, user };
}

/** Pull the first JSON object out of a model reply (tolerates code fences / stray text). */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** Ask the model for a menu. Returns an array of days or throws. `fetchImpl` is injectable for tests. */
export async function proposeMenu({ ctx, days, prefs, cfg, fetchImpl = fetch }) {
  const { system, user } = buildPrompt(ctx, days, prefs);
  let lastErr;
  // Same model fallback as the coach: a retired model ID answers 404 ("404 page not found").
  for (const model of [...new Set([cfg.model, ...FALLBACK_MODELS])]) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model, temperature: 0.7, max_tokens: 4000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (res.status === 404) { lastErr = new Error(`AI model ${model} not found`); continue; }
      if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
      const data = await res.json();
      const json = extractJson(data?.choices?.[0]?.message?.content);
      if (!Array.isArray(json?.days) || !json.days.length) throw new Error('AI reply had no usable days');
      return json.days;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('No AI model available');
}

/**
 * Async plan generation: AI menu when configured, validated and sized by the solver;
 * templates otherwise. Never throws because of the AI.
 */
export async function generatePlanSmart({ targets, prefs = {}, foods, days = 1, seed, env = process.env, fetchImpl }) {
  const cfg = aiConfig(env);
  let menu = null;
  let aiError = null;
  if (cfg) {
    try {
      menu = await proposeMenu({ ctx: planContext({ prefs, foods }), days, prefs, cfg, fetchImpl });
    } catch (e) {
      aiError = e.name === 'AbortError' ? 'AI menu timed out' : e.message;
    }
  }
  const plan = generatePlan({ targets, prefs, foods, days, seed, menu });
  if (aiError) {
    console.warn(`[plan-ai] ${aiError}; used meal templates instead.`);
    plan.aiNote = 'AI menu unavailable; built from meal templates.';
  }
  return plan;
}
