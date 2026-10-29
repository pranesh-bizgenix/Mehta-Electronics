import { s } from '../../core/schema.js';

const department = s.enum(['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT']);

/** GET /api/v1/exceptions, POST /api/v1/approvals/:id/decide */
export class ExceptionController {
  constructor({ exceptions }) { this.exceptions = exceptions; }
  routes() {
    const x = this.exceptions;
    return [
      {
        method: 'GET', path: '/api/v1/exceptions', permission: 'exceptions.read',
        query: s.object({
          page: s.int({ min: 1, max: 100000 }).default(1), pageSize: s.int({ min: 1, max: 100 }).default(25),
          status: s.enum(['OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN']).optional(), type: s.string({ max: 40 }).optional(),
          department: department.optional(), entityType: s.string({ max: 40 }).optional(), entityId: s.string({ max: 80 }).optional()
        }),
        handler: async ({ user, query }) => ({ body: await x.list(user, query) })
      },
      { method: 'GET', path: '/api/v1/exceptions/:id', permission: 'exceptions.read', handler: async ({ user, params }) => ({ data: await x.get(user, params.id) }) },
      {
        method: 'POST', path: '/api/v1/exceptions', permission: 'exceptions.raise', idempotency: 'optional',
        body: s.object({
          type: s.string({ min: 3, max: 40, pattern: /^[A-Z][A-Z_]+$/ }), entityType: s.string({ min: 2, max: 40, pattern: /^[A-Z][A-Z_]+$/ }), entityId: s.string({ min: 1, max: 80 }),
          summary: s.string({ min: 3, max: 500 }), details: s.json({ maxBytes: 10000 }).default(() => ({})), department: department.optional().nullable(), backdateTo: s.datetime().optional().nullable()
        }),
        handler: async ({ user, body }) => ({ status: 201, data: await x.raise(user, body) })
      },
      {
        method: 'POST', path: '/api/v1/approvals/:id/decide', permission: 'exceptions.decide',
        body: s.object({ decision: s.enum(['APPROVE', 'REJECT']), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await x.decide(user, params.id, body) })
      }
    ];
  }
}
