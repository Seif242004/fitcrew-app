// Copies FITCREW_AI_KEY from fitcrew.env (on this PC) into Cloudflare as an encrypted secret.
// The key is piped straight into wrangler: it is never printed, logged or written anywhere else.
// Usage: node scripts/cloud-secret.js            (only sets it if Cloudflare doesn't have it yet)
//        node scripts/cloud-secret.js --force    (replace it, e.g. after rotating the key)
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const NAME = 'FITCREW_AI_KEY';
const wrangler = (args, input) => spawnSync('npx', ['--yes', 'wrangler@4', ...args], { input, encoding: 'utf8', shell: process.platform === 'win32' });

// 1. Already set? (wrangler lists secret names only, never values.)
if (!process.argv.includes('--force')) {
  const list = wrangler(['secret', 'list']);
  if (list.status === 0 && list.stdout.includes(`"${NAME}"`)) { console.log(`AI key: already stored in Cloudflare.`); process.exit(0); }
}

// 2. Read it from the local settings file.
const file = ['fitcrew.env', 'fitcrew.env.env'].find(existsSync);
const line = file && readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${NAME}=`));
const key = line?.slice(NAME.length + 1).trim().replace(/^["']|["']$/g, '');
if (!key) {
  console.log(`AI key: no ${NAME} in fitcrew.env. The app works without it (no coach / AI plans).`);
  console.log(`        To add it later: npx wrangler secret put ${NAME}   (paste the key when asked)`);
  process.exit(0);
}

// 3. Hand it to Cloudflare over stdin.
const put = wrangler(['secret', 'put', NAME], key);
if (put.status !== 0) { console.error('AI key: Cloudflare refused it:\n' + (put.stderr || put.stdout).replaceAll(key, '***')); process.exit(1); }
console.log('AI key: stored in Cloudflare (encrypted).');
