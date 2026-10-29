import { conflict, forbidden, notFound, validationFailed } from '../../core/errors.js';
import { addBusinessMinutes } from './sla-calculator.js';

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING'];

/**
 * Ownership, SLA clock, escalation and reassignment for every business record.
 * A record (enquiry, quotation, task, ...) registers one work item keyed by
 * (entityType, entityId). The SLA uses the owner-configured policy; while that
 * policy is empty the item shows NOT_CONFIGURED and is never escalated.
 */
export class WorkService {
  constructor({ repository, rules, automation, notifications, transactions, audit, access, clock }) {
    Object.assign(this, { repository, rules, automation, notifications, transactions, audit, access, clock });
  }

  /** Registers a record. Idempotent: an existing item for the same record is returned unchanged. */
  async open(actor, { entityType, entityId, title, department = null, ownerUserId = null, backupUserId, assignmentReason = null, dueAt = null, startedAt = null }) {
    return this.transactions.run(actor, assignmentReason || 'Record registered', async () => {
      const existing = await this.repository.findByEntity(entityType, entityId);
      if (existing) return existing;
      const owner = await this.repository.user(ownerUserId);
      if (ownerUserId && (!owner || owner.status !== 'ACTIVE')) throw validationFailed('Owner must be an active user.');
      const backup = backupUserId === undefined ? owner?.backup_user_id ?? null : backupUserId;
      const start = startedAt ? new Date(startedAt) : this.clock.now();
      const sla = dueAt ? { dueAt: new Date(dueAt), slaState: 'RUNNING' } : await this.#slaFor(entityType, start);
      const item = await this.repository.insert({
        entityType, entityId, title, department, ownerUserId, backupUserId: backup === ownerUserId ? null : backup,
        assignmentReason, startedAt: start.toISOString(), dueAt: sla.dueAt?.toISOString() ?? null, slaState: sla.slaState,
        slaRuleVersion: sla.version ?? null, slaTimezone: sla.timezone ?? null, actorId: actor?.id ?? null
      }) ?? await this.repository.findByEntity(entityType, entityId);
      await this.repository.event({ workItemId: item.id, event: 'OPENED', toUserId: ownerUserId, detail: { slaState: item.sla_state, dueAt: item.due_at }, reason: assignmentReason, actorId: actor?.id ?? null });
      await this.audit.record({ actorId: actor?.id, entity: 'WORK_ITEM', recordId: item.id, action: 'OPEN', newValue: { entityType, entityId, ownerUserId, backupUserId: item.backup_user_id, dueAt: item.due_at, slaState: item.sla_state }, reason: assignmentReason });
      return item;
    });
  }

  async #slaFor(entityType, start) {
    const policy = await this.rules.get('sla.policy');
    const minutes = policy?.value?.turnaroundMinutes?.[entityType];
    if (!policy || !minutes) return { dueAt: null, slaState: 'NOT_CONFIGURED' };
    return { dueAt: addBusinessMinutes(start, minutes, policy.value), slaState: 'RUNNING', version: policy.version, timezone: policy.value.timezone };
  }

  async setStatus(actor, id, status, reason) {
    return this.transactions.run(actor, reason, async () => {
      const item = await this.repository.lockById(id);
      if (!item) throw notFound('Work item not found.');
      this.#requireOwnerOrReassign(actor, item);
      if (item.status === status) return item;
      if (!OPEN_STATUSES.includes(item.status)) throw conflict('This record is already closed.', 'CLOSED');
      const now = this.clock.now();
      const closing = !OPEN_STATUSES.includes(status);
      const fields = { status, ...(closing ? { closed_at: now.toISOString(), sla_state: item.sla_state === 'RUNNING' ? 'MET' : item.sla_state === 'BREACHED' ? 'BREACHED' : item.sla_state === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'STOPPED' } : {}) };
      const updated = await this.repository.update(id, fields, actor.id);
      await this.repository.event({ workItemId: id, event: 'STATUS', detail: { from: item.status, to: status }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'WORK_ITEM', recordId: id, action: 'STATUS', oldValue: { status: item.status }, newValue: { status }, reason });
      return updated;
    });
  }

  /** Closes the item for a record from inside another workflow (e.g. enquiry won). */
  async closeForEntity(actor, entityType, entityId, status, reason) {
    const item = await this.repository.findByEntity(entityType, entityId);
    if (!item || !OPEN_STATUSES.includes(item.status)) return item;
    return this.setStatus({ ...actor, __system: true }, item.id, status, reason);
  }

  async reassign(actor, id, { ownerUserId, backupUserId, reason }) {
    this.access.require(actor, 'work.reassign');
    return this.transactions.run(actor, reason, async () => {
      const item = await this.repository.lockById(id);
      if (!item) throw notFound('Work item not found.');
      if (!OPEN_STATUSES.includes(item.status)) throw conflict('Closed records cannot be reassigned.', 'CLOSED');
      const owner = await this.repository.user(ownerUserId);
      if (!owner || owner.status !== 'ACTIVE') throw validationFailed('New owner must be an active user.');
      const backup = backupUserId === undefined ? owner.backup_user_id : backupUserId;
      if (backup && backup === ownerUserId) throw validationFailed('Backup owner must differ from the owner.');
      const updated = await this.repository.update(id, { owner_user_id: ownerUserId, backup_user_id: backup ?? null, assignment_reason: reason, escalation_level: 0, escalated_to_user_id: null, escalation_blocked_reason: null }, actor.id);
      await this.repository.event({ workItemId: id, event: 'REASSIGNED', fromUserId: item.owner_user_id, toUserId: ownerUserId, detail: { backupUserId: backup ?? null }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'WORK_ITEM', recordId: id, action: 'REASSIGN', oldValue: { ownerUserId: item.owner_user_id, backupUserId: item.backup_user_id }, newValue: { ownerUserId, backupUserId: backup ?? null }, reason });
      await this.notifications.notify(ownerUserId, { type: 'ASSIGNED', title: `Assigned: ${item.title}`, message: reason, entityType: item.entity_type, entityId: item.entity_id }, `assign:${id}:${updated.updated_at}`);
      return updated;
    });
  }

  /** One action: move every open record owned by a user to their backup (leave / exit). */
  async reassignAllToBackup(actor, userId, reason) {
    this.access.require(actor, 'work.reassign');
    return this.transactions.run(actor, reason, async () => {
      const user = await this.repository.user(userId);
      if (!user) throw notFound('User not found.');
      const items = await this.repository.openOwnedBy(userId);
      const moved = [], unassigned = [];
      for (const item of items) {
        const target = item.backup_user_id ?? user.backup_user_id;
        const targetUser = await this.repository.user(target);
        if (!targetUser || targetUser.status !== 'ACTIVE' || target === userId) { unassigned.push(item.id); continue; }
        await this.repository.update(item.id, { owner_user_id: target, backup_user_id: targetUser.backup_user_id && targetUser.backup_user_id !== target ? targetUser.backup_user_id : null, assignment_reason: reason, escalation_level: 0, escalated_to_user_id: null }, actor.id);
        await this.repository.event({ workItemId: item.id, event: 'REASSIGNED_TO_BACKUP', fromUserId: userId, toUserId: target, reason, actorId: actor.id });
        moved.push({ id: item.id, to: target });
      }
      await this.audit.record({ actorId: actor.id, entity: 'USER', recordId: userId, action: 'REASSIGN_ALL_TO_BACKUP', newValue: { moved: moved.length, unassigned }, reason });
      for (const target of new Set(moved.map((m) => m.to))) {
        await this.notifications.notify(target, { type: 'ASSIGNED', title: 'Work moved to you', message: `${moved.filter((m) => m.to === target).length} open record(s) from ${user.name}: ${reason}`, entityType: 'USER', entityId: String(userId) });
      }
      return { moved: moved.length, unassigned, unassignedCount: unassigned.length };
    });
  }

  async myWork(user, query) {
    this.access.require(user, 'work.read');
    const { total, rows } = await this.repository.myWork(user.id, query);
    const now = this.clock.now();
    return {
      data: rows.map((r) => ({
        id: r.id, entityType: r.entity_type, entityId: r.entity_id, title: r.title, department: r.department, status: r.status,
        owner: r.owner_name, backup: r.backup_name, dueAt: r.due_at, slaState: r.sla_state, escalationLevel: r.escalation_level,
        escalatedToMe: r.escalated_to_user_id === user.id, overdue: Boolean(r.due_at && new Date(r.due_at) < now),
        minutesRemaining: r.due_at ? Math.round((new Date(r.due_at) - now) / 60000) : null
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) }
    };
  }

  async timeline(user, id) {
    this.access.require(user, 'work.read');
    const item = await this.repository.get(id);
    if (!item) throw notFound('Work item not found.');
    return { item, events: await this.repository.events(id) };
  }

  /**
   * Escalation job body. Overdue items are always marked BREACHED. Moving them
   * to backup/manager and notifying requires the sla_escalation switch ON and
   * the escalation policy rule.
   */
  async escalateOverdue() {
    const now = this.clock.now();
    const overdue = await this.repository.overdue(now);
    let breached = 0, escalated = 0, blocked = 0;
    for (const item of overdue) {
      if (item.sla_state !== 'BREACHED') {
        await this.repository.update(item.id, { sla_state: 'BREACHED' }, null);
        await this.repository.event({ workItemId: item.id, event: 'SLA_BREACHED', detail: { dueAt: item.due_at } });
        breached++;
      }
    }
    if (!await this.automation.isEnabled('sla_escalation')) return { breached, escalated, blocked, message: 'SLA escalation switch is OFF; overdue records were only marked breached.' };
    const policy = await this.rules.get('escalation.policy');
    if (!policy) return { breached, escalated, blocked, message: 'Rule not configured: escalation timing.' };
    for (const item of overdue) {
      const lateMinutes = (now - new Date(item.due_at)) / 60000;
      let level = item.escalation_level, target = null, why = null;
      if (level === 0 && lateMinutes >= policy.value.toBackupAfterMinutes) {
        level = 1; target = item.backup_user_id; why = target ? null : 'No backup owner is set for this record.';
      } else if (level === 1 && lateMinutes >= policy.value.toManagerAfterMinutes) {
        level = 2; target = (await this.repository.user(item.owner_user_id))?.manager_user_id ?? null; why = target ? null : 'The owner has no manager configured.';
      } else continue;
      if (!target) {
        if (item.escalation_blocked_reason !== why) {
          await this.repository.update(item.id, { escalation_blocked_reason: why }, null);
          await this.repository.event({ workItemId: item.id, event: 'ESCALATION_BLOCKED', detail: { level }, reason: why });
        }
        blocked++;
        continue;
      }
      await this.repository.update(item.id, { escalation_level: level, escalated_to_user_id: target, last_escalated_at: now.toISOString(), escalation_blocked_reason: null }, null);
      await this.repository.event({ workItemId: item.id, event: level === 1 ? 'ESCALATED_TO_BACKUP' : 'ESCALATED_TO_MANAGER', fromUserId: item.owner_user_id, toUserId: target, detail: { lateMinutes: Math.round(lateMinutes), policyVersion: policy.version } });
      await this.audit.record({ actorId: null, entity: 'WORK_ITEM', recordId: item.id, action: level === 1 ? 'ESCALATE_BACKUP' : 'ESCALATE_MANAGER', newValue: { to: target, lateMinutes: Math.round(lateMinutes) }, reason: 'SLA overdue' });
      await this.notifications.notify(target, { type: 'ESCALATION', title: `Overdue: ${item.title}`, message: `Escalated after ${Math.round(lateMinutes)} minutes past due.`, entityType: item.entity_type, entityId: item.entity_id }, `escalate:${item.id}:${level}`);
      escalated++;
    }
    return { breached, escalated, blocked };
  }

  /** Approved BACKDATE exception: moves a record's start time and recomputes its SLA due time. */
  async applyBackdate(actor, exceptionCase) {
    if (exceptionCase.entity_type !== 'WORK_ITEM') return;
    const item = await this.repository.lockById(exceptionCase.entity_id);
    if (!item) throw notFound('Work item for the backdating request no longer exists.');
    const start = new Date(exceptionCase.backdate_to);
    if (start > this.clock.now()) throw validationFailed('Backdating cannot move a record into the future.');
    const sla = item.sla_rule_version ? await this.#slaFor(item.entity_type, start) : { dueAt: item.due_at ? new Date(item.due_at) : null, slaState: item.sla_state };
    await this.repository.update(item.id, { started_at: start.toISOString(), due_at: sla.dueAt?.toISOString() ?? null, sla_state: sla.slaState, sla_rule_version: sla.version ?? item.sla_rule_version }, actor.id);
    await this.repository.event({ workItemId: item.id, event: 'BACKDATED', detail: { from: item.started_at, to: start.toISOString(), exceptionId: exceptionCase.id }, reason: exceptionCase.decision_reason, actorId: actor.id });
  }

  #requireOwnerOrReassign(actor, item) {
    if (actor.__system) return;
    if (item.owner_user_id === actor.id || item.escalated_to_user_id === actor.id || this.access.can(actor, 'work.reassign')) return;
    throw forbidden('Only the owner, the escalation target or a user who can reassign work may change this record.');
  }
}
