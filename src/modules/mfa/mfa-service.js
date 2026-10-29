import crypto from 'node:crypto';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { sha256 } from '../../core/runtime.js';

const RECOVERY_CODE_COUNT = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const normalizeRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * TOTP enrolment and verification. A session becomes MFA-verified only after a
 * valid code (or an unused recovery code). Roles flagged requires_mfa cannot
 * use the rest of the API until their session is verified.
 */
export class MfaService {
  constructor({ repository, totp, secretBox, clock, transactions, audit, access, issuer = 'Mehta ControlDesk' }) {
    Object.assign(this, { repository, totp, secretBox, clock, transactions, audit, access, issuer });
  }

  async status(user) {
    const row = await this.repository.get(user.id);
    return {
      required: this.access.requiresMfa(user.role),
      enrolled: Boolean(row?.enabled_at),
      sessionVerified: Boolean(user.mfa_verified_at),
      recoveryCodesRemaining: row?.enabled_at ? await this.repository.remainingRecoveryCodes(user.id) : 0
    };
  }

  /** Starts (or restarts, before confirmation) TOTP enrolment. */
  async beginEnrolment(user) {
    const row = await this.repository.get(user.id);
    if (row?.enabled_at) throw conflict('Two-factor authentication is already enabled. Ask the owner to reset it before enrolling again.', 'MFA_ALREADY_ENABLED');
    const secret = this.totp.generateSecret();
    await this.repository.savePending(user.id, this.secretBox.seal(secret));
    await this.audit.record({ actorId: user.id, entity: 'MFA', recordId: user.id, action: 'ENROLMENT_STARTED' });
    return { secret, otpauthUri: this.totp.otpauthUri({ secret, account: user.email, issuer: this.issuer }) };
  }

  /** Confirms enrolment with a first code; returns one-time recovery codes. */
  async confirmEnrolment(user, code) {
    return this.transactions.run(user, 'MFA enrolment confirmed', async () => {
      const row = await this.repository.get(user.id);
      if (!row || row.secret_ciphertext === 'reset') throw conflict('Start enrolment first.', 'MFA_NOT_STARTED');
      if (row.enabled_at) throw conflict('Two-factor authentication is already enabled.', 'MFA_ALREADY_ENABLED');
      const step = this.totp.verify(this.secretBox.open(row.secret_ciphertext), code, this.clock.now());
      if (step === null) throw new AppError(422, 'MFA_CODE_INVALID', 'The code is not valid. Check the authenticator app time and try again.');
      await this.repository.enable(user.id, step);
      const codes = this.#newRecoveryCodes();
      await this.repository.replaceRecoveryCodes(user.id, codes.map((c) => sha256(normalizeRecovery(c))));
      await this.repository.markSessionVerified(user.session_id);
      await this.audit.record({ actorId: user.id, entity: 'MFA', recordId: user.id, action: 'ENABLED' });
      return { recoveryCodes: codes };
    });
  }

  /** Verifies the current session with a TOTP code or a recovery code. */
  async verifySession(user, { code, recoveryCode }) {
    const row = await this.repository.get(user.id);
    if (!row?.enabled_at) throw conflict('Two-factor authentication is not enrolled for this account.', 'MFA_NOT_ENROLLED');
    if (row.locked_until && new Date(row.locked_until) > this.clock.now()) throw new AppError(429, 'MFA_LOCKED', 'Too many invalid codes. Try again later.');
    let ok = false; let step = null; let usedRecovery = false;
    if (code) {
      step = this.totp.verify(this.secretBox.open(row.secret_ciphertext), code, this.clock.now(), row.last_used_step);
      ok = step !== null;
    } else if (recoveryCode) {
      ok = await this.repository.consumeRecoveryCode(user.id, sha256(normalizeRecovery(recoveryCode)));
      usedRecovery = ok;
    }
    if (!ok) {
      await this.repository.recordFailure(user.id, { maxAttempts: MAX_FAILED, lockMinutes: LOCK_MINUTES });
      await this.audit.record({ actorId: user.id, entity: 'MFA', recordId: user.id, action: 'VERIFY_FAILED' });
      throw new AppError(422, 'MFA_CODE_INVALID', 'The code is not valid.');
    }
    await this.repository.recordSuccess(user.id, step);
    await this.repository.markSessionVerified(user.session_id);
    await this.audit.record({ actorId: user.id, entity: 'MFA', recordId: user.id, action: usedRecovery ? 'VERIFIED_WITH_RECOVERY_CODE' : 'VERIFIED' });
    return { verified: true, recoveryCodesRemaining: await this.repository.remainingRecoveryCodes(user.id) };
  }

  async regenerateRecoveryCodes(user) {
    if (!user.mfa_verified_at) throw forbidden('Verify two-factor authentication first.', 'MFA_REQUIRED');
    return this.transactions.run(user, 'Recovery codes regenerated', async () => {
      const codes = this.#newRecoveryCodes();
      await this.repository.replaceRecoveryCodes(user.id, codes.map((c) => sha256(normalizeRecovery(c))));
      await this.audit.record({ actorId: user.id, entity: 'MFA', recordId: user.id, action: 'RECOVERY_CODES_REGENERATED' });
      return { recoveryCodes: codes };
    });
  }

  /** Owner resets another user's MFA (lost device). */
  async resetFor(actor, userId, reason) {
    this.access.require(actor, 'users.update');
    if (actor.id === userId) throw conflict('Use a recovery code to regain access to your own account.', 'SELF_RESET');
    return this.transactions.run(actor, reason, async () => {
      if (!await this.repository.user(userId)) throw notFound('User not found.');
      await this.repository.reset(userId);
      await this.audit.record({ actorId: actor.id, entity: 'MFA', recordId: userId, action: 'RESET', reason });
      return { reset: true };
    });
  }

  #newRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 10);
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
  }
}
