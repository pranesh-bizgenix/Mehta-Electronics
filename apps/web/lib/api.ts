// Typed client for the ControlDesk API. Requests go through the Next.js
// rewrite to the existing backend, so cookies, CSRF and sessions are shared.

export interface FieldIssue { path: string; message: string }

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) { super(message); }
  get fields(): FieldIssue[] {
    const d = this.details as { fields?: FieldIssue[] } | undefined;
    return Array.isArray(d?.fields) ? d.fields : [];
  }
  get isUnauthorized(): boolean { return this.status === 401; }
  get isForbidden(): boolean { return this.status === 403 && this.code !== 'MFA_REQUIRED'; }
  get needsMfa(): boolean { return this.code === 'MFA_REQUIRED'; }
}

export interface Paginated<T> { data: T[]; pagination: { page: number; pageSize: number; total: number; pages: number } }

let csrfToken = '';
export function setCsrfToken(token: string): void { csrfToken = token; }

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface RequestOptions { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown; idempotencyKey?: string; query?: Record<string, string | number | boolean | undefined | null> }

function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null; }

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, query } = options;
  const url = new URL(path, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(url.pathname + url.search, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The server could not be reached. Check your connection and try again.');
  }
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const p = isRecord(payload) ? payload : {};
    throw new ApiError(response.status, typeof p.code === 'string' ? p.code : 'ERROR', typeof p.error === 'string' ? p.error : `Request failed (${response.status}).`, p.details);
  }
  return payload as T;
}

/** Unwraps the common { data } envelope. */
export async function apiData<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await api<{ data: T }>(path, options)).data;
}
