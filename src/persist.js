// Keeps the SQLite database alive on hosts whose disk is wiped on every restart (free tiers).
// The database is gzip-compressed, ENCRYPTED (AES-256-GCM) and stored as one file in a private
// GitHub repo. On start we restore and decrypt it; after changes we upload a fresh copy shortly
// after. The repo keeps ONE commit, so it never grows. Zero dependencies.
// Enabled when GITHUB_TOKEN, GITHUB_REPO and FITCREW_BACKUP_KEY are all set.
import { gzipSync, gunzipSync, } from 'node:zlib';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MAGIC = Buffer.from('FCB1');

export function persistConfig(env = process.env) {
  const any = env.GITHUB_TOKEN || env.GITHUB_REPO || env.FITCREW_BACKUP_KEY;
  if (!any) return null;
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.FITCREW_BACKUP_KEY) {
    throw new Error('Saving to GitHub needs all three settings: GITHUB_TOKEN, GITHUB_REPO and FITCREW_BACKUP_KEY.');
  }
  if (env.FITCREW_BACKUP_KEY.length < 20) throw new Error('FITCREW_BACKUP_KEY must be at least 20 characters.');
  return {
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH ?? 'main',
    file: env.GITHUB_DB_FILE ?? 'fitcrew.db.enc',
    key: env.FITCREW_BACKUP_KEY,
    api: (env.GITHUB_API ?? 'https://api.github.com').replace(/\/$/, ''),
    debounceMs: Number(env.PERSIST_DEBOUNCE_MS ?? 20_000),
    maxWaitMs: Number(env.PERSIST_MAX_WAIT_MS ?? 120_000),
  };
}

// ---------- encryption: FCB1 | salt(16) | iv(12) | tag(16) | ciphertext ----------
export function seal(plain, passphrase) {
  const salt = randomBytes(16); const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}

export function open(blob, passphrase) {
  if (blob.length < 48 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('The saved database is not in the expected format.');
  const salt = blob.subarray(4, 20); const iv = blob.subarray(20, 32); const tag = blob.subarray(32, 48);
  const d = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(blob.subarray(48)), d.final()]); } catch {
    throw new Error('Could not decrypt the saved database. FITCREW_BACKUP_KEY is wrong or the file is damaged. Not starting.');
  }
}

// ---------- GitHub ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gh(cfg, method, route, { body, raw } = {}) {
  return fetch(`${cfg.api}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'fitcrew',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ok(res, what) {
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  throw new Error(`${what} failed (${res.status}) ${text.slice(0, 200)}`);
}

const FATAL = /Cannot open the GitHub repo|Could not decrypt|not in the expected format|looks damaged/;

/**
 * Downloads and decrypts the latest snapshot to `file` before the database opens.
 * Returns 'restored' or 'fresh'. Throws when GitHub cannot be reached, the repo is wrong or the key
 * is wrong, so the app never starts with a blank database that would later overwrite real data.
 */
export async function restore(cfg, file, log = console.log) {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const repo = await gh(cfg, 'GET', `/repos/${cfg.repo}`);
      if ([401, 403, 404].includes(repo.status)) {
        throw new Error(`Cannot open the GitHub repo ${cfg.repo} (${repo.status}). Check GITHUB_REPO and that the token can read and write its contents.`);
      }
      await ok(repo, 'Reading the repo');
      const res = await gh(cfg, 'GET', `/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.file)}?ref=${encodeURIComponent(cfg.branch)}`, { raw: true });
      if (res.status === 404) { log('No saved database yet: starting fresh.'); return 'fresh'; }
      await ok(res, 'Downloading the database');
      const data = gunzipSync(open(Buffer.from(await res.arrayBuffer()), cfg.key));
      if (data.length < 4096 || data.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('The saved database looks damaged. Not starting.');
      for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
      writeFileSync(file, data);
      log(`Restored the database (${Math.round(data.length / 1024)} KB).`);
      return 'restored';
    } catch (e) {
      lastErr = e;
      if (FATAL.test(e.message)) throw e;
      log(`Restore attempt ${attempt} failed: ${e.message}`);
      await sleep(Math.min(2000 * attempt, 10_000));
    }
  }
  throw lastErr;
}

/** Uploads one snapshot as the repo's only commit (history is replaced, not extended). */
async function upload(cfg, bytes) {
  const j = (r) => r.json();
  const blob = await ok(await gh(cfg, 'POST', `/repos/${cfg.repo}/git/blobs`, { body: { content: bytes.toString('base64'), encoding: 'base64' } }), 'Uploading the database').then(j);
  const tree = await ok(await gh(cfg, 'POST', `/repos/${cfg.repo}/git/trees`, { body: { tree: [{ path: cfg.file, mode: '100644', type: 'blob', sha: blob.sha }] } }), 'Creating the snapshot').then(j);
  const commit = await ok(await gh(cfg, 'POST', `/repos/${cfg.repo}/git/commits`, { body: { message: `FitCrew encrypted database ${new Date().toISOString()}`, tree: tree.sha, parents: [] } }), 'Saving the snapshot').then(j);
  await ok(await gh(cfg, 'PATCH', `/repos/${cfg.repo}/git/refs/heads/${cfg.branch}`, { body: { sha: commit.sha, force: true } }), 'Publishing the snapshot');
}

/** Debounced saver. Call markDirty() after any change; flush() saves now (used on shutdown). */
export function createSaver(cfg, db, log = console.log) {
  let dirty = false; let timer = null; let firstDirtyAt = 0; let running = null; let failures = 0;
  const dir = mkdtempSync(path.join(tmpdir(), 'fitcrew-snap-'));
  const tmp = path.join(dir, 'snapshot.db');

  async function saveOnce() {
    dirty = false;
    rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const bytes = seal(gzipSync(readFileSync(tmp), { level: 9 }), cfg.key);
    rmSync(tmp, { force: true });
    await upload(cfg, bytes);
    failures = 0;
    log(`Saved the encrypted database to GitHub (${Math.round(bytes.length / 1024)} KB).`);
  }

  function schedule() {
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;
    clearTimeout(timer);
    const wait = Math.max(0, Math.min(cfg.debounceMs, firstDirtyAt + cfg.maxWaitMs - now));
    timer = setTimeout(() => { firstDirtyAt = 0; flush(); }, wait);
    timer.unref?.();
  }

  async function flush() {
    clearTimeout(timer); timer = null;
    if (running) await running;
    if (!dirty) return;
    running = (async () => {
      try { await saveOnce(); } catch (e) {
        dirty = true; failures += 1;
        log(`Saving to GitHub failed (attempt ${failures}): ${e.message}`);
        timer = setTimeout(flush, Math.min(15_000 * failures, 120_000));
        timer.unref?.();
      }
    })();
    await running; running = null;
    if (dirty && !timer) schedule();
  }

  return {
    markDirty() { dirty = true; if (!running) schedule(); },
    flush,
    pending: () => dirty || Boolean(running),
  };
}
