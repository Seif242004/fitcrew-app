// Before a Cloudflare build: the browser imports the calorie calculator from /shared/calc.js
// (the local server maps that path to src/calc.js). On Cloudflare the files are static, so copy it.
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'public', 'shared'), { recursive: true });
copyFileSync(path.join(root, 'src', 'calc.js'), path.join(root, 'public', 'shared', 'calc.js'));
// Security headers for static files (Cloudflare reads public/_headers).
writeFileSync(path.join(root, 'public', '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
`);
console.log('assets ready: public/shared/calc.js, public/_headers');
