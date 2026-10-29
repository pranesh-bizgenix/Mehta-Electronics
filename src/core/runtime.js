// Small runtime primitives shared by the layered modules: clock, encryption,
// hashing, and the transaction/audit helpers repositories use.

import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { unavailable } from './errors.js';

/** @interface Clock — injectable time source so SLA/escalation logic is testable. */
export class SystemClock { now() { return new Date(); } }
export class FixedClock {
  constructor(at) { this.at = new Date(at); }
  now() { return new Date(this.at); }
  advance(ms) { this.at = new Date(this.at.getTime() + ms); }
  set(at) { this.at = new Date(at); }
}

export const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

/** Stable JSON (sorted keys) for fingerprints. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const fingerprint = (value) => sha256(canonicalJson(value));

/**
 * AES-256-GCM secret box for small secrets (TOTP seeds, provider tokens).
 * The key comes only from the environment (APP_ENCRYPTION_KEY, base64 of 32 bytes).
 */
export class SecretBox {
  constructor(keyBase64) {
    const key = keyBase64 ? Buffer.from(String(keyBase64), 'base64') : null;
    this.key = key && key.length === 32 ? key : null;
  }
  get configured() { return Boolean(this.key); }
  #requireKey() { if (!this.key) throw unavailable('APP_ENCRYPTION_KEY is not configured on the server. Set a base64-encoded 32-byte key.', 'ENCRYPTION_KEY_MISSING'); }
  seal(plaintext) {
    this.#requireKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }
  open(sealed) {
    this.#requireKey();
    const [version, iv, tag, data] = String(sealed).split('.');
    if (version !== 'v1') throw new Error('Unsupported secret format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}

/**
 * Runs fn inside one database transaction on the request's reserved connection.
 * Nested calls join the outer transaction (savepoint-free; the outer owner commits).
 */
const transactionScope = new AsyncLocalStorage();

export class TransactionRunner {
  constructor(db) { this.db = db; }
  get active() { return transactionScope.getStore() === this.db; }
  async run(actor, reason, fn) {
    if (this.active) return fn();
    return this.db.withConnection(() => transactionScope.run(this.db, async () => {
      await this.db.exec('BEGIN');
      try {
        await this.db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(actor?.id ?? ''), String(reason ?? ''));
        const result = await fn();
        await this.db.exec('COMMIT');
        return result;
      } catch (error) {
        await this.db.exec('ROLLBACK');
        throw error;
      }
    }));
  }
}

/** Writes to the existing append-only audit_logs table (same transaction as the change). */
export class AuditRepository {
  constructor(db) { this.db = db; }
  async record({ actorId, entity, recordId, action, oldValue = null, newValue = null, reason = null, ip = null }) {
    await this.db.prepare('INSERT INTO audit_logs(user_id,entity,record_id,action,old_value,new_value,reason,ip_address) VALUES(?,?,?,?,?,?,?,?)')
      .run(actorId ?? null, entity, String(recordId), action, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), reason, ip);
  }
}
