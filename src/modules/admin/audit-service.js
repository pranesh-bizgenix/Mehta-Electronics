import { s } from '../../core/schema.js';

/** Searchable audit trail (S-25): user, date range, module, record, action. */
export class AuditQueryRepository {
  constructor(db) { this.db = db; }
  async search({ userId, from, to, module, recordId, action, page, pageSize }) {
    const where = [
      '(?::integer IS NULL OR a.user_id=?)', '(?::timestamptz IS NULL OR a.created_at>=?::timestamptz)', '(?::timestamptz IS NULL OR a.created_at<?::timestamptz)',
      '(?::text IS NULL OR a.entity=?)', '(?::text IS NULL OR a.record_id=?)', '(?::text IS NULL OR a.action=?)'
    ].join(' AND ');
    const args = [userId, userId, from, from, to, to, module, module, recordId, recordId, action, action].map((v) => v ?? null);
    const total = Number((await this.db.prepare(`SELECT count(*) AS n FROM audit_logs a WHERE ${where}`).get(...args)).n);
    const rows = await this.db.prepare(`SELECT a.id,a.user_id,u.name AS user_name,a.entity,a.record_id,a.action,a.old_value,a.new_value,a.reason,a.ip_address,a.created_at
      FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    return { total, rows };
  }
  async modules() { return (await this.db.prepare('SELECT DISTINCT entity FROM audit_logs ORDER BY entity').all()).map((r) => r.entity); }
}

const parse = (v) => { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };

export class AuditService {
  constructor({ repository, access }) { this.repository = repository; this.access = access; }
  async search(user, query) {
    this.access.require(user, 'audit.read');
    const to = query.to ? new Date(new Date(`${query.to}T00:00:00Z`).getTime() + 86400000).toISOString() : null;
    const { total, rows } = await this.repository.search({ ...query, from: query.from ? `${query.from}T00:00:00Z` : null, to });
    return {
      data: rows.map((r) => ({ id: r.id, userId: r.user_id, user: r.user_name, module: r.entity, recordId: r.record_id, action: r.action, before: parse(r.old_value), after: parse(r.new_value), reason: r.reason, ip: r.ip_address, at: r.created_at })),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
      modules: await this.repository.modules()
    };
  }
}

export class AuditController {
  constructor({ auditQuery }) { this.audit = auditQuery; }
  routes() {
    return [{
      method: 'GET', path: '/api/v1/audit-logs', permission: 'audit.read',
      query: s.object({
        page: s.int({ min: 1, max: 100000 }).default(1), pageSize: s.int({ min: 1, max: 100 }).default(50), userId: s.id().optional(),
        from: s.date().optional(), to: s.date().optional(), module: s.string({ max: 60 }).optional(), recordId: s.string({ max: 80 }).optional(), action: s.string({ max: 60 }).optional()
      }),
      handler: async ({ user, query }) => ({ body: await this.audit.search(user, query) })
    }];
  }
}
