// Tool calls written as text. Some models on NVIDIA (Kimi, DeepSeek, Nemotron, Qwen) sometimes
// put the call in the message text in their own chat-template format instead of the API's
// `tool_calls` field, so the app thought they "did not use the tool". This turns those back into
// normal tool calls. Only names of tools we offered are accepted, and the arguments must be JSON.
//
// Formats seen:
//   <tool_call>{"name": "log_foods", "arguments": {...}}</tool_call>              (Hermes, Qwen, Nemotron)
//   <|tool_call_begin|>functions.log_foods:0<|tool_call_argument_begin|>{...}<|tool_call_end|>   (Kimi)
//   <｜tool▁call▁begin｜>function<｜tool▁sep｜>log_foods ```json {...} ```<｜tool▁call▁end｜>    (DeepSeek)
//   {"name": "log_foods", "arguments": {...}} or ```json ...``` on its own        (plain JSON)

/** The first balanced {...} JSON object starting at or after `from`, or null. */
function jsonAt(text, from = 0) {
  const start = text.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }; } catch { return null; }
    }
  }
  return null;
}

/**
 * Tool calls found in a message's text: [{ id, type: 'function', function: { name, arguments } }].
 * `names` = the tools that were offered.
 */
export function textToolCalls(content, names) {
  const text = String(content ?? '');
  if (!text || !names.size) return [];
  const out = [];
  const push = (name, args) => {
    if (!names.has(name) || !args || typeof args !== 'object') return;
    out.push({ id: `text${out.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  };
  // 1) A tool name followed by its JSON arguments (Kimi / DeepSeek markers, "functions.x:0").
  const nameRe = new RegExp(`(?:functions\\.)?\\b(${[...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b(?::\\d+)?`, 'g');
  for (let m; (m = nameRe.exec(text));) {
    const j = jsonAt(text, m.index + m[0].length);
    if (!j) continue;
    // {"name": ..., "arguments": ...} right after a marker is the Hermes shape, handled below.
    if (typeof j.value.name === 'string' && 'arguments' in j.value) continue;
    // Only when the JSON follows the name closely (markers, a code fence), not a later sentence.
    const gap = text.slice(m.index + m[0].length, text.indexOf('{', m.index + m[0].length));
    if (gap.length > 40 || /[a-z]{4,}\s+[a-z]{4,}/i.test(gap.replace(/json|function|tool|call|argument|begin|sep|[<|>｜▁`\s]/gi, ''))) continue;
    push(m[1], j.value);
    nameRe.lastIndex = j.end;
  }
  if (out.length) return out;
  // 2) {"name": "...", "arguments": {...}} objects anywhere (also inside <tool_call> tags or fences).
  for (let i = 0; i < text.length;) {
    const j = jsonAt(text, i);
    if (!j) break;
    const v = j.value;
    if (typeof v?.name === 'string') push(v.name, typeof v.arguments === 'string' ? (() => { try { return JSON.parse(v.arguments); } catch { return null; } })() : v.arguments ?? v.parameters);
    i = j.end;
  }
  return out;
}

/** The message with any text-written tool calls moved into tool_calls (and that text removed). */
export function normalizeToolCalls(msg, names) {
  if (!msg || msg.tool_calls?.length) return msg;
  const calls = textToolCalls(msg.content, names);
  if (!calls.length) return msg;
  return { ...msg, content: '', tool_calls: calls };
}
