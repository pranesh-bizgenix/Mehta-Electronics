import { s } from '../../core/schema.js';

const department = s.enum(['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT']);

/** Task board (S-19). */
export class TaskController {
  constructor({ tasks }) { this.tasks = tasks; }
  routes() {
    const t = this.tasks;
    return [
      {
        method: 'GET', path: '/api/v1/tasks', permission: 'tasks.read',
        query: s.object({ scope: s.enum(['mine', 'all']).default('mine'), ownerId: s.id().optional(), search: s.string({ max: 100 }).optional() }),
        handler: async ({ user, query }) => ({ data: await t.board(user, query) })
      },
      {
        method: 'POST', path: '/api/v1/tasks', permission: 'tasks.write', idempotency: 'optional',
        body: s.object({
          title: s.string({ min: 1, max: 200 }), description: s.text({ max: 5000 }).optional(), ownerUserId: s.id().optional(), backupUserId: s.id().optional().nullable(),
          dueAt: s.datetime().optional().nullable(), department: department.optional().nullable(), entityType: s.string({ max: 40, pattern: /^[A-Z][A-Z_]+$/ }).optional(), entityId: s.string({ max: 80 }).optional()
        }),
        handler: async ({ user, body }) => ({ status: 201, data: await t.create(user, body) })
      },
      { method: 'GET', path: '/api/v1/tasks/:id', permission: 'tasks.read', handler: async ({ user, params }) => ({ data: await t.detail(user, params.id) }) },
      {
        method: 'POST', path: '/api/v1/tasks/:id/status', permission: 'tasks.write',
        body: s.object({ status: s.enum(['OPEN', 'IN_PROGRESS', 'DONE']), version: s.int({ min: 1 }), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await t.setStatus(user, params.id, body) })
      },
      {
        method: 'POST', path: '/api/v1/tasks/:id/forward', permission: 'tasks.write', idempotency: 'optional',
        body: s.object({ toUserId: s.id(), note: s.text({ max: 2000 }).optional(), version: s.int({ min: 1 }), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await t.forward(user, params.id, body) })
      },
      {
        method: 'POST', path: '/api/v1/tasks/:id/archive', permission: 'tasks.write',
        body: s.object({ version: s.int({ min: 1 }), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await t.archive(user, params.id, body) })
      }
    ];
  }
}
