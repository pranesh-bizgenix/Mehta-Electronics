import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { Spinner } from '@/components/ds';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="ds-state"><Spinner /><p>Opening your workspace...</p></main>}><AppShell>{children}</AppShell></Suspense>;
}
