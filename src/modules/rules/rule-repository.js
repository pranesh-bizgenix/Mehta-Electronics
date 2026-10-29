/** @interface RuleRepository — append-only versioned rule values. */
export class RuleRepository {
  constructor(db) { this.db = db; }
  async current(key) {
    return this.db.prepare(`SELECT v.rule_key,v.version,v.value,v.is_cleared,v.reason,v.created_at,u.name AS created_by_name
      FROM business_rule_values v LEFT JOIN users u ON u.id=v.created_by WHERE v.rule_key=? ORDER BY v.version DESC LIMIT 1`).get(key);
  }
  async currentAll() {
    return this.db.prepare(`SELECT DISTINCT ON (v.rule_key) v.rule_key,v.version,v.value,v.is_cleared,v.reason,v.created_at,u.name AS created_by_name
      FROM business_rule_values v LEFT JOIN users u ON u.id=v.created_by ORDER BY v.rule_key,v.version DESC`).all();
  }
  async insert({ key, version, value, cleared, reason, actorId }) {
    await this.db.prepare('INSERT INTO business_rule_values(rule_key,version,value,is_cleared,reason,created_by) VALUES(?,?,?::text::jsonb,?,?,?)')
      .run(key, version, cleared ? null : JSON.stringify(value), cleared, reason, actorId);
  }
  async history(key, limit = 50) {
    return this.db.prepare(`SELECT v.version,v.value,v.is_cleared,v.reason,v.created_at,u.name AS created_by_name
      FROM business_rule_values v LEFT JOIN users u ON u.id=v.created_by WHERE v.rule_key=? ORDER BY v.version DESC LIMIT ?`).all(key, limit);
  }
  async lock(key) {
    await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`rule:${key}`);
  }
}
