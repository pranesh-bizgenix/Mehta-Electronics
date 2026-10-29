// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) and RFC 4648 base32.

import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0; const out = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret.');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export class Totp {
  constructor({ stepSeconds = 30, digits = 6, window = 1 } = {}) { Object.assign(this, { stepSeconds, digits, window }); }

  generateSecret() { return base32Encode(crypto.randomBytes(20)); }

  stepAt(date) { return Math.floor(date.getTime() / 1000 / this.stepSeconds); }

  codeAt(secret, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(binary % 10 ** this.digits).padStart(this.digits, '0');
  }

  /** Returns the matched step (for replay protection) or null. */
  verify(secret, code, at, lastUsedStep = null) {
    if (!/^\d{6}$/.test(String(code))) return null;
    const current = this.stepAt(at);
    for (let delta = -this.window; delta <= this.window; delta++) {
      const step = current + delta;
      if (lastUsedStep !== null && step <= Number(lastUsedStep)) continue;
      const expected = this.codeAt(secret, step);
      if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return step;
    }
    return null;
  }

  otpauthUri({ secret, account, issuer }) {
    return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${this.digits}&period=${this.stepSeconds}`;
  }
}
