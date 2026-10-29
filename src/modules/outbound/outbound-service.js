import { AppError, conflict, notFound, validationFailed } from '../../core/errors.js';
import { fingerprint } from '../../core/runtime.js';

/** @interface OutboundMailer { name: string; send({to, cc, subject, text}): Promise<{messageId: string}> } */
export class DisabledOutboundMailer {
  get name() { return 'disabled'; }
  async send() { throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'No outbound email provider is configured. Connectors ship OFF until set up in Integrations.'); }
}

/**
 * Draft-first outbound messages. Drafts are created by workflows or people,
 * approved by an employee (approval bound to the exact content fingerprint),
 * and sent only when every gate passes. Any failed gate blocks the send.
 */
export class OutboundService {
  constructor({ repository, gates, emailDirectory, mailer = new DisabledOutboundMailer(), transactions, audit, access }) {
    Object.assign(this, { repository, gates, emailDirectory, mailer, transactions, audit, access });
  }

  async createDraft(actor, { workflowKey = null, category, customerId, enquiryId, quotationId, salesOrderId, recipients, cc = [], subject, body }) {
    const content = { recipients: [...new Set(recipients.map((r) => r.toLowerCase()))].sort(), cc: [...new Set(cc.map((r) => r.toLowerCase()))].sort(), subject, body };
    return this.transactions.run(actor, 'Outbound draft created', async () => {
      const draft = await this.repository.insertDraft({ ...content, fingerprint: fingerprint(content), workflowKey, category, customerId, enquiryId, quotationId, salesOrderId, actorId: actor?.id ?? null });
      await this.audit.record({ actorId: actor?.id, entity: 'OUTBOUND_DRAFT', recordId: draft.id, action: 'CREATE', newValue: { workflowKey, category, customerId, recipients: content.recipients, subject } });
      return this.#view(draft);
    });
  }

  async editDraft(actor, id, { recipients, cc = [], subject, body, reason }) {
    return this.transactions.run(actor, reason, async () => {
      const draft = await this.repository.lock(id);
      if (!draft) throw notFound('Draft not found.');
      if (['SENT', 'SENDING', 'REJECTED'].includes(draft.status)) throw conflict('This draft can no longer be edited.', 'DRAFT_CLOSED');
      const content = { recipients: [...new Set(recipients.map((r) => r.toLowerCase()))].sort(), cc: [...new Set(cc.map((r) => r.toLowerCase()))].sort(), subject, body };
      const updated = await this.repository.updateContent(id, { ...content, fingerprint: fingerprint(content) }, actor.id);
      await this.audit.record({ actorId: actor.id, entity: 'OUTBOUND_DRAFT', recordId: id, action: 'EDIT', oldValue: { subject: draft.subject, recipients: draft.recipient_addresses, approved: Boolean(draft.approval_request_id) }, newValue: { subject, recipients: content.recipients }, reason });
      return this.#view(updated);
    });
  }

  async evaluate(draftRow) {
    const draft = this.#view(draftRow);
    const customer = await this.repository.customer(draft.customerId);
    const approvalRow = await this.repository.approvalFor(draftRow);
    const ctx = {
      draft, customer: customer ? { ...customer, approvalState: customer.approval_state } : null,
      registeredEmails: customer ? await this.emailDirectory.registeredEmails(customer.id) : [],
      checklistTicked: customer && draft.category ? await this.repository.checklistTicked(customer.id, draft.category) : false,
      manualResponse: await this.repository.manualResponseReason(draft.customerId, draft.itemIds ?? []),
      approval: approvalRow ? { fingerprint: approvalRow.payload_fingerprint, approvedBy: approvalRow.approved_by, decisionId: approvalRow.decision_id } : null
    };
    const results = [];
    for (const gate of this.gates) results.push({ gate: gate.name, ...(await gate.check(ctx)) });
    return { passed: results.every((r) => r.passed), results, decisionId: ctx.approval?.decisionId ?? null };
  }

  async gateStatus(user, id) {
    this.access.require(user, 'outbound.read');
    const draft = await this.repository.get(id);
    if (!draft) throw notFound('Draft not found.');
    return { draft: this.#view(draft), ...(await this.evaluate(draft)) };
  }

  async approve(actor, id, reason) {
    this.access.require(actor, 'outbound.approve');
    return this.transactions.run(actor, reason, async () => {
      const draft = await this.repository.lock(id);
      if (!draft) throw notFound('Draft not found.');
      if (draft.status !== 'DRAFT') throw conflict(`Draft is ${draft.status}.`, 'DRAFT_NOT_PENDING');
      const { requestId } = await this.repository.createApproval({ actorId: actor.id, fingerprint: draft.content_fingerprint, snapshot: { draftId: id, subject: draft.subject, recipients: draft.recipient_addresses, reason } });
      await this.repository.attachApproval(id, requestId, actor.id);
      await this.audit.record({ actorId: actor.id, entity: 'OUTBOUND_DRAFT', recordId: id, action: 'APPROVE', newValue: { fingerprint: draft.content_fingerprint }, reason });
      return this.#view(await this.repository.get(id));
    });
  }

  async reject(actor, id, reason) {
    this.access.require(actor, 'outbound.approve');
    return this.transactions.run(actor, reason, async () => {
      const draft = await this.repository.lock(id);
      if (!draft) throw notFound('Draft not found.');
      if (['SENT', 'SENDING'].includes(draft.status)) throw conflict('A sent message cannot be rejected.', 'DRAFT_CLOSED');
      await this.repository.setStatus(id, 'REJECTED');
      await this.audit.record({ actorId: actor.id, entity: 'OUTBOUND_DRAFT', recordId: id, action: 'REJECT', reason });
      return this.#view(await this.repository.get(id));
    });
  }

  /**
   * Sends when every gate passes. Retrying with the same key returns the first
   * outcome. email_send_attempts is append-only, so the draft is held in
   * SENDING (row lock + status) during the provider call and the attempt row is
   * written once with its final result. A crash mid-call leaves the draft
   * visibly SENDING for a person to resolve; it is never resent automatically.
   */
  async send(actor, id, idempotencyKey) {
    this.access.require(actor, 'outbound.approve');
    if (!idempotencyKey) throw validationFailed('An idempotency key is required to send.');
    const prepared = await this.transactions.run(actor, 'Outbound send', async () => {
      const draft = await this.repository.lock(id);
      if (!draft) throw notFound('Draft not found.');
      const previous = await this.repository.attemptByKey(id, idempotencyKey);
      if (previous) return { replay: previous };
      if (draft.status === 'SENT') throw conflict('This draft was already sent.', 'ALREADY_SENT');
      if (draft.status === 'SENDING') throw conflict('This draft is being sent. Check its status before retrying.', 'SEND_IN_PROGRESS');
      const evaluation = await this.evaluate(draft);
      await this.repository.setStatus(id, draft.status, { gateResult: evaluation.results, contextState: evaluation.passed ? 'READY' : 'NEEDS_INFORMATION' });
      if (!evaluation.passed) {
        await this.audit.record({ actorId: actor.id, entity: 'OUTBOUND_DRAFT', recordId: id, action: 'SEND_BLOCKED', newValue: { failed: evaluation.results.filter((r) => !r.passed).map((r) => r.gate) } });
        return { blocked: evaluation };
      }
      await this.repository.setStatus(id, 'SENDING');
      return { draft, decisionId: evaluation.decisionId, attemptNumber: await this.repository.nextAttemptNumber(id) };
    });
    if (prepared.blocked) throw new AppError(409, 'GATE_BLOCKED', `Not sent: ${prepared.blocked.results.find((r) => !r.passed).message}`, { gates: prepared.blocked.results });
    if (prepared.replay) return { status: prepared.replay.status, attemptId: prepared.replay.id, providerMessageId: prepared.replay.provider_message_id, replay: true };
    const { draft, decisionId, attemptNumber } = prepared;
    let outcome;
    try {
      const result = await this.mailer.send({ to: draft.recipient_addresses, cc: draft.cc_addresses, subject: draft.subject, text: draft.body_text });
      outcome = { status: 'SENT', providerMessageId: result.messageId };
    } catch (error) {
      outcome = { status: 'FAILED', error: String(error?.message || error).slice(0, 300), code: error?.code };
    }
    const attempt = await this.transactions.run(actor, 'Outbound send result', async () => {
      const row = await this.repository.insertAttempt({ draftId: id, decisionId, attempt: attemptNumber, key: idempotencyKey, ...outcome });
      await this.repository.setStatus(id, outcome.status === 'SENT' ? 'SENT' : 'APPROVED');
      await this.audit.record({ actorId: actor.id, entity: 'OUTBOUND_DRAFT', recordId: id, action: outcome.status === 'SENT' ? 'SENT' : 'SEND_FAILED', newValue: { attempt: attemptNumber, provider: this.mailer.name, providerMessageId: outcome.providerMessageId, error: outcome.error } });
      return row;
    });
    if (outcome.status !== 'SENT') throw new AppError(outcome.code === 'PROVIDER_NOT_CONFIGURED' ? 503 : 502, outcome.code || 'SEND_FAILED', `Not sent: ${outcome.error}`);
    return { status: 'SENT', attemptId: attempt.id, providerMessageId: outcome.providerMessageId, replay: false };
  }

  async list(user, query) {
    this.access.require(user, 'outbound.read');
    const { total, rows } = await this.repository.list(query);
    return { data: rows.map((r) => ({ ...this.#view(r), customerName: r.customer_name })), pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) } };
  }

  async setChecklist(actor, customerId, category, ticked, reason) {
    this.access.require(actor, 'outbound.checklist.manage');
    return this.transactions.run(actor, reason, async () => {
      if (!await this.repository.customer(customerId)) throw notFound('Customer not found.');
      const old = await this.repository.setChecklist(customerId, category, ticked, actor.id, reason);
      await this.audit.record({ actorId: actor.id, entity: 'CUSTOMER_CHECKLIST', recordId: `${customerId}:${category}`, action: ticked ? 'TICK' : 'UNTICK', oldValue: { ticked: old }, newValue: { ticked }, reason });
      return this.repository.checklist(customerId);
    });
  }

  async checklist(user, customerId) {
    this.access.require(user, 'outbound.read');
    return this.repository.checklist(customerId);
  }

  #view(d) {
    return {
      id: d.id, status: d.status, workflowKey: d.workflow_key, category: d.message_category, customerId: d.customer_id, enquiryId: d.enquiry_id, quotationId: d.quotation_id,
      recipients: d.recipient_addresses, cc: d.cc_addresses, subject: d.subject, body: d.body_text, contentFingerprint: d.content_fingerprint,
      contextState: d.context_state, approved: Boolean(d.approval_request_id), gateResult: d.gate_result, createdAt: d.created_at, updatedAt: d.updated_at
    };
  }
}
