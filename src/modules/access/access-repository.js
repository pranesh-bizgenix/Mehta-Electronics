/**
 * @interface AccessRepository
 * Persistence for roles, the permission catalogue and role grants.
 */
export class AccessRepository {
  constructor(db) { this.db = db; }

  async version() {
    const row = await this.db.prepare('SELECT COALESCE(max(id),0) AS v FROM access_matrix_events').get();
    return Number(row.v);
  }
  async roles() {
    return this.db.prepare('SELECT key,name,description,requires_mfa,all_permissions,is_system,status,updated_at FROM roles ORDER BY is_system DESC,key').all();
  }
  async role(key) {
    return this.db.prepare('SELECT key,name,description,requires_mfa,all_permissions,is_system,status FROM roles WHERE key=?').get(key);
  }
  async permissions() {
    return this.db.prepare('SELECT key,resource,action,description,owner_only FROM permissions ORDER BY resource,action,key').all();
  }
  async permission(key) {
    return this.db.prepare('SELECT key,resource,action,description,owner_only FROM permissions WHERE key=?').get(key);
  }
  async grants() {
    return this.db.prepare('SELECT role_key,permission_key FROM role_permissions ORDER BY role_key,permission_key').all();
  }
  async hasGrant(roleKey, permissionKey) {
    return Boolean(await this.db.prepare('SELECT 1 AS ok FROM role_permissions WHERE role_key=? AND permission_key=?').get(roleKey, permissionKey));
  }
  async grant(roleKey, permissionKey, actorId) {
    await this.db.prepare('INSERT INTO role_permissions(role_key,permission_key,granted_by) VALUES(?,?,?) ON CONFLICT DO NOTHING').all(roleKey, permissionKey, actorId);
  }
  async revoke(roleKey, permissionKey) {
    await this.db.prepare('DELETE FROM role_permissions WHERE role_key=? AND permission_key=?').run(roleKey, permissionKey);
  }
  async createRole({ key, name, description, requiresMfa }, actorId) {
    await this.db.prepare('INSERT INTO roles(key,name,description,requires_mfa,created_by,updated_by) VALUES(?,?,?,?,?,?)').all(key, name, description ?? null, requiresMfa, actorId, actorId);
  }
  async updateRole(key, { name, description, requiresMfa, status }, actorId) {
    await this.db.prepare('UPDATE roles SET name=?,description=?,requires_mfa=?,status=?,updated_by=?,updated_at=now() WHERE key=?').run(name, description ?? null, requiresMfa, status, actorId, key);
  }
  async event({ roleKey, permissionKey = null, change, oldValue = null, newValue = null, reason, actorId }) {
    await this.db.prepare('INSERT INTO access_matrix_events(role_key,permission_key,change,old_value,new_value,reason,changed_by) VALUES(?,?,?,?::text::jsonb,?::text::jsonb,?,?)')
      .run(roleKey, permissionKey, change, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), reason, actorId);
  }
  async history(limit = 200) {
    return this.db.prepare('SELECT e.id,e.role_key,e.permission_key,e.change,e.old_value,e.new_value,e.reason,e.changed_at,u.name AS changed_by_name FROM access_matrix_events e LEFT JOIN users u ON u.id=e.changed_by ORDER BY e.id DESC LIMIT ?').all(limit);
  }
  async activeUserCount(roleKey) {
    return Number((await this.db.prepare("SELECT count(*) AS n FROM users WHERE role=? AND status='ACTIVE'").get(roleKey)).n);
  }
}
