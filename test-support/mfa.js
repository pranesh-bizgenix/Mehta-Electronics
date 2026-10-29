import crypto from 'node:crypto';
import { FixedClock } from '../src/core/runtime.js';
import { Totp } from '../src/modules/mfa/totp.js';

export const TEST_ENCRYPTION_KEY = crypto.createHash('sha256').update('mehta-test-encryption-key').digest('base64');

/**
 * Completes TOTP for a logged-in session the way a person would: enrol on the
 * first login, then verify with the authenticator code on later logins. The
 * shared test clock moves one 30 s step per verification so codes are never
 * replayed.
 */
export function mfaHelper() {
  const clock = new FixedClock(Date.now());
  const totp = new Totp();
  const secrets = new Map();
  return {
    clock,
    secrets,
    code(email) { return totp.codeAt(secrets.get(email), totp.stepAt(clock.now())); },
    async complete(request, auth, email, loginData) {
      if (!loginData?.mfa?.required) return;
      clock.advance(31_000);
      if (!loginData.mfa.enrolled && !secrets.has(email)) {
        const started = await request('/api/v1/auth/mfa/enroll', { method: 'POST', auth, body: {} });
        if (started.response.status !== 200) throw new Error(`MFA enrol failed: ${JSON.stringify(started.data)}`);
        secrets.set(email, started.data.data.secret);
        const confirmed = await request('/api/v1/auth/mfa/confirm', { method: 'POST', auth, body: { code: this.code(email) } });
        if (confirmed.response.status !== 200) throw new Error(`MFA confirm failed: ${JSON.stringify(confirmed.data)}`);
        return confirmed.data.data.recoveryCodes;
      }
      const verified = await request('/api/v1/auth/verify-otp', { method: 'POST', auth, body: { code: this.code(email) } });
      if (verified.response.status !== 200) throw new Error(`MFA verify failed: ${JSON.stringify(verified.data)}`);
    }
  };
}
