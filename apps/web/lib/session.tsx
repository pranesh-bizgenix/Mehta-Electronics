'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from './api/client';
import { useApi } from './api/provider';

export interface SessionUser { id: number; name: string; email: string; role: string; status: string; mustChangePassword: boolean }
export interface MfaState { required: boolean; enrolled: boolean; verified: boolean }
interface MeResponse { user: SessionUser; permissions: string[]; csrfToken: string; mfa: MfaState }

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; user: SessionUser; permissions: string[]; mfa: MfaState };

interface SessionContextValue {
  state: SessionState;
  refresh: () => Promise<void>;
  /** UI hint only: the server enforces every permission. */
  can: (permission: string) => boolean;
  signIn: (email: string, password: string) => Promise<MfaState>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<SessionState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/api/auth/me');
      api.setCsrfToken(me.csrfToken);
      setState({ kind: 'ready', user: me.user, permissions: me.permissions, mfa: me.mfa });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setState({ kind: 'anonymous' });
      else setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load your session.' });
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<SessionContextValue>(() => ({
    state,
    refresh,
    can: (permission) => state.kind === 'ready' && (state.permissions.includes('*') || state.permissions.includes(permission)),
    signIn: async (email, password) => {
      const res = await api.post<MeResponse>('/api/auth/login', { email, password });
      api.setCsrfToken(res.csrfToken);
      if (!res.mfa.required) await refresh();
      return res.mfa;
    },
    logout: async () => {
      try { await api.post('/api/auth/logout', {}); } finally { setState({ kind: 'anonymous' }); }
    }
  }), [state, refresh, api]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider.');
  return ctx;
}
