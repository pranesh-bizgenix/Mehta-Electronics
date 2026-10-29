import { s } from '../../core/schema.js';

const page = { page: s.int({ min: 1, max: 100000 }).default(1), pageSize: s.int({ min: 1, max: 100 }).default(25) };

/** GET /api/v1/me/work, reassignment and record timelines. */
export class WorkController {
  constructor({ work }) { this.work = work; }
  routes() {
    const w = this.work;
    return [
      {
        method: 'GET', path: '/api/v1/me/work', permission: 'work.read',
        query: s.object({ ...page, status: s.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED']).optional() }),
        handler: async ({ user, query }) => ({ body: await w.myWork(user, query) })
      },
      { method: 'GET', path: '/api/v1/work-items/:id', permission: 'work.read', handler: async ({ user, params }) => ({ data: await w.timeline(user, params.id) }) },
      {
        method: 'POST', path: '/api/v1/work-items/:id/status', permission: 'work.read',
        body: s.object({ status: s.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED']), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await w.setStatus(user, params.id, body.status, body.reason) })
      },
      {
        method: 'POST', path: '/api/v1/work-items/:id/reassign', permission: 'work.reassign',
        body: s.object({ ownerUserId: s.id(), backupUserId: s.id().optional().nullable(), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await w.reassign(user, params.id, body) })
      }
    ];
  }
}
