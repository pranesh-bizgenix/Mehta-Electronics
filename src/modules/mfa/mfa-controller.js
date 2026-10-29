import { s } from '../../core/schema.js';

/** POST /api/v1/auth/verify-otp and MFA enrolment endpoints. */
export class MfaController {
  constructor({ mfa }) { this.mfa = mfa; }
  routes() {
    const m = this.mfa;
    return [
      { method: 'GET', path: '/api/v1/auth/mfa', permission: 'authenticated', mfaExempt: true, handler: async ({ user }) => ({ data: await m.status(user) }) },
      { method: 'POST', path: '/api/v1/auth/mfa/enroll', permission: 'authenticated', mfaExempt: true, body: s.object({}), handler: async ({ user }) => ({ data: await m.beginEnrolment(user) }) },
      {
        method: 'POST', path: '/api/v1/auth/mfa/confirm', permission: 'authenticated', mfaExempt: true,
        body: s.object({ code: s.string({ pattern: /^\d{6}$/ }) }),
        handler: async ({ user, body }) => ({ data: await m.confirmEnrolment(user, body.code) })
      },
      {
        method: 'POST', path: '/api/v1/auth/verify-otp', permission: 'authenticated', mfaExempt: true,
        body: s.object({ code: s.string({ pattern: /^\d{6}$/ }).optional(), recoveryCode: s.string({ min: 10, max: 20 }).optional() }),
        handler: async ({ user, body }) => ({ data: await m.verifySession(user, body) })
      },
      { method: 'POST', path: '/api/v1/auth/mfa/recovery-codes', permission: 'authenticated', body: s.object({}), handler: async ({ user }) => ({ data: await m.regenerateRecoveryCodes(user) }) },
      {
        method: 'POST', path: '/api/v1/users/:id/mfa/reset', permission: 'users.update',
        body: s.object({ reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await m.resetFor(user, Number(params.id), body.reason) })
      }
    ];
  }
}
