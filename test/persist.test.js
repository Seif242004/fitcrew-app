import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { persistConfig, restore, createSaver, seal, open } from '../src/persist.js';

// A tiny fake of the parts of the GitHub API that persist.js uses.
async function fakeGithub() {
  const st = { blobs: new Map(), trees: new Map(), commits: [], file: null, repoStatus: 200, down: false, n: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (st.down) { res.destroy(); return; }
    if (req.headers.authorization !== 'Bearer tok') return json(401, {});
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u === '/repos/me/data') return json(st.repoStatus, {});
    if (req.method === 'GET' && u === '/repos/me/data/contents/fitcrew.db.enc') {
      if (!st.file) return json(404, {});
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(st.file);
    }
    if (req.method === 'POST' && u === '/repos/me/data/git/blobs') { const sha = `b${++st.n}`; st.blobs.set(sha, Buffer.from(body.content, 'base64')); return json(201, { sha }); }
    if (req.method === 'POST' && u === '/repos/me/data/git/trees') { const sha = `t${++st.n}`; st.trees.set(sha, body.tree); return json(201, { sha }); }
    if (req.method === 'POST' && u === '/repos/me/data/git/commits') { const sha = `c${++st.n}`; st.commits.push({ sha, ...body }); return json(201, { sha }); }
    if (req.method === 'PATCH' && u === '/repos/me/data/git/refs/heads/main') {
      assert.equal(body.force, true);
      const c = st.commits.find((x) => x.sha === body.sha);
      st.file = st.blobs.get(st.trees.get(c.tree)[0].sha);
      return json(200, {});
    }
    json(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { st, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const env = (url, over = {}) => ({ GITHUB_TOKEN: 'tok', GITHUB_REPO: 'me/data', FITCREW_BACKUP_KEY: 'a-long-secret-key-for-tests', GITHUB_API: url, ...over });
const quiet = () => {};

test('sealed data round-trips and is unreadable without the key', () => {
  const sealed = seal(Buffer.from('SQLite format 3 secret body'), 'k'.repeat(24));
  assert.ok(!sealed.includes('secret body'));
  assert.equal(open(sealed, 'k'.repeat(24)).toString(), 'SQLite format 3 secret body');
  assert.throws(() => open(sealed, 'x'.repeat(24)), /Could not decrypt/);
  const bad = Buffer.from(sealed); bad[bad.length - 1] ^= 1;
  assert.throws(() => open(bad, 'k'.repeat(24)), /Could not decrypt/);
});

test('settings must be complete and the key long enough', () => {
  assert.equal(persistConfig({}), null);
  assert.throws(() => persistConfig({ GITHUB_TOKEN: 'a', GITHUB_REPO: 'b/c' }), /all three/);
  assert.throws(() => persistConfig({ GITHUB_TOKEN: 'a', GITHUB_REPO: 'b/c', FITCREW_BACKUP_KEY: 'short' }), /20 characters/);
});

test('save, then restore on a fresh disk, keeps the data; one commit, no readable data upstream', async (t) => {
  const gh = await fakeGithub(); t.after(gh.close);
  const cfg = persistConfig(env(gh.url, { PERSIST_DEBOUNCE_MS: '10', PERSIST_MAX_WAIT_MS: '50' }));
  const dir = mkdtempSync(path.join(tmpdir(), 'fc-'));
  const fileA = path.join(dir, 'a.db');

  assert.equal(await restore(cfg, fileA, quiet), 'fresh');
  const dbA = openDb(fileA);
  dbA.prepare("INSERT INTO invites (code, created_by, expires_at) VALUES ('PERSIST1', NULL, '2099-01-01')").run();
  const saver = createSaver(cfg, dbA, quiet);
  saver.markDirty();
  await saver.flush();
  assert.ok(gh.st.file, 'a snapshot was uploaded');
  assert.ok(!gh.st.file.includes('SQLite format 3'), 'the upload is encrypted');
  assert.ok(!gh.st.file.includes('PERSIST1'));
  assert.deepEqual(gh.st.commits.at(-1).parents, []);

  // second change: a new orphan commit again
  dbA.prepare("INSERT INTO invites (code, created_by, expires_at) VALUES ('PERSIST2', NULL, '2099-01-01')").run();
  saver.markDirty(); await saver.flush();
  assert.equal(gh.st.commits.length, 2);
  assert.deepEqual(gh.st.commits.at(-1).parents, []);

  // brand-new machine: nothing on disk, data comes back
  const fileB = path.join(dir, 'b.db');
  assert.equal(await restore(cfg, fileB, quiet), 'restored');
  const dbB = openDb(fileB);
  assert.deepEqual(dbB.prepare('SELECT code FROM invites ORDER BY code').all().map((r) => r.code), ['PERSIST1', 'PERSIST2']);
});

test('refuses to start when the key is wrong, the repo is wrong, or GitHub is unreachable', async (t) => {
  const gh = await fakeGithub(); t.after(gh.close);
  const cfg = persistConfig(env(gh.url, { PERSIST_DEBOUNCE_MS: '10' }));
  const dir = mkdtempSync(path.join(tmpdir(), 'fc-'));
  const db = openDb(path.join(dir, 'a.db'));
  const saver = createSaver(cfg, db, quiet); saver.markDirty(); await saver.flush();

  const file = path.join(dir, 'x.db');
  await assert.rejects(restore({ ...cfg, key: 'a-different-secret-key-123' }, file, quiet), /Could not decrypt/);
  assert.ok(!existsSync(file), 'nothing is written when decryption fails');

  gh.st.repoStatus = 404;
  await assert.rejects(restore(cfg, file, quiet), /Cannot open the GitHub repo/);
  gh.st.repoStatus = 200;

  await assert.rejects(restore({ ...cfg, token: 'wrong' }, file, quiet), /Cannot open the GitHub repo/);

  gh.st.down = true;
  const slow = { ...cfg };
  const t0 = Date.now();
  await assert.rejects(Promise.race([restore(slow, file, quiet), new Promise((_, rej) => setTimeout(() => rej(new Error('still retrying')), 3000))]), /still retrying|failed|fetch/);
  assert.ok(Date.now() - t0 >= 1000, 'it retried instead of starting blank');
  assert.ok(!existsSync(file));
});

test('the real server restores your account after its disk is wiped', async (t) => {
  const { spawn } = await import('node:child_process');
  const gh = await fakeGithub(); t.after(gh.close);
  const run = (dbFile, port) => {
    const child = spawn(process.execPath, ['--no-warnings', 'server.js'], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), // fileURLToPath, not .pathname: works on Windows
      env: { ...process.env, ...env(gh.url, { PERSIST_DEBOUNCE_MS: '50' }), FITCREW_DB: dbFile, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    return { child, out: () => out };
  };
  const waitUp = async (port) => { for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${port}/api/status`)).json(); } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('server did not start'); };
  const exited = (c) => new Promise((r) => c.once('exit', r));

  const dir = mkdtempSync(path.join(tmpdir(), 'fc-'));
  const one = run(path.join(dir, 'one', 'f.db'), 3911);
  assert.equal((await waitUp(3911)).needsSetup, true);
  const r = await fetch('http://127.0.0.1:3911/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1' }, body: JSON.stringify({ name: 'Haged', email: 'h@example.com', password: 'a-good-password' }) });
  assert.equal(r.status, 200);
  // Windows has no real SIGTERM (kill is immediate), so there let the debounced save land first.
  if (process.platform === 'win32') {
    // wait for a save after setup, then until saves stop for 500 ms (the startup save may still be in flight)
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const before = gh.st.commits.length;
    for (let i = 0; i < 50 && gh.st.commits.length === before; i++) await sleep(100);
    for (let n = -1, i = 0; i < 20 && n !== gh.st.commits.length; i++) { n = gh.st.commits.length; await sleep(500); }
  }
  one.child.kill('SIGTERM');          // the host stops the app: it must save first
  await exited(one.child);

  const two = run(path.join(dir, 'two', 'f.db'), 3912);   // different, empty disk
  t.after(() => two.child.kill());
  assert.equal((await waitUp(3912)).needsSetup, false, two.out());
});
