import { s } from '../../core/schema.js';

const roleKey = s.string({ min: 2, max: 40, upper: true, pattern: /^[A-Z][A-Z0-9_]{1,39}$/ });

/** Users & Roles (S-24): GET/PUT /api/v1/roles */
export class AccessController {
  constructor({ access }) { this.access = access; }
  routes() {
    const a = this.access;
    return [
      { method: 'GET', path: '/api/v1/roles', permission: 'access.read', handler: async ({ user }) => ({ data: await a.matrixView(user) }) },
      {
        method: 'PUT', path: '/api/v1/roles/:role/permissions/:permission', permission: 'access.manage',
        body: s.object({ granted: s.bool(), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await a.setGrant(user, { role: params.role, permission: params.permission, ...body }) })
      },
      {
        method: 'POST', path: '/api/v1/roles', permission: 'access.manage', idempotency: 'optional',
        body: s.object({ key: roleKey, name: s.string({ min: 1, max: 80 }), description: s.string({ max: 500 }).optional().nullable(), requiresMfa: s.bool().default(false), reason: s.reason() }),
        handler: async ({ user, body }) => ({ status: 201, data: await a.createRole(user, body) })
      },
      {
        method: 'PATCH', path: '/api/v1/roles/:role', permission: 'access.manage',
        body: s.object({ name: s.string({ min: 1, max: 80 }).optional(), description: s.string({ max: 500 }).optional().nullable(), requiresMfa: s.bool().optional(), status: s.enum(['ACTIVE', 'INACTIVE']).optional(), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await a.updateRole(user, params.role, body) })
      }
    ];
  }
}
