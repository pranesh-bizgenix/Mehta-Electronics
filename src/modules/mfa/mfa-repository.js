/** @interface MfaRepository */
export class MfaRepository {
  constructor(db) { this.db = db; }
  async get(userId) {
    return this.db.prepare('SELECT user_id,secret_ciphertext,enabled_at,last_used_step,failed_attempts,locked_until FROM user_mfa WHERE user_id=?').get(userId);
  }
  async savePending(userId, ciphertext) {
    await this.db.prepare(`INSERT INTO user_mfa(user_id,secret_ciphertext) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,enabled_at=NULL,last_used_step=NULL,failed_attempts=0,locked_until=NULL,updated_at=now()`).all(userId, ciphertext);
  }
  async enable(userId, step) {
    await this.db.prepare('UPDATE user_mfa SET enabled_at=now(),last_used_step=?,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=?').run(step, userId);
  }
  async recordSuccess(userId, step) {
    await this.db.prepare('UPDATE user_mfa SET last_used_step=COALESCE(?,last_used_step),failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=?').run(step, userId);
  }
  async recordFailure(userId, { maxAttempts, lockMinutes }) {
    await this.db.prepare(`UPDATE user_mfa SET failed_attempts=failed_attempts+1,
      locked_until=CASE WHEN failed_attempts+1>=? THEN now()+(?::integer*INTERVAL '1 minute') ELSE locked_until END,updated_at=now() WHERE user_id=?`).run(maxAttempts, String(lockMinutes), userId);
  }
  async reset(userId) {
    await this.db.prepare("UPDATE user_mfa SET enabled_at=NULL,secret_ciphertext='reset',last_used_step=NULL,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=?").run(userId);
    await this.revokeRecoveryCodes(userId);
    await this.db.prepare('UPDATE sessions SET mfa_verified_at=NULL WHERE user_id=?').run(userId);
  }
  async replaceRecoveryCodes(userId, hashes) {
    await this.revokeRecoveryCodes(userId);
    for (const hash of hashes) await this.db.prepare('INSERT INTO user_recovery_codes(user_id,code_hash) VALUES(?,?)').run(userId, hash);
  }
  async revokeRecoveryCodes(userId) {
    await this.db.prepare('UPDATE user_recovery_codes SET revoked_at=now() WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL').run(userId);
  }
  /** Atomically consumes an unused code; returns true when one matched. */
  async consumeRecoveryCode(userId, hash) {
    const row = await this.db.prepare('UPDATE user_recovery_codes SET used_at=now() WHERE user_id=? AND code_hash=? AND used_at IS NULL AND revoked_at IS NULL RETURNING id').get(userId, hash);
    return Boolean(row);
  }
  async remainingRecoveryCodes(userId) {
    return Number((await this.db.prepare('SELECT count(*) AS n FROM user_recovery_codes WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL').get(userId)).n);
  }
  async markSessionVerified(sessionId) {
    await this.db.prepare('UPDATE sessions SET mfa_verified_at=now() WHERE id=?').run(sessionId);
  }
  async user(userId) {
    return this.db.prepare('SELECT id,email,name,role,status FROM users WHERE id=?').get(userId);
  }
}
