// Tiny DOM helper. Text is always inserted as text nodes, never as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'line', 'rect', 'polyline', 'g', 'text', 'defs', 'linearGradient', 'stop']);

// Native replaceChildren/append turn null into the text "null". Views pass `cond ? node : null`
// freely, so make both ignore empty values and flatten arrays. Every view imports this file.
for (const name of ['replaceChildren', 'append', 'prepend']) {
  const native = Element.prototype[name];
  Element.prototype[name] = function patched(...kids) {
    return native.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  };
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export function h(tag, props, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

export const clear = (el) => { el.replaceChildren(); return el; };
