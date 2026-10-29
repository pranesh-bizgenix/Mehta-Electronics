import { conflict, forbidden, notFound, validationFailed } from '../../core/errors.js';
import { fingerprint } from '../../core/runtime.js';

/** Exception types that stop a process until reviewed. Slices add more with registerType(). */
export const BASE_EXCEPTION_TYPES = {
  UNKNOWN_CODE: 'Unknown part code',
  LOW_MARGIN: 'Margin below floor',
  CREDIT_EXCEEDED: 'Credit limit exceeded',
  FAILED_CHECK: 'Failed verification check',
  DO_NOT_QUOTE: 'Do Not Quote customer',
  BACKDATE: 'Backdated entry'
};

export class ExceptionRepository {
  constructor(db) { this.db = db; }
  async findOpen(type, entityType, entityId, print) {
    return this.db.prepare("SELECT * FROM exception_cases WHERE exception_type=? AND entity_type=? AND entity_id=? AND fingerprint=? AND status='OPEN'").get(type, entityType, String(entityId), print);
  }
  async createApprovalRequest({ type, requestedBy, print, snapshot }) {
    return (await this.db.prepare('INSERT INTO approval_requests(request_type,requested_by,payload_fingerprint,payload_snapshot) VALUES(?,?,?,?::text::jsonb) RETURNING id').get(`EXCEPTION:${type}`, requestedBy, print, JSON.stringify(snapshot))).id;
  }
  async insert(c) {
    return this.db.prepare(`INSERT INTO exception_cases(exception_type,entity_type,entity_id,summary,details,fingerprint,department,raised_by,record_creator_id,approval_request_id,backdate_to)
      VALUES(?,?,?,?,?::text::jsonb,?,?,?,?,?,?) RETURNING *`).get(c.type, c.entityType, String(c.entityId), c.summary, JSON.stringify(c.details), c.fingerprint, c.department, c.raisedBy, c.recordCreatorId, c.approvalRequestId, c.backdateTo);
  }
  async lock(id) { return this.db.prepare('SELECT * FROM exception_cases WHERE id=? FOR UPDATE').get(id); }
  async get(id) {
    return this.db.prepare(`SELECT c.*,r.name AS raised_by_name,d.name AS decided_by_name FROM exception_cases c JOIN users r ON r.id=c.raised_by LEFT JOIN users d ON d.id=c.decided_by WHERE c.id=?`).get(id);
  }
  async decide(id, { status, decidedBy, reason }) {
    return this.db.prepare('UPDATE exception_cases SET status=?,decided_by=?,decided_at=now(),decision_reason=?,updated_at=now() WHERE id=? RETURNING *').get(status, decidedBy, reason, id);
  }
  async recordDecision({ approvalRequestId, decision, decidedBy, reason, print }) {
    await this.db.prepare('INSERT INTO approval_decisions(approval_request_id,decision,decided_by,reason,payload_fingerprint) VALUES(?,?,?,?,?)').run(approvalRequestId, decision, decidedBy, reason, print);
    await this.db.prepare('UPDATE approval_requests SET status=? WHERE id=?').run(decision, approvalRequestId);
  }
  async list({ status, type, department, entityType, entityId, page, pageSize }) {
    const where = ['(?::text IS NULL OR c.status=?)', '(?::text IS NULL OR c.exception_type=?)', '(?::text IS NULL OR c.department=?)', '(?::text IS NULL OR c.entity_type=?)', '(?::text IS NULL OR c.entity_id=?)'].join(' AND ');
    const args = [status, status, type, type, department, department, entityType, entityType, entityId, entityId].map((v) => v ?? null);
    const total = Number((await this.db.prepare(`SELECT count(*) AS n FROM exception_cases c WHERE ${where}`).get(...args)).n);
    const rows = await this.db.prepare(`SELECT c.*,r.name AS raised_by_name,d.name AS decided_by_name FROM exception_cases c JOIN users r ON r.id=c.raised_by LEFT JOIN users d ON d.id=c.decided_by
      WHERE ${where} ORDER BY (c.status='OPEN') DESC,c.created_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    return { total, rows };
  }
  async latestDecision(type, entityType, entityId) {
    return this.db.prepare('SELECT * FROM exception_cases WHERE exception_type=? AND entity_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 1').get(type, entityType, String(entityId));
  }
}

/**
 * Exception queue with maker-checker. Raising is idempotent per open
 * (type, record, details). The person who raised it, and the record's creator,
 * cannot decide it. Approved cases run their registered handler (e.g. apply a
 * backdate) inside the same transaction.
 */
export class ExceptionService {
  constructor({ repository, transactions, audit, access, types = BASE_EXCEPTION_TYPES }) {
    Object.assign(this, { repository, transactions, audit, access });
    this.types = { ...types };
    this.handlers = new Map();
  }

  registerType(type, label) { this.types[type] = label; return this; }
  /** handler: { onApproved(actor, case), onRejected?(actor, case) } */
  registerHandler(type, handler) { this.handlers.set(type, handler); return this; }

  async raise(actor, { type, entityType, entityId, summary, details = {}, department = null, recordCreatorId = null, backdateTo = null }) {
    if (!this.types[type]) throw validationFailed(`Unknown exception type ${type}.`);
    if (type === 'BACKDATE' && !backdateTo) throw validationFailed('A backdating request needs the requested date.');
    const print = fingerprint({ type, entityType, entityId: String(entityId), details, backdateTo });
    return this.transactions.run(actor, summary, async () => {
      const existing = await this.repository.findOpen(type, entityType, entityId, print);
      if (existing) return this.#view(existing);
      const approvalRequestId = await this.repository.createApprovalRequest({ type, requestedBy: actor.id, print, snapshot: { entityType, entityId: String(entityId), summary, details, backdateTo } });
      const row = await this.repository.insert({ type, entityType, entityId, summary, details, fingerprint: print, department, raisedBy: actor.id, recordCreatorId, approvalRequestId, backdateTo });
      await this.audit.record({ actorId: actor.id, entity: 'EXCEPTION', recordId: row.id, action: 'RAISE', newValue: { type, entityType, entityId: String(entityId), summary, backdateTo }, reason: summary });
      return this.#view(row);
    });
  }

  async decide(actor, id, { decision, reason }) {
    this.access.require(actor, 'exceptions.decide');
    return this.transactions.run(actor, reason, async () => {
      const row = await this.repository.lock(id);
      if (!row) throw notFound('Exception not found.');
      if (row.status !== 'OPEN') throw conflict('This exception has already been decided.', 'ALREADY_DECIDED');
      if (row.raised_by === actor.id || row.record_creator_id === actor.id) throw forbidden('Maker-checker: the person who raised this exception or created the record cannot decide it.', 'MAKER_CHECKER');
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await this.repository.recordDecision({ approvalRequestId: row.approval_request_id, decision: status, decidedBy: actor.id, reason, print: row.fingerprint });
      const updated = await this.repository.decide(id, { status, decidedBy: actor.id, reason });
      const handler = this.handlers.get(row.exception_type);
      if (status === 'APPROVED') await handler?.onApproved?.(actor, updated);
      else await handler?.onRejected?.(actor, updated);
      await this.audit.record({ actorId: actor.id, entity: 'EXCEPTION', recordId: id, action: status, oldValue: { status: 'OPEN' }, newValue: { status, backdateTo: row.backdate_to }, reason });
      return this.#view(await this.repository.get(id));
    });
  }

  async list(user, query) {
    this.access.require(user, 'exceptions.read');
    const { total, rows } = await this.repository.list(query);
    return { data: rows.map((r) => this.#view(r)), pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) } };
  }

  async get(user, id) {
    this.access.require(user, 'exceptions.read');
    const row = await this.repository.get(id);
    if (!row) throw notFound('Exception not found.');
    return this.#view(row);
  }

  /** For workflows: is there an approved exception for this exact situation? */
  async isApproved(type, entityType, entityId) {
    return (await this.repository.latestDecision(type, entityType, entityId))?.status === 'APPROVED';
  }

  #view(r) {
    return {
      id: r.id, type: r.exception_type, typeLabel: this.types[r.exception_type] ?? r.exception_type, entityType: r.entity_type, entityId: r.entity_id,
      summary: r.summary, details: r.details, status: r.status, department: r.department, backdateTo: r.backdate_to,
      raisedBy: r.raised_by_name ?? r.raised_by, raisedById: r.raised_by, createdAt: r.created_at, decidedBy: r.decided_by_name ?? r.decided_by ?? null, decidedAt: r.decided_at, decisionReason: r.decision_reason
    };
  }
}
