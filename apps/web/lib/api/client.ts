// Typed API client. Features depend on the ApiClient interface, never on
// fetch directly, so tests and previews can inject a fake implementation.

export interface FieldIssue { path: string; message: string }
export interface Pagination { page: number; pageSize: number; total: number; pages: number }
export interface Paginated<T> { data: T[]; pagination: Pagination }
export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions { query?: Query; idempotencyKey?: string; signal?: AbortSignal }

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  /** Unwraps the { data } envelope used by most endpoints. */
  data<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  setCsrfToken(token: string): void;
}

/** Friendly messages for transport-level failures; server messages are already plain English. */
const FALLBACK: Record<number, string> = {
  0: 'The server could not be reached. Check your connection and try again.',
  401: 'Your session has ended. Sign in again to continue.',
  403: 'Your role does not allow this. Ask the owner if you need access.',
  404: 'This record no longer exists or was moved.',
  409: 'Someone changed this record. Reload to see the latest version.',
  413: 'That file or request is too large.',
  429: 'Too many attempts. Wait a minute and try again.',
  500: 'Something went wrong on the server. Try again; if it keeps happening, share the reference with support.',
  502: 'An external service did not respond. Try again shortly.',
  503: 'The service is temporarily unavailable. Try again shortly.'
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown, readonly correlationId?: string) { super(message); }
  get fields(): FieldIssue[] {
    const d = this.details as { fields?: FieldIssue[] } | undefined;
    return Array.isArray(d?.fields) ? d.fields : [];
  }
  get isUnauthorized(): boolean { return this.status === 401; }
  get isForbidden(): boolean { return this.status === 403 && this.code !== 'MFA_REQUIRED'; }
  get isConflict(): boolean { return this.status === 409; }
  get isRuleNotConfigured(): boolean { return this.code === 'RULE_NOT_CONFIGURED'; }
}

export const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

export class FetchApiClient implements ApiClient {
  private csrf = '';
  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  setCsrfToken(token: string): void { this.csrf = token; }

  get<T>(path: string, options?: RequestOptions) { return this.request<T>('GET', path, undefined, options); }
  post<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('POST', path, body ?? {}, options); }
  put<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('PUT', path, body ?? {}, options); }
  patch<T>(path: string, body?: unknown, options?: RequestOptions) { return this.request<T>('PATCH', path, body ?? {}, options); }
  async data<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await this.request<{ data: T }>(method, path, method === 'GET' ? undefined : body ?? {}, options)).data;
  }

  private async request<T>(method: string, path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    const qs = params.toString();
    const url = qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: options.signal, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'NETWORK', FALLBACK[0]);
    }
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      const p = isRecord(payload) ? payload : {};
      const code = typeof p.code === 'string' ? p.code : 'ERROR';
      const serverMessage = typeof p.error === 'string' && code !== 'INTERNAL' ? p.error : undefined;
      throw new ApiError(response.status, code, serverMessage ?? FALLBACK[response.status] ?? FALLBACK[500], p.details, typeof p.correlationId === 'string' ? p.correlationId : undefined);
    }
    return payload as T;
  }
}
