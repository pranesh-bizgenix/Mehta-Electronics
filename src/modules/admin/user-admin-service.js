import { notFound, validationFailed } from '../../core/errors.js';
import { s } from '../../core/schema.js';

const DEPARTMENTS = ['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT'];

export class UserAdminRepository {
  constructor(db) { this.db = db; }
  async list() {
    return this.db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.status,u.department,u.on_leave,u.backup_user_id,b.name AS backup_name,u.manager_user_id,m.name AS manager_name,
      (m2.enabled_at IS NOT NULL) AS mfa_enabled,u.updated_at FROM users u LEFT JOIN users b ON b.id=u.backup_user_id LEFT JOIN users m ON m.id=u.manager_user_id
      LEFT JOIN user_mfa m2 ON m2.user_id=u.id ORDER BY u.name`).all();
  }
  async get(id) { return this.db.prepare('SELECT id,name,role,status,department,on_leave,backup_user_id,manager_user_id FROM users WHERE id=?').get(id); }
  async update(id, f) {
    await this.db.prepare('UPDATE users SET role=?,status=?,department=?,on_leave=?,backup_user_id=?,manager_user_id=?,updated_at=now() WHERE id=?')
      .run(f.role, f.status, f.department, f.on_leave, f.backup_user_id, f.manager_user_id, id);
  }
  async owners() { return Number((await this.db.prepare("SELECT count(*) AS n FROM users WHERE role='OWNER' AND status='ACTIVE'").get()).n); }
}

/** Users & Roles (S-24): role, department label, backup, manager, leave; one-action reassignment. */
export class UserAdminService {
  constructor({ repository, access, work, tasks, transactions, audit }) { Object.assign(this, { repository, access, work, tasks, transactions, audit }); }

  async list(user) {
    this.access.require(user, 'users.read');
    return (await this.repository.list()).map((u) => ({
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status, department: u.department, onLeave: u.on_leave,
      backupUserId: u.backup_user_id, backup: u.backup_name, managerUserId: u.manager_user_id, manager: u.manager_name, mfaEnabled: u.mfa_enabled,
      mfaRequired: this.access.requiresMfa(u.role)
    }));
  }

  async update(actor, id, body) {
    this.access.require(actor, 'users.update');
    return this.transactions.run(actor, body.reason, async () => {
      const old = await this.repository.get(id);
      if (!old) throw notFound('User not found.');
      const next = {
        role: body.role ?? old.role, status: body.status ?? old.status, department: body.department === undefined ? old.department : body.department,
        on_leave: body.onLeave ?? old.on_leave, backup_user_id: body.backupUserId === undefined ? old.backup_user_id : body.backupUserId,
        manager_user_id: body.managerUserId === undefined ? old.manager_user_id : body.managerUserId
      };
      if (!this.access.roleExists(next.role)) throw validationFailed('Select an active role.');
      if (next.backup_user_id === id || next.manager_user_id === id) throw validationFailed('A user cannot be their own backup or manager.');
      for (const ref of [next.backup_user_id, next.manager_user_id]) if (ref && (await this.repository.get(ref))?.status !== 'ACTIVE') throw validationFailed('Backup and manager must be active users.');
      if (old.role === 'OWNER' && (next.role !== 'OWNER' || next.status !== 'ACTIVE') && await this.repository.owners() <= 1) throw validationFailed('The last active owner cannot be demoted or deactivated.');
      await this.repository.update(id, next);
      await this.audit.record({ actorId: actor.id, entity: 'USER', recordId: id, action: 'UPDATE_ACCESS', oldValue: old, newValue: next, reason: body.reason });
      let reassigned = null;
      if (body.reassignToBackup) reassigned = await this.reassignAll(actor, id, body.reason);
      return { user: (await this.list(actor)).find((u) => u.id === id), reassigned };
    });
  }

  async reassignAll(actor, id, reason) {
    this.access.require(actor, 'work.reassign');
    return this.transactions.run(actor, reason, async () => {
      const work = await this.work.reassignAllToBackup(actor, id, reason);
      const tasks = await this.tasks.reassignAllToBackup(actor, id, reason);
      return { workItems: work, tasks };
    });
  }
}

export class UserAdminController {
  constructor({ userAdmin, notifications }) { this.userAdmin = userAdmin; this.notifications = notifications; }
  routes() {
    const u = this.userAdmin;
    return [
      { method: 'GET', path: '/api/v1/users', permission: 'users.read', handler: async ({ user }) => ({ data: await u.list(user) }) },
      {
        method: 'PATCH', path: '/api/v1/users/:id', permission: 'users.update',
        body: s.object({
          role: s.string({ max: 40 }).optional(), status: s.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(), department: s.enum(DEPARTMENTS).optional().nullable(),
          onLeave: s.bool().optional(), backupUserId: s.id().optional().nullable(), managerUserId: s.id().optional().nullable(), reassignToBackup: s.bool().default(false), reason: s.reason()
        }),
        handler: async ({ user, params, body }) => ({ data: await u.update(user, Number(params.id), body) })
      },
      {
        method: 'POST', path: '/api/v1/users/:id/reassign', permission: 'work.reassign', idempotency: 'optional',
        body: s.object({ reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await u.reassignAll(user, Number(params.id), body.reason) })
      },
      {
        method: 'GET', path: '/api/v1/notifications', permission: 'authenticated',
        query: s.object({ unreadOnly: s.bool().default(false) }),
        handler: async ({ user, query }) => ({ data: await this.notifications.mine(user, query) })
      },
      { method: 'POST', path: '/api/v1/notifications/:id/read', permission: 'authenticated', body: s.object({}), handler: async ({ user, params }) => ({ data: await this.notifications.markRead(user, params.id) }) }
    ];
  }
}
