/** @interface TaskRepository */
export class TaskRepository {
  constructor(db) { this.db = db; }
  async insert(t) {
    return this.db.prepare(`INSERT INTO tasks(title,description,status,source,department,owner_user_id,backup_user_id,due_at,parent_task_id,entity_type,entity_id,next_reminder_at,created_by,updated_by)
      VALUES(?,?,'OPEN',?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .get(t.title, t.description ?? null, t.source ?? 'MANUAL', t.department ?? null, t.ownerUserId, t.backupUserId ?? null, t.dueAt ?? null, t.parentTaskId ?? null, t.entityType ?? null, t.entityId ?? null, t.nextReminderAt ?? null, t.actorId, t.actorId);
  }
  async lock(id) { return this.db.prepare('SELECT * FROM tasks WHERE id=? AND NOT is_deleted FOR UPDATE').get(id); }
  async get(id) {
    return this.db.prepare(`SELECT t.*,o.name AS owner_name,b.name AS backup_name,c.name AS created_by_name FROM tasks t JOIN users o ON o.id=t.owner_user_id
      LEFT JOIN users b ON b.id=t.backup_user_id JOIN users c ON c.id=t.created_by WHERE t.id=? AND NOT t.is_deleted`).get(id);
  }
  async update(id, fields, actorId) {
    const allowed = ['title', 'description', 'status', 'due_at', 'owner_user_id', 'backup_user_id', 'forwarded_to_task_id', 'next_reminder_at', 'reminder_count', 'completed_at', 'is_deleted', 'deleted_reason', 'department'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    return this.db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k}=?`).join(',')},version=version+1,updated_by=COALESCE(?,updated_by),updated_at=now() WHERE id=? RETURNING *`).get(...keys.map((k) => fields[k]), actorId, id);
  }
  async event({ taskId, event, oldValue = null, newValue = null, reason = null, actorId = null }) {
    await this.db.prepare('INSERT INTO task_events(task_id,event,old_value,new_value,reason,actor_user_id) VALUES(?,?,?::text::jsonb,?::text::jsonb,?,?)')
      .run(taskId, event, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), reason, actorId);
  }
  async events(taskId) {
    return this.db.prepare('SELECT e.event,e.old_value,e.new_value,e.reason,e.created_at,u.name AS actor FROM task_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.task_id=? ORDER BY e.id').all(taskId);
  }
  async board({ userId, all, ownerId, search }) {
    const where = ['NOT t.is_deleted'];
    const args = [];
    if (!all) { where.push('(t.owner_user_id=? OR t.created_by=? OR t.backup_user_id=?)'); args.push(userId, userId, userId); }
    if (ownerId) { where.push('t.owner_user_id=?'); args.push(ownerId); }
    if (search) { where.push('(t.title ILIKE ? OR t.description ILIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
    where.push("(t.status<>'DONE' OR t.completed_at > now() - INTERVAL '14 days')");
    return this.db.prepare(`SELECT t.*,o.name AS owner_name,b.name AS backup_name FROM tasks t JOIN users o ON o.id=t.owner_user_id LEFT JOIN users b ON b.id=t.backup_user_id
      WHERE ${where.join(' AND ')} ORDER BY t.due_at NULLS LAST,t.created_at DESC LIMIT 500`).all(...args);
  }
  async dueReminders(now) {
    return this.db.prepare("SELECT * FROM tasks WHERE status IN ('OPEN','IN_PROGRESS') AND NOT is_deleted AND next_reminder_at IS NOT NULL AND next_reminder_at<=? ORDER BY next_reminder_at LIMIT 500").all(now.toISOString());
  }
  async withoutReminder() {
    return this.db.prepare("SELECT id FROM tasks WHERE status IN ('OPEN','IN_PROGRESS') AND NOT is_deleted AND next_reminder_at IS NULL LIMIT 500").all();
  }
  async openOwnedBy(userId) {
    return this.db.prepare("SELECT * FROM tasks WHERE owner_user_id=? AND status IN ('OPEN','IN_PROGRESS') AND NOT is_deleted FOR UPDATE").all(userId);
  }
  async user(id) { return id ? this.db.prepare('SELECT id,name,status,backup_user_id FROM users WHERE id=?').get(id) : null; }
}
