'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { ErrorState, Spinner } from '@/components/ds';

export default function HomePage() {
  const { state, refresh } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.kind === 'anonymous') router.replace('/login');
    if (state.kind === 'ready') router.replace(state.mfa.required && !state.mfa.verified ? '/login' : '/dashboard');
  }, [state, router]);
  return (
    <main className="ds-state" style={{ minHeight: '100vh' }}>
      {state.kind === 'error' ? <ErrorState error={new Error(state.message)} onRetry={() => void refresh()} /> : <><Spinner size="lg" /><p>Opening ControlDesk…</p></>}
    </main>
  );
}
