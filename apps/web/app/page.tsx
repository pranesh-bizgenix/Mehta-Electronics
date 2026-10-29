'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { ErrorState, LoadingState } from '@/components/ui';

export default function HomePage() {
  const { state, refresh } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.kind === 'anonymous') router.replace('/login');
    if (state.kind === 'ready') router.replace(state.mfa.required && !state.mfa.verified ? '/login' : '/work');
  }, [state, router]);
  return <main className="auth">{state.kind === 'error' ? <ErrorState error={new Error(state.message)} onRetry={() => void refresh()} /> : <LoadingState label="Opening ControlDesk" />}</main>;
}
