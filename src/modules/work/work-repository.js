const OPEN = "('OPEN','IN_PROGRESS','WAITING')";

/** @interface WorkRepository — work_items, their events and user lookups. */
export class WorkRepository {
  constructor(db) { this.db = db; }

  async findByEntity(entityType, entityId) {
    return this.db.prepare('SELECT * FROM work_items WHERE entity_type=? AND entity_id=?').get(entityType, String(entityId));
  }
  async get(id) { return this.db.prepare('SELECT * FROM work_items WHERE id=? AND NOT is_deleted').get(id); }
  async lockById(id) { return this.db.prepare('SELECT * FROM work_items WHERE id=? AND NOT is_deleted FOR UPDATE').get(id); }

  async insert(item) {
    return this.db.prepare(`INSERT INTO work_items(entity_type,entity_id,title,department,owner_user_id,backup_user_id,assignment_reason,status,started_at,due_at,sla_state,sla_rule_version,sla_timezone,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id) DO NOTHING RETURNING *`)
      .get(item.entityType, String(item.entityId), item.title, item.department ?? null, item.ownerUserId ?? null, item.backupUserId ?? null, item.assignmentReason ?? null,
        item.status ?? 'OPEN', item.startedAt, item.dueAt ?? null, item.slaState, item.slaRuleVersion ?? null, item.slaTimezone ?? null, item.actorId ?? null, item.actorId ?? null);
  }
  async update(id, fields, actorId) {
    const allowed = ['title', 'department', 'owner_user_id', 'backup_user_id', 'assignment_reason', 'status', 'started_at', 'due_at', 'sla_state', 'sla_rule_version', 'sla_timezone', 'escalation_level', 'escalated_to_user_id', 'last_escalated_at', 'escalation_blocked_reason', 'closed_at'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.get(id);
    const sets = keys.map((k) => `${k}=?`).join(',');
    return this.db.prepare(`UPDATE work_items SET ${sets},updated_by=?,updated_at=now() WHERE id=? RETURNING *`).get(...keys.map((k) => fields[k]), actorId ?? null, id);
  }
  async event({ workItemId, event, fromUserId = null, toUserId = null, detail = {}, reason = null, actorId = null }) {
    await this.db.prepare('INSERT INTO work_item_events(work_item_id,event,from_user_id,to_user_id,detail,reason,actor_user_id) VALUES(?,?,?,?,?::text::jsonb,?,?)')
      .run(workItemId, event, fromUserId, toUserId, JSON.stringify(detail), reason, actorId);
  }
  async events(workItemId) {
    return this.db.prepare(`SELECT e.id,e.event,e.detail,e.reason,e.created_at,f.name AS from_name,t.name AS to_name,a.name AS actor_name FROM work_item_events e
      LEFT JOIN users f ON f.id=e.from_user_id LEFT JOIN users t ON t.id=e.to_user_id LEFT JOIN users a ON a.id=e.actor_user_id WHERE e.work_item_id=? ORDER BY e.id`).all(workItemId);
  }
  async openOwnedBy(userId) {
    return this.db.prepare(`SELECT * FROM work_items WHERE owner_user_id=? AND status IN ${OPEN} AND NOT is_deleted ORDER BY due_at NULLS LAST FOR UPDATE`).all(userId);
  }
  async overdue(now) {
    return this.db.prepare(`SELECT * FROM work_items WHERE status IN ${OPEN} AND NOT is_deleted AND due_at IS NOT NULL AND due_at < ? AND sla_state IN ('RUNNING','BREACHED') ORDER BY due_at LIMIT 500`).all(now.toISOString());
  }
  async myWork(userId, { status, page, pageSize }) {
    const statusFilter = status ? 'AND w.status=?' : `AND w.status IN ${OPEN}`;
    const args = [userId, userId, ...(status ? [status] : [])];
    const where = `WHERE (w.owner_user_id=? OR w.escalated_to_user_id=?) AND NOT w.is_deleted ${statusFilter}`;
    const total = Number((await this.db.prepare(`SELECT count(*) AS n FROM work_items w ${where}`).get(...args)).n);
    const rows = await this.db.prepare(`SELECT w.*,o.name AS owner_name,b.name AS backup_name FROM work_items w LEFT JOIN users o ON o.id=w.owner_user_id LEFT JOIN users b ON b.id=w.backup_user_id
      ${where} ORDER BY w.due_at NULLS LAST,w.created_at LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    return { total, rows };
  }
  async user(id) { return id ? this.db.prepare('SELECT id,name,role,status,backup_user_id,manager_user_id,on_leave,department FROM users WHERE id=?').get(id) : null; }
}
