'use client';

import type { ReactNode } from 'react';
import { ApiProvider } from '@/lib/api/provider';
import { SessionProvider } from '@/lib/session';
import { PreferencesProvider } from '@/lib/preferences';
import { ScopeProvider } from '@/lib/scope';
import { ToastProvider } from '@/components/ds';

/** Dependency order: API → session → preferences (theme) → scope → toasts. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApiProvider>
      <SessionProvider>
        <PreferencesProvider>
          <ScopeProvider>
            <ToastProvider>{children}</ToastProvider>
          </ScopeProvider>
        </PreferencesProvider>
      </SessionProvider>
    </ApiProvider>
  );
}
