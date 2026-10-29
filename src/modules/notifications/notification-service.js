// Internal notifications to employees (reminders, escalations, assignments).
// Delivery uses pluggable channels (strategy). Only the in-app channel is on by
// default; email/WhatsApp channels are added as classes once their providers
// and automation switches are approved.

/** @interface NotificationChannel { name: string; deliver(notification): Promise<{delivered: boolean, error?: string}> } */
export class InAppChannel {
  get name() { return 'IN_APP'; }
  async deliver() { return { delivered: true }; }
}

export class NotificationRepository {
  constructor(db) { this.db = db; }
  async insert({ userId, channel, payload, idempotencyKey, reminderId = null, state = 'PENDING' }) {
    if (idempotencyKey) {
      const existing = await this.db.prepare('SELECT id FROM notifications WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
      if (existing) return { id: existing.id, duplicate: true };
    }
    const row = await this.db.prepare('INSERT INTO notifications(user_id,reminder_id,channel,delivery_state,payload,idempotency_key,scheduled_at) VALUES(?,?,?,?,?::text::jsonb,?,now()) RETURNING id')
      .get(userId, reminderId, channel, state, JSON.stringify(payload), idempotencyKey ?? null);
    return { id: row.id, duplicate: false };
  }
  async markDelivery(id, delivered, error) {
    await this.db.prepare("UPDATE notifications SET delivery_state=?,delivered_at=CASE WHEN ? THEN now() END,attempt_count=attempt_count+1,last_error=?::text::jsonb WHERE id=?")
      .run(delivered ? 'DELIVERED' : 'FAILED', delivered, error ? JSON.stringify({ message: error }) : null, id);
  }
  async forUser(userId, { unreadOnly, limit }) {
    return this.db.prepare(`SELECT id,channel,delivery_state,payload,created_at,delivered_at FROM notifications
      WHERE user_id=? AND channel='IN_APP' AND (?::boolean IS NOT TRUE OR delivery_state<>'READ') ORDER BY created_at DESC LIMIT ?`).all(userId, unreadOnly, limit);
  }
  async markRead(userId, id) {
    return this.db.prepare("UPDATE notifications SET delivery_state='READ' WHERE id=? AND user_id=? RETURNING id").get(id, userId);
  }
}

export class NotificationService {
  constructor({ repository, channels = [new InAppChannel()] }) {
    this.repository = repository;
    this.channels = channels;
  }
  /** Sends to every enabled channel; idempotencyKey prevents duplicate reminders on job retries. */
  async notify(userId, { type, title, message, entityType = null, entityId = null }, idempotencyKey) {
    if (!userId) return [];
    const results = [];
    for (const channel of this.channels) {
      const key = idempotencyKey ? `${channel.name}:${idempotencyKey}` : null;
      const saved = await this.repository.insert({ userId, channel: channel.name, payload: { type, title, message, entityType, entityId }, idempotencyKey: key });
      if (saved.duplicate) { results.push({ channel: channel.name, duplicate: true }); continue; }
      const outcome = await channel.deliver({ userId, type, title, message, entityType, entityId }).catch((e) => ({ delivered: false, error: String(e?.message || e) }));
      await this.repository.markDelivery(saved.id, outcome.delivered, outcome.error);
      results.push({ channel: channel.name, ...outcome });
    }
    return results;
  }
  async mine(user, { unreadOnly = false, limit = 50 } = {}) {
    return (await this.repository.forUser(user.id, { unreadOnly, limit })).map((n) => ({ id: n.id, read: n.delivery_state === 'READ', ...n.payload, createdAt: n.created_at }));
  }
  async markRead(user, id) { return { read: Boolean(await this.repository.markRead(user.id, id)) }; }
}
