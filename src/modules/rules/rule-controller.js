import { s } from '../../core/schema.js';

/** GET/PUT /api/v1/rules */
export class RuleController {
  constructor({ rules }) { this.rules = rules; }
  routes() {
    const r = this.rules;
    return [
      { method: 'GET', path: '/api/v1/rules', permission: 'rules.read', handler: async ({ user }) => ({ data: await r.list(user) }) },
      { method: 'GET', path: '/api/v1/rules/:key/history', permission: 'rules.read', handler: async ({ user, params }) => ({ data: await r.history(user, params.key) }) },
      {
        method: 'PUT', path: '/api/v1/rules/:key', permission: 'rules.manage',
        body: s.object({ value: s.json(), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await r.set(user, params.key, body.value, body.reason) })
      },
      {
        method: 'POST', path: '/api/v1/rules/:key/clear', permission: 'rules.manage',
        body: s.object({ reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await r.clear(user, params.key, body.reason) })
      }
    ];
  }
}
