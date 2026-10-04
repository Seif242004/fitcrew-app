// FitCrew on Cloudflare.
//   Worker (this file): serves the app's files from Cloudflare's CDN and forwards /api/* to ...
//   FitCrewDB (a SQLite Durable Object): one instance holds the crew's database and runs the
//   exact same API code as the local server (src/api.js), plus the daily check-in jobs.
// Free plan, no card: Workers, static assets, SQLite Durable Objects and cron triggers are all
// included. A Durable Object request may use up to 30 s of CPU, plenty for password hashing.
import { DurableObject } from 'cloudflare:workers';
import { DOSqlite } from './sqlite.js';
import { initDb } from '../src/db.js';
import { createApi } from '../src/api.js';
import { runDueJobs } from '../src/jobs.js';

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

/** The crew's database and API. Exactly one instance ("main"). */
export class FitCrewDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Secrets and vars become process.env for the shared code (FITCREW_AI_KEY, ...).
    for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
    this.db = initDb(new DOSqlite(ctx.storage.sql));
    this.api = createApi(this.db);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__cron') return Response.json(await runDueJobs(this.db));
    return toResponse(this.api, request, url);
  }
}

// The API handler speaks node:http (req, res). Adapt a fetch Request to it and collect the reply.
async function toResponse(api, request, url) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : Buffer.from(await request.arrayBuffer());
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  headers['x-forwarded-proto'] = url.protocol.replace(':', '');
  const req = {
    method: request.method, headers, url: url.pathname + url.search,
    socket: { remoteAddress: request.headers.get('cf-connecting-ip') ?? 'cf' }, // used for login rate limits
    async *[Symbol.asyncIterator]() { if (body?.length) yield body; },
  };
  return new Promise((resolve) => {
    let status = 200; const out = new Headers(SECURITY);
    const res = {
      statusCode: 200,
      setHeader: (k, v) => out.set(k, v),
      writeHead: (s, h = {}) => { status = s; res.statusCode = s; for (const [k, v] of Object.entries(h)) out.set(k, Array.isArray(v) ? v.join(', ') : String(v)); },
      end: (data) => resolve(new Response(data ?? null, { status, headers: out })),
      on: () => {},
    };
    api(req, res, url);
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return env.DB.get(env.DB.idFromName('main')).fetch(request);
    }
    return env.ASSETS.fetch(request); // static files; unknown paths fall back to index.html (SPA)
  },
  // Every 10 minutes: run any check-in that is due (morning, evening, crew, weekly).
  async scheduled(_event, env, ctx) {
    const stub = env.DB.get(env.DB.idFromName('main'));
    ctx.waitUntil(stub.fetch('https://fitcrew.internal/__cron'));
  },
};
