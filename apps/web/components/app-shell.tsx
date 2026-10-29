'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { Button, ErrorState, LoadingState } from '@/components/ui';

interface NavItem { href: string; label: string; permission: string }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Work', items: [
    { href: '/work', label: 'My work', permission: 'work.read' },
    { href: '/tasks', label: 'Task board', permission: 'tasks.read' },
    { href: '/exceptions', label: 'Exception queue', permission: 'exceptions.read' },
    { href: '/messages', label: 'Outbound drafts', permission: 'outbound.read' }
  ] },
  { group: 'Control', items: [
    { href: '/rules', label: 'Rules', permission: 'rules.read' },
    { href: '/automation', label: 'Automation switches', permission: 'automation.read' },
    { href: '/users', label: 'Users & roles', permission: 'users.read' },
    { href: '/audit', label: 'Audit trail', permission: 'audit.read' }
  ] }
];

/** Authenticated layout: redirects to sign-in, hides links the role cannot use (the server still enforces every permission). */
export function AppShell({ children }: { children: ReactNode }) {
  const { state, can, logout, refresh } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.kind === 'anonymous') router.replace('/login');
    if (state.kind === 'ready' && state.mfa.required && !state.mfa.verified) router.replace('/login');
  }, [state, router]);
  useEffect(() => { setOpen(false); }, [pathname]);

  if (state.kind === 'loading' || state.kind === 'anonymous') return <main className="auth"><LoadingState label="Checking your session" /></main>;
  if (state.kind === 'error') return <main className="auth"><ErrorState error={new Error(state.message)} onRetry={() => void refresh()} /></main>;

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="sidebar" data-open={open} aria-label="Main navigation" id="sidebar">
        <div className="brand"><div className="brand-mark" aria-hidden="true">M</div><div><small>MEHTA SIEMENS</small><strong>ControlDesk</strong></div></div>
        <div className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => can(i.permission));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <p className="nav-group">{g.group}</p>
                {items.map((i) => <Link key={i.href} href={i.href} aria-current={pathname.startsWith(i.href) ? 'page' : undefined}>{i.label}</Link>)}
              </div>
            );
          })}
          <p className="nav-group">Existing CRM</p>
          <a href={process.env.NEXT_PUBLIC_LEGACY_CRM_URL ?? "http://127.0.0.1:3000/"} rel="noopener">Customers, quotes and orders</a>
        </div>
        <div className="sidebar-footer">
          <span><strong>{state.user.name}</strong><br /><span className="muted">{state.user.role.toLowerCase()}</span></span>
          <Button variant="secondary" onClick={() => void logout().then(() => router.replace('/login'))}>Sign out</Button>
        </div>
      </nav>
      <div>
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>≡</button>
          <strong>ControlDesk</strong>
          <span className="muted">{state.user.name.split(' ')[0]}</span>
        </header>
        <main className="main" id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
