/** @interface OutboundRepository — email_drafts, approvals and send attempts (0018/0020 tables). */
export class OutboundRepository {
  constructor(db) { this.db = db; }

  async insertDraft(d) {
    return this.db.prepare(`INSERT INTO email_drafts(customer_id,enquiry_id,quotation_id,sales_order_id,recipient_addresses,cc_addresses,subject,body_reference,body_text,content_fingerprint,workflow_key,message_category,status,created_by,updated_by)
      VALUES(?,?,?,?,?::text::jsonb,?::text::jsonb,?,'inline',?,?,?,?,'DRAFT',?,?) RETURNING *`)
      .get(d.customerId, d.enquiryId ?? null, d.quotationId ?? null, d.salesOrderId ?? null, JSON.stringify(d.recipients), JSON.stringify(d.cc ?? []), d.subject, d.body, d.fingerprint, d.workflowKey ?? null, d.category, d.actorId ?? null, d.actorId ?? null);
  }
  async lock(id) { return this.db.prepare('SELECT * FROM email_drafts WHERE id=? FOR UPDATE').get(id); }
  async get(id) { return this.db.prepare('SELECT * FROM email_drafts WHERE id=?').get(id); }
  async updateContent(id, d, actorId) {
    return this.db.prepare(`UPDATE email_drafts SET recipient_addresses=?::text::jsonb,cc_addresses=?::text::jsonb,subject=?,body_text=?,content_fingerprint=?,approval_request_id=NULL,status='DRAFT',context_state='UNVERIFIED',updated_by=?,updated_at=now() WHERE id=? RETURNING *`)
      .get(JSON.stringify(d.recipients), JSON.stringify(d.cc ?? []), d.subject, d.body, d.fingerprint, actorId, id);
  }
  async clearApproval(id, actorId) {
    await this.db.prepare("UPDATE email_drafts SET approval_request_id=NULL,status='DRAFT',updated_by=?,updated_at=now() WHERE id=?").run(actorId, id);
  }
  async setStatus(id, status, extra = {}) {
    await this.db.prepare('UPDATE email_drafts SET status=?,context_state=COALESCE(?,context_state),gate_result=COALESCE(?::text::jsonb,gate_result),updated_at=now() WHERE id=?')
      .run(status, extra.contextState ?? null, extra.gateResult ? JSON.stringify(extra.gateResult) : null, id);
  }
  async createApproval({ actorId, fingerprint, snapshot, version }) {
    const request = await this.db.prepare("INSERT INTO approval_requests(request_type,requested_by,payload_fingerprint,payload_snapshot,record_version,status) VALUES('OUTBOUND_DRAFT',?,?,?::text::jsonb,?,'APPROVED') RETURNING id").get(actorId, fingerprint, JSON.stringify(snapshot), version ?? null);
    const decision = await this.db.prepare("INSERT INTO approval_decisions(approval_request_id,decision,decided_by,reason,payload_fingerprint) VALUES(?,'APPROVED',?,?,?) RETURNING id").get(request.id, actorId, snapshot.reason, fingerprint);
    return { requestId: request.id, decisionId: decision.id };
  }
  async attachApproval(id, requestId, actorId) {
    await this.db.prepare("UPDATE email_drafts SET approval_request_id=?,status='APPROVED',updated_by=?,updated_at=now() WHERE id=?").run(requestId, actorId, id);
  }
  async approvalFor(draft) {
    if (!draft.approval_request_id) return null;
    return this.db.prepare(`SELECT d.id AS decision_id,d.payload_fingerprint,u.name AS approved_by,d.decided_by FROM approval_decisions d JOIN users u ON u.id=d.decided_by
      WHERE d.approval_request_id=? AND d.decision='APPROVED' ORDER BY d.decided_at DESC LIMIT 1`).get(draft.approval_request_id);
  }
  async attemptByKey(draftId, key) { return this.db.prepare('SELECT * FROM email_send_attempts WHERE email_draft_id=? AND idempotency_key=?').get(draftId, key); }
  async nextAttemptNumber(draftId) { return Number((await this.db.prepare('SELECT COALESCE(max(attempt_number),0)+1 AS n FROM email_send_attempts WHERE email_draft_id=?').get(draftId)).n); }
  async insertAttempt({ draftId, decisionId, attempt, key, status, providerMessageId, error }) {
    return this.db.prepare('INSERT INTO email_send_attempts(email_draft_id,approval_decision_id,attempt_number,idempotency_key,status,provider_message_id,error_detail,completed_at) VALUES(?,?,?,?,?,?,?::text::jsonb,now()) RETURNING *')
      .get(draftId, decisionId, attempt, key, status, providerMessageId ?? null, error ? JSON.stringify({ message: error }) : null);
  }
  async customer(id) {
    return id ? this.db.prepare('SELECT id,name,status FROM customers WHERE id=?').get(id) : null;
  }
  async checklistTicked(customerId, category) {
    return Boolean((await this.db.prepare('SELECT ticked FROM customer_message_checklist WHERE customer_id=? AND category=?').get(customerId, category))?.ticked);
  }
  async setChecklist(customerId, category, ticked, actorId, reason) {
    const old = await this.db.prepare('SELECT ticked FROM customer_message_checklist WHERE customer_id=? AND category=?').get(customerId, category);
    await this.db.prepare(`INSERT INTO customer_message_checklist(customer_id,category,ticked,updated_by,reason) VALUES(?,?,?,?,?)
      ON CONFLICT(customer_id,category) DO UPDATE SET ticked=EXCLUDED.ticked,updated_by=EXCLUDED.updated_by,reason=EXCLUDED.reason,updated_at=now()`).all(customerId, category, ticked, actorId, reason);
    return old?.ticked ?? false;
  }
  async checklist(customerId) {
    return this.db.prepare('SELECT category,ticked,updated_at,reason FROM customer_message_checklist WHERE customer_id=? ORDER BY category').all(customerId);
  }
  async manualResponseReason(customerId, itemIds = []) {
    const c = customerId ? await this.db.prepare("SELECT reason FROM manual_response_exceptions WHERE customer_id=? AND status='ACTIVE'").get(customerId) : null;
    if (c) return `customer (${c.reason})`;
    for (const itemId of itemIds) {
      const i = await this.db.prepare("SELECT m.reason,it.part_code FROM manual_response_exceptions m JOIN items it ON it.id=m.item_id WHERE m.item_id=? AND m.status='ACTIVE'").get(itemId);
      if (i) return `item ${i.part_code} (${i.reason})`;
    }
    return null;
  }
  async list({ status, customerId, page, pageSize }) {
    const where = '(?::text IS NULL OR d.status=?) AND (?::integer IS NULL OR d.customer_id=?)';
    const args = [status ?? null, status ?? null, customerId ?? null, customerId ?? null];
    const total = Number((await this.db.prepare(`SELECT count(*) AS n FROM email_drafts d WHERE ${where}`).get(...args)).n);
    const rows = await this.db.prepare(`SELECT d.*,c.name AS customer_name FROM email_drafts d LEFT JOIN customers c ON c.id=d.customer_id WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    return { total, rows };
  }
}

/** Default customer email directory: active contact emails. Slice 2 replaces it with registered emails. */
export class ContactEmailDirectory {
  constructor(db) { this.db = db; }
  async registeredEmails(customerId) {
    const rows = await this.db.prepare("SELECT DISTINCT lower(email::text) AS email FROM customer_contacts WHERE customer_id=? AND email IS NOT NULL AND NOT is_deleted AND status='ACTIVE'").all(customerId);
    return rows.map((r) => r.email);
  }
}
