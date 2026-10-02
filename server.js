// FitCrew server: static files + JSON API in one dependency-free Node process.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createApi } from './src/api.js';
import { persistConfig, restore, createSaver } from './src/persist.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(root, 'public');
const SHARED = new Set(['calc.js']); // modules the browser may import
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function createServer(db = openDb(), saver = null) {
  const api = createApi(db);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
      if (saver && req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) saver.markDirty(); });
      return api(req, res, url);
    }
    let rel = decodeURIComponent(url.pathname);
    let file;
    if (rel.startsWith('/shared/') && SHARED.has(rel.slice(8))) file = path.join(root, 'src', rel.slice(8));
    else {
      if (rel === '/') rel = '/index.html';
      file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    }
    try {
      const body = await readFile(file);
      const noCache = file.endsWith('sw.js') || file.endsWith('index.html');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600', ...SECURITY });
      res.end(body);
    } catch {
      // Single-page app: unknown paths without an extension fall back to the shell.
      if (!path.extname(rel)) {
        const body = await readFile(path.join(PUBLIC, 'index.html')).catch(() => null);
        if (body) { res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache', ...SECURITY }); return res.end(body); }
      }
      res.writeHead(404); res.end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const file = process.env.FITCREW_DB ?? 'data/fitcrew.db';
  let cfg = null;
  try { cfg = persistConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  if (cfg) {
    mkdirSync(path.dirname(file), { recursive: true });
    await restore(cfg, file).catch((e) => { console.error(e.message); process.exit(1); });
  }
  const db = openDb(file);
  const saver = cfg ? createSaver(cfg, db) : null;
  if (saver) saver.markDirty(); // store the database right away on every start
  const server = createServer(db, saver);
  server.listen(port, '0.0.0.0', () => console.log(`FitCrew running on port ${port}${cfg ? ' (encrypted database saved to GitHub)' : ''}`));
  const stop = async () => { try { await saver?.flush(); } finally { process.exit(0); } };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
