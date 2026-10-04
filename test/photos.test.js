import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../server.js';

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-FitCrew': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return {
      get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), del: (p) => call('DELETE', p),
      raw: async (p) => { const r = await fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; },
    };
  };
  return { db, base, client, close: () => server.close() };
}


const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const dataUrl = (b) => `data:image/jpeg;base64,${b.toString('base64')}`;

test('progress photos are private to the owner and admins', async (t) => {
  const app = await boot();
  t.after(app.close);
  const admin = app.client(); const sam = app.client(); const lee = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'h@example.com', password: 'a-good-password' });
  for (const [c, n] of [[sam, 'Sam'], [lee, 'Lee']]) {
    const { code } = (await admin.post('/api/admin/invites', {})).body;
    await c.post('/api/register', { code, name: n, email: `${n}@example.com`, password: 'long-password-1' });
  }
  const up = await sam.post('/api/photos', { date: '2026-10-01', pose: 'front', image: dataUrl(jpeg) });
  assert.equal(up.status, 200);
  assert.equal((await sam.post('/api/photos', { date: '2026-10-01', pose: 'front', image: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await sam.post('/api/photos', { date: '2026-10-01', pose: 'front', image: dataUrl(Buffer.alloc(2000, 1)) })).status, 400);
  assert.equal((await sam.post('/api/photos', { date: '2026-10-01', pose: 'hat', image: dataUrl(jpeg) })).status, 400);

  assert.equal((await sam.get('/api/photos')).body.photos.length, 1);
  assert.equal((await lee.get('/api/photos')).body.photos.length, 0);
  const own = await sam.raw(`/api/photos/${up.body.id}`);
  assert.equal(own.status, 200); assert.deepEqual(own.buf, jpeg);
  assert.equal((await lee.raw(`/api/photos/${up.body.id}`)).status, 404);
  assert.equal((await admin.raw(`/api/photos/${up.body.id}`)).status, 200);
  assert.equal((await lee.del(`/api/photos/${up.body.id}`)).status, 404);
  assert.equal((await sam.del(`/api/photos/${up.body.id}`)).status, 200);
  assert.equal((await sam.get('/api/photos')).body.photos.length, 0);
});
