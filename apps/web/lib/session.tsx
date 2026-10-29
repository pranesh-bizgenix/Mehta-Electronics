'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from './api';

export interface SessionUser { id: number; name: string; email: string; role: string; status: string; mustChangePassword: boolean }
export interface MfaState { required: boolean; enrolled: boolean; verified: boolean }
interface MeResponse { user: SessionUser; permissions: string[]; csrfToken: string; mfa: MfaState }

type SessionState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; user: SessionUser; permissions: string[]; mfa: MfaState };

interface SessionContextValue {
  state: SessionState;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const me = await api<MeResponse>('/api/auth/me');
      setCsrfToken(me.csrfToken);
      setState({ kind: 'ready', user: me.user, permissions: me.permissions, mfa: me.mfa });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setState({ kind: 'anonymous' });
      else setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load your session.' });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<SessionContextValue>(() => ({
    state,
    refresh,
    can: (permission) => state.kind === 'ready' && (state.permissions.includes('*') || state.permissions.includes(permission)),
    logout: async () => { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } finally { setState({ kind: 'anonymous' }); } }
  }), [state, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider.');
  return ctx;
}
