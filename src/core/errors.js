// Application errors carry an HTTP status and a stable machine-readable code.
// The HTTP layer turns them into { error, code, details? }; anything else is a 500
// with a generic message (no stack traces or internal messages reach users).

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission for this action.', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, code = 'CONFLICT', details) => new AppError(409, code, message, details);
export const validationFailed = (message, details) => new AppError(422, 'VALIDATION_FAILED', message, details);
export const unavailable = (message, code = 'UNAVAILABLE') => new AppError(503, code, message);

/** Raised when a workflow needs an owner-configured rule that has not been set. */
export const ruleNotConfigured = (ruleKey, label) =>
  new AppError(409, 'RULE_NOT_CONFIGURED', `Rule not configured: ${label}. The owner must set it in Rules before this workflow can continue.`, { rule: ruleKey });

/** Maps an error to a safe response body. */
export function errorBody(error, correlationId) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  // Unexpected errors (no deliberate status) never expose their message.
  if (!Number.isInteger(error?.status)) {
    return { status, body: { error: 'Internal server error.', code: 'INTERNAL', correlationId } };
  }
  const body = { error: error.message || 'Request failed.', code: error.code || codeFor(status) };
  if (error.details !== undefined) body.details = error.details;
  if (status >= 500) body.correlationId = correlationId;
  return { status, body };
}

function codeFor(status) {
  return { 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMITED' }[status] || 'ERROR';
}
