const routes = [];

export function addRoute(pattern, view) {
  const keys = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
  routes.push({ re: new RegExp(`^${pattern.replace(/:(\w+)/g, '([^/]+)')}$`), keys, view });
}

export function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

export async function render() {
  const [path, qs] = (location.hash.slice(1) || '/today').split('?');
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      await r.view(params, new URLSearchParams(qs ?? ''));
      return;
    }
  }
  navigate('/today');
}

export function start() {
  addEventListener('hashchange', render);
  return render();
}
