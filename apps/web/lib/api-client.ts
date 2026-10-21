export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: 'EXECUTIVE' | 'MANAGER' | 'ACCOUNTS' | 'OWNER';
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  primaryPermissions: string[];
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CurrentUserResponse {
  user: CurrentUser;
  permissions: string[];
  csrfToken: string;
}

interface ApiErrorResponse {
  error: string;
}

export type CurrentUserResult =
  | { kind: 'authenticated'; user: CurrentUser }
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiError(value: unknown): value is ApiErrorResponse {
  return isRecord(value) && typeof value.error === 'string';
}

function isCurrentUserResponse(value: unknown): value is CurrentUserResponse {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  const user = value.user;
  const roleValid = ['EXECUTIVE', 'MANAGER', 'ACCOUNTS', 'OWNER'].includes(String(user.role));
  const statusValid = ['ACTIVE', 'INACTIVE', 'LOCKED'].includes(String(user.status));
  return Number.isSafeInteger(user.id) && typeof user.name === 'string' && typeof user.email === 'string'
    && (user.phone === null || typeof user.phone === 'string') && roleValid && statusValid
    && Array.isArray(user.primaryPermissions) && user.primaryPermissions.every((permission) => typeof permission === 'string')
    && typeof user.mustChangePassword === 'boolean' && typeof user.createdAt === 'string' && typeof user.updatedAt === 'string'
    && Array.isArray(value.permissions) && value.permissions.every((permission) => typeof permission === 'string')
    && typeof value.csrfToken === 'string';
}

export async function getCurrentUser(): Promise<CurrentUserResult> {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const body: unknown = await response.json();
    if (response.status === 401 && isApiError(body)) return { kind: 'unauthenticated', message: body.error };
    if (!response.ok) return { kind: 'error', message: isApiError(body) ? body.error : `Request failed (${response.status}).` };
    if (!isCurrentUserResponse(body)) return { kind: 'error', message: 'The backend returned an unexpected response.' };
    return { kind: 'authenticated', user: body.user };
  } catch {
    return { kind: 'error', message: 'The API could not be reached. Check that the backend is running.' };
  }
}
