// Web Push with no third-party service and no dependencies:
//   VAPID (RFC 8292) to identify this server, aes128gcm payload encryption (RFC 8291 / 8188).
// Works with Chrome/Edge/Firefox on Android and desktop, and Safari for installed iPhone apps.

import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** This server's VAPID key pair, created once and kept in the database. */
export function vapidKeys(db) {
  let jwk = getSetting(db, 'vapidPrivateJwk');
  if (!jwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    jwk = privateKey.export({ format: 'jwk' });
    setSetting(db, 'vapidPrivateJwk', jwk);
  }
  const publicRaw = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  // The JWK itself is the signing key: Cloudflare's runtime accepts it in crypto.sign, a KeyObject there is not.
  return { privateKey: jwk, publicKey: b64u(publicRaw) };
}

function vapidJwt(privateKey, audience, subject) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, format: 'jwk', dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

/** RFC 8291 encryption of `payload` for one subscription. Returns the request body. */
export function encrypt(payload, p256dh, authSecret) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, data]);
}

/** Decrypt (tests only): proves encrypt() produces what a browser would accept. */
export function decryptForTest(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16); const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen); const data = body.subarray(21 + idlen);
  const shared = uaEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, fromB64u(authSecret), keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

/**
 * Send { title, body, url, tag } to every device of a user. Dead subscriptions (404/410) are
 * removed. Never throws: a failed notification must not break the job that sent it.
 */
export async function pushToUser(db, userId, message, { fetchImpl = fetch } = {}) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
  if (!subs.length) return { sent: 0 };
  const { privateKey, publicKey } = vapidKeys(db);
  const subject = `mailto:${getSetting(db, 'adminContact', 'admin@fitcrew.app')}`;
  let sent = 0;
  for (const s of subs) {
    try {
      const aud = new URL(s.endpoint).origin;
      const res = await fetchImpl(s.endpoint, {
        method: 'POST',
        headers: {
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '43200', Urgency: 'normal',
          Authorization: `vapid t=${vapidJwt(privateKey, aud, subject)}, k=${publicKey}`,
        },
        body: encrypt(JSON.stringify(message), s.p256dh, s.auth),
      });
      if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
      else if (res.ok) sent++;
    } catch (e) { console.warn('[push]', e.message); }
  }
  return { sent };
}
