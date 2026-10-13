import crypto from 'node:crypto';

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, saltHex, hashHex] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT_OPTIONS);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return 'Password must be between 12 and 128 characters.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include upper-case, lower-case, number, and special characters.';
  }
  return null;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const tokenDigest = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const safeEqual = (a, b) => {
  const one = Buffer.from(String(a));
  const two = Buffer.from(String(b));
  return one.length === two.length && crypto.timingSafeEqual(one, two);
};

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((x) => x.length === 2));
}

export function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizeKey(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}
