import { s } from '../../core/schema.js';

const category = s.string({ min: 3, max: 60, pattern: /^[a-z][a-z0-9_]+$/ });

/** Outbound drafts: list, create, edit, approve, reject, gate status, send. */
export class OutboundController {
  constructor({ outbound }) { this.outbound = outbound; }
  routes() {
    const o = this.outbound;
    const content = { recipients: s.array(s.email(), { min: 1, max: 20 }), cc: s.array(s.email(), { max: 20 }).default(() => []), subject: s.string({ min: 1, max: 300 }), body: s.text({ max: 50000 }) };
    return [
      {
        method: 'GET', path: '/api/v1/messages/drafts', permission: 'outbound.read',
        query: s.object({ page: s.int({ min: 1 }).default(1), pageSize: s.int({ min: 1, max: 100 }).default(25), status: s.enum(['DRAFT', 'APPROVED', 'SENDING', 'SENT', 'REJECTED']).optional(), customerId: s.id().optional() }),
        handler: async ({ user, query }) => ({ body: await o.list(user, query) })
      },
      {
        method: 'POST', path: '/api/v1/messages/drafts', permission: 'outbound.read', idempotency: 'optional',
        body: s.object({ customerId: s.id(), category, enquiryId: s.id().optional(), quotationId: s.id().optional(), ...content }),
        handler: async ({ user, body }) => ({ status: 201, data: await o.createDraft(user, body) })
      },
      { method: 'GET', path: '/api/v1/messages/drafts/:id', permission: 'outbound.read', handler: async ({ user, params }) => ({ data: await o.gateStatus(user, params.id) }) },
      {
        method: 'PUT', path: '/api/v1/messages/drafts/:id', permission: 'outbound.read',
        body: s.object({ ...content, reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await o.editDraft(user, params.id, body) })
      },
      { method: 'POST', path: '/api/v1/messages/drafts/:id/approve', permission: 'outbound.approve', body: s.object({ reason: s.reason() }), handler: async ({ user, params, body }) => ({ data: await o.approve(user, params.id, body.reason) }) },
      { method: 'POST', path: '/api/v1/messages/drafts/:id/reject', permission: 'outbound.approve', body: s.object({ reason: s.reason() }), handler: async ({ user, params, body }) => ({ data: await o.reject(user, params.id, body.reason) }) },
      {
        method: 'POST', path: '/api/v1/messages/send', permission: 'outbound.approve',
        body: s.object({ draftId: s.uuid() }),
        handler: async ({ user, body, req }) => ({ data: await o.send(user, body.draftId, req.headers['idempotency-key']) })
      },
      { method: 'GET', path: '/api/v1/customers/:id/message-checklist', permission: 'outbound.read', handler: async ({ user, params }) => ({ data: await o.checklist(user, Number(params.id)) }) },
      {
        method: 'PUT', path: '/api/v1/customers/:id/message-checklist/:category', permission: 'outbound.checklist.manage',
        body: s.object({ ticked: s.bool(), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await o.setChecklist(user, Number(params.id), params.category, body.ticked, body.reason) })
      }
    ];
  }
}
