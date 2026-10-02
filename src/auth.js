import crypto from 'node:crypto';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHex) {
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(expectedHex, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newInviteCode = () => crypto.randomBytes(5).toString('hex').toUpperCase();

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}
