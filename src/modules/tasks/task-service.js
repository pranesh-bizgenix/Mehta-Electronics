import { conflict, forbidden, notFound, validationFailed } from '../../core/errors.js';

const TRANSITIONS = { OPEN: ['IN_PROGRESS', 'DONE'], IN_PROGRESS: ['OPEN', 'DONE'], FORWARDED: [], DONE: ['OPEN'] };

/**
 * Task board (S-19). Forwarding closes the task as FORWARDED and creates a
 * linked sub-task for the new owner, logging who forwarded it. Every task is
 * registered as a work item so owner/backup/due/escalation apply uniformly.
 */
export class TaskService {
  constructor({ repository, work, rules, automation, notifications, transactions, audit, access, clock }) {
    Object.assign(this, { repository, work, rules, automation, notifications, transactions, audit, access, clock });
  }

  async create(actor, { title, description, ownerUserId, backupUserId, dueAt, department, entityType, entityId, source = 'MANUAL', reason = 'Task created' }) {
    const owner = ownerUserId ?? actor.id;
    if (owner !== actor.id && !this.access.can(actor, 'tasks.assign')) throw forbidden('You can only create tasks for yourself.', 'ASSIGN_DENIED');
    return this.transactions.run(actor, reason, async () => {
      const ownerUser = await this.repository.user(owner);
      if (!ownerUser || ownerUser.status !== 'ACTIVE') throw validationFailed('Task owner must be an active user.');
      const backup = backupUserId === undefined ? ownerUser.backup_user_id : backupUserId;
      if (backup && backup === owner) throw validationFailed('Backup must differ from the owner.');
      const task = await this.repository.insert({ title, description, source, department, ownerUserId: owner, backupUserId: backup ?? null, dueAt, entityType, entityId, nextReminderAt: await this.#nextReminder(), actorId: actor.id });
      await this.repository.event({ taskId: task.id, event: 'CREATED', newValue: { title, ownerUserId: owner, dueAt: dueAt ?? null }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'TASK', recordId: task.id, action: 'CREATE', newValue: { title, ownerUserId: owner, backupUserId: backup ?? null, dueAt: dueAt ?? null }, reason });
      await this.work.open(actor, { entityType: 'TASK', entityId: task.id, title, department, ownerUserId: owner, backupUserId: backup ?? null, dueAt: dueAt ?? null, assignmentReason: reason });
      if (owner !== actor.id) await this.notifications.notify(owner, { type: 'TASK_ASSIGNED', title: `New task: ${title}`, message: description ?? '', entityType: 'TASK', entityId: task.id }, `task-created:${task.id}`);
      return this.#view(await this.repository.get(task.id));
    });
  }

  async #nextReminder(from = this.clock.now()) {
    const rule = await this.rules.get('tasks.reminder_interval_minutes');
    return rule ? new Date(from.getTime() + Number(rule.value) * 60000).toISOString() : null;
  }

  async setStatus(actor, id, { status, version, reason }) {
    return this.transactions.run(actor, reason, async () => {
      const task = await this.#editable(actor, id, version);
      if (!TRANSITIONS[task.status].includes(status)) throw conflict(`A ${task.status} task cannot move to ${status}.`, 'INVALID_TRANSITION');
      const done = status === 'DONE';
      const updated = await this.repository.update(id, { status, completed_at: done ? this.clock.now().toISOString() : null, next_reminder_at: done ? null : await this.#nextReminder() }, actor.id);
      await this.repository.event({ taskId: id, event: 'STATUS', oldValue: { status: task.status }, newValue: { status }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'TASK', recordId: id, action: 'STATUS', oldValue: { status: task.status }, newValue: { status }, reason });
      const workItem = await this.work.repository.findByEntity('TASK', id);
      if (workItem) {
        if (done) await this.work.setStatus({ ...actor, __system: true }, workItem.id, 'DONE', reason);
        else if (workItem.status === 'DONE') await this.work.repository.update(workItem.id, { status: 'OPEN', closed_at: null, sla_state: workItem.due_at ? 'RUNNING' : 'NOT_CONFIGURED' }, actor.id);
        else await this.work.setStatus({ ...actor, __system: true }, workItem.id, status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN', reason);
      }
      return this.#view({ ...updated, owner_name: task.owner_name });
    });
  }

  async forward(actor, id, { toUserId, note, version, reason }) {
    return this.transactions.run(actor, reason, async () => {
      const task = await this.#editable(actor, id, version);
      if (!['OPEN', 'IN_PROGRESS'].includes(task.status)) throw conflict('Only open tasks can be forwarded.', 'INVALID_TRANSITION');
      if (toUserId === task.owner_user_id) throw validationFailed('Forward to a different person.');
      const target = await this.repository.user(toUserId);
      if (!target || target.status !== 'ACTIVE') throw validationFailed('Forward target must be an active user.');
      const child = await this.repository.insert({
        title: task.title, description: [task.description, note].filter(Boolean).join('\n\n'), source: task.source, department: task.department,
        ownerUserId: toUserId, backupUserId: target.backup_user_id && target.backup_user_id !== toUserId ? target.backup_user_id : null,
        dueAt: task.due_at, parentTaskId: id, entityType: task.entity_type, entityId: task.entity_id, nextReminderAt: await this.#nextReminder(), actorId: actor.id
      });
      await this.repository.update(id, { status: 'FORWARDED', forwarded_to_task_id: child.id, next_reminder_at: null }, actor.id);
      await this.repository.event({ taskId: id, event: 'FORWARDED', oldValue: { ownerUserId: task.owner_user_id }, newValue: { toUserId, childTaskId: child.id, forwardedBy: actor.id }, reason, actorId: actor.id });
      await this.repository.event({ taskId: child.id, event: 'CREATED_BY_FORWARD', newValue: { parentTaskId: id, forwardedBy: actor.id }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'TASK', recordId: id, action: 'FORWARD', newValue: { toUserId, childTaskId: child.id }, reason });
      const parentItem = await this.work.repository.findByEntity('TASK', id);
      if (parentItem) await this.work.setStatus({ ...actor, __system: true }, parentItem.id, 'DONE', `Forwarded: ${reason}`);
      await this.work.open(actor, { entityType: 'TASK', entityId: child.id, title: task.title, department: task.department, ownerUserId: toUserId, backupUserId: child.backup_user_id, dueAt: task.due_at, assignmentReason: `Forwarded by ${actor.name ?? actor.id}: ${reason}` });
      await this.notifications.notify(toUserId, { type: 'TASK_FORWARDED', title: `Task forwarded to you: ${task.title}`, message: note ?? reason, entityType: 'TASK', entityId: child.id }, `task-forwarded:${child.id}`);
      return { parent: this.#view(await this.repository.get(id)), child: this.#view(await this.repository.get(child.id)) };
    });
  }

  async archive(actor, id, { version, reason }) {
    return this.transactions.run(actor, reason, async () => {
      const task = await this.#editable(actor, id, version);
      await this.repository.update(id, { is_deleted: true, deleted_reason: reason, next_reminder_at: null }, actor.id);
      await this.repository.event({ taskId: id, event: 'ARCHIVED', reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'TASK', recordId: id, action: 'ARCHIVE', oldValue: { status: task.status }, reason });
      const item = await this.work.repository.findByEntity('TASK', id);
      if (item && ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(item.status)) await this.work.setStatus({ ...actor, __system: true }, item.id, 'CANCELLED', reason);
      return { archived: true };
    });
  }

  async board(user, { scope, ownerId, search }) {
    this.access.require(user, 'tasks.read');
    const all = scope === 'all';
    if (all && !this.access.can(user, 'tasks.assign')) throw forbidden('Viewing everyone\'s tasks needs the assign permission.');
    const rows = await this.repository.board({ userId: user.id, all, ownerId, search });
    const columns = { OPEN: [], IN_PROGRESS: [], FORWARDED: [], DONE: [] };
    for (const r of rows) columns[r.status].push(this.#view(r));
    return { columns, now: this.clock.now().toISOString() };
  }

  async detail(user, id) {
    this.access.require(user, 'tasks.read');
    const task = await this.repository.get(id);
    if (!task) throw notFound('Task not found.');
    if (![task.owner_user_id, task.created_by, task.backup_user_id].includes(user.id) && !this.access.can(user, 'tasks.assign')) throw forbidden();
    return { task: this.#view(task), events: await this.repository.events(id) };
  }

  /** Moves a departing user's open tasks to their backups (used with work reassignment). */
  async reassignAllToBackup(actor, userId, reason) {
    const user = await this.repository.user(userId);
    let moved = 0; const unassigned = [];
    for (const task of await this.repository.openOwnedBy(userId)) {
      const target = task.backup_user_id ?? user?.backup_user_id;
      const targetUser = await this.repository.user(target);
      if (!targetUser || targetUser.status !== 'ACTIVE' || target === userId) { unassigned.push(task.id); continue; }
      await this.repository.update(task.id, { owner_user_id: target, backup_user_id: null }, actor.id);
      await this.repository.event({ taskId: task.id, event: 'REASSIGNED_TO_BACKUP', oldValue: { ownerUserId: userId }, newValue: { ownerUserId: target }, reason, actorId: actor.id });
      moved++;
    }
    return { moved, unassigned };
  }

  /** Reminder job body: remind owners of open tasks at the configured interval. */
  async sendReminders() {
    if (!await this.automation.isEnabled('task_reminders')) return { skipped: true, message: 'Task reminders switch is OFF.' };
    const rule = await this.rules.get('tasks.reminder_interval_minutes');
    if (!rule) return { skipped: true, message: 'Rule not configured: task reminder interval.' };
    const now = this.clock.now();
    for (const t of await this.repository.withoutReminder()) await this.repository.update(t.id, { next_reminder_at: new Date(now.getTime() + Number(rule.value) * 60000).toISOString() }, null);
    let sent = 0;
    for (const task of await this.repository.dueReminders(now)) {
      const count = task.reminder_count + 1;
      await this.notifications.notify(task.owner_user_id, { type: 'TASK_REMINDER', title: `Reminder: ${task.title}`, message: task.due_at ? `Due ${new Date(task.due_at).toISOString()}` : 'Open task', entityType: 'TASK', entityId: task.id }, `task-reminder:${task.id}:${count}`);
      await this.repository.update(task.id, { reminder_count: count, next_reminder_at: new Date(now.getTime() + Number(rule.value) * 60000).toISOString() }, null);
      await this.repository.event({ taskId: task.id, event: 'REMINDER_SENT', newValue: { count } });
      sent++;
    }
    return { sent };
  }

  async #editable(actor, id, version) {
    const task = await this.repository.lock(id);
    if (!task) throw notFound('Task not found.');
    if (version !== undefined && task.version !== version) throw conflict('The task changed. Reload and try again.', 'STALE_VERSION');
    if (![task.owner_user_id, task.created_by].includes(actor.id) && !this.access.can(actor, 'tasks.assign')) throw forbidden('Only the owner, creator or an assigner can change this task.');
    const owner = await this.repository.user(task.owner_user_id);
    return { ...task, owner_name: owner?.name };
  }

  #view(t) {
    return {
      id: t.id, title: t.title, description: t.description, status: t.status, source: t.source, department: t.department,
      ownerId: t.owner_user_id, owner: t.owner_name, backupId: t.backup_user_id, backup: t.backup_name ?? null, dueAt: t.due_at,
      parentTaskId: t.parent_task_id, forwardedToTaskId: t.forwarded_to_task_id, entityType: t.entity_type, entityId: t.entity_id,
      reminderCount: t.reminder_count, version: t.version, createdAt: t.created_at, completedAt: t.completed_at,
      overdue: Boolean(t.due_at && ['OPEN', 'IN_PROGRESS'].includes(t.status) && new Date(t.due_at) < new Date())
    };
  }
}
