// Adapts layered-module route definitions to the existing router in src/app.js.
//
// A definition is:
//   { method, path, permission, body?, query?, idempotency?: 'required'|'optional',
//     mfaExempt?, handler: async (ctx) => ({ status?, data?, body?, headers? }) }
// The adapter validates input with the schema, applies idempotency, and passes
// { user, params, query, body, ip, req, res } to the controller handler.

import { validate, validateQuery } from './schema.js';
import { AppError, conflict, validationFailed } from './errors.js';
import { sha256, canonicalJson } from './runtime.js';

/** @interface IdempotencyStore */
export class IdempotencyRepository {
  constructor(db) { this.db = db; }
  async claim({ userId, key, method, path, requestHash }) {
    const inserted = await this.db.prepare('INSERT INTO idempotency_keys(user_id,key,method,path,request_sha256) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING key').get(userId, key, method, path, requestHash);
    if (inserted) return { claimed: true };
    const existing = await this.db.prepare('SELECT method,path,request_sha256,status_code,response_body FROM idempotency_keys WHERE user_id=? AND key=?').get(userId, key);
    return { claimed: false, existing };
  }
  async complete({ userId, key, status, body }) {
    await this.db.prepare('UPDATE idempotency_keys SET status_code=?,response_body=?::text::jsonb,completed_at=now() WHERE user_id=? AND key=?').run(status, JSON.stringify(body ?? null), userId, key);
  }
}

export function adaptRoutes(definitions, { route, json, readJson, transactions, idempotency }) {
  return definitions.map((def) => {
    const legacy = route(def.method, def.path, def.permission ?? 'authenticated', async ({ req, res, url, params, user, ip }) => {
      const body = def.body ? validate(def.body, await readJsonObject(req, readJson)) : undefined;
      const query = def.query ? validateQuery(def.query, url.searchParams) : undefined;
      const ctx = { req, res, url, params, user, ip, body, query };
      const key = req.headers['idempotency-key'];
      if (def.idempotency === 'required' && !key) throw validationFailed('An Idempotency-Key header is required for this request.', { header: 'Idempotency-Key' });
      if (def.idempotency && key) {
        if (typeof key !== 'string' || key.length < 8 || key.length > 200) throw validationFailed('Idempotency-Key must be 8 to 200 characters.');
        const requestHash = sha256(canonicalJson({ path: url.pathname, body: body ?? null }));
        const result = await transactions.run(user, `${def.method} ${def.path}`, async () => {
          const claim = await idempotency.claim({ userId: user.id, key, method: def.method, path: url.pathname, requestHash });
          if (!claim.claimed) {
            const e = claim.existing;
            if (e.request_sha256 !== requestHash || e.method !== def.method || e.path !== url.pathname) throw conflict('This Idempotency-Key was already used for a different request.', 'IDEMPOTENCY_KEY_REUSED');
            return { replay: true, status: e.status_code, body: e.response_body };
          }
          const out = await def.handler(ctx);
          const status = out?.status ?? 200;
          const responseBody = out?.body ?? { data: out?.data ?? null };
          await idempotency.complete({ userId: user.id, key, status, body: responseBody });
          return { replay: false, status, body: responseBody, headers: out?.headers };
        });
        json(res, result.status, result.body, { ...(result.headers || {}), ...(result.replay ? { 'idempotent-replay': 'true' } : {}) });
        return;
      }
      const out = await def.handler(ctx);
      if (out?.raw) return; // handler wrote the response itself (file downloads)
      json(res, out?.status ?? 200, out?.body ?? { data: out?.data ?? null }, out?.headers || {});
    });
    legacy.mfaExempt = Boolean(def.mfaExempt);
    return legacy;
  });
}

async function readJsonObject(req, readJson) {
  const body = await readJson(req);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new AppError(422, 'VALIDATION_FAILED', 'Request body must be a JSON object.');
  return body;
}

/** Standard pagination query fields. */
export function pageOf(query) {
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const paginated = (rows, total, { page, pageSize }) => ({ data: rows, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
