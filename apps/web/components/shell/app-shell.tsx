'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, ErrorState, Icon, IconButton, Kbd, Menu, Spinner, useAsync, useHotkey } from '@/components/ds';
import { formatRelative, initials } from '@/lib/format';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { usePreferences, type ThemeChoice } from '@/lib/preferences';
import { useScope, type PeriodKey } from '@/lib/scope';
import { CommandPalette } from './command-palette';
import { NAV, type BadgeKey } from './nav-config';

type Badges = Partial<Record<BadgeKey | 'unreadNotifications', number>>;
interface Notification { id: string; type: string; title: string; message: string; read: boolean; createdAt: string }

/** Authenticated layout. Navigation is filtered by role as a convenience; the server enforces every permission. */
export function AppShell({ children }: { children: ReactNode }) {
  const { state, can, logout, refresh } = useSession();
  const api = useApi();
  const pathname = usePathname();
  const router = useRouter();
  const { preferences, update } = usePreferences();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [badges, reloadBadges] = useAsync(() => state.kind === 'ready' ? api.data<Badges>('GET', '/api/v1/me/badges') : Promise.resolve({} as Badges), [state.kind, pathname]);

  useHotkey('k', () => setPaletteOpen(true));
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => {if(NAV.find(group=>group.label==='Admin')?.items.some(item=>pathname===item.href))setAdminOpen(true);},[pathname]);
  useEffect(() => {
    if (state.kind === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (state.kind === 'ready' && state.mfa.required && !state.mfa.verified) router.replace('/login');
  }, [state, router, pathname]);
  useEffect(() => { const t = setInterval(reloadBadges, 60_000); return () => clearInterval(t); }, [reloadBadges]);

  if (state.kind === 'loading' || state.kind === 'anonymous') return <main className="ds-state" style={{ minHeight: '100vh' }}><Spinner size="lg" /><p>Opening ControlDesk…</p></main>;
  if (state.kind === 'error') return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><ErrorState error={new Error(state.message)} onRetry={() => void refresh()} /></main>;

  const counts: Badges = badges.status === 'ready' ? badges.data : badges.data ?? {};
  const collapsed = preferences.sidebarCollapsed;
  const activeScreen = NAV.flatMap(group=>group.items).filter(item=>pathname===item.href||pathname.startsWith(`${item.href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.label ?? 'Workspace';

  return (
    <div className="ds-app" data-collapsed={collapsed}>
      <a className="skip-link" href="#main">Skip to content</a>
      {drawerOpen && <div className="ds-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <nav className="ds-sidebar" data-open={drawerOpen} id="app-sidebar" aria-label="Main">
        <Link href="/dashboard" className="ds-brand">
          <span className="ds-brand-mark" aria-hidden="true">ME</span>
          <span className="ds-brand-text"><strong>ControlDesk</strong><small>Mehta Electronics</small></span>
        </Link>
        <div className="ds-nav">
          {NAV.map((group) => {
            const items = group.items.filter((i) => i.permission === 'authenticated' || can(i.permission));
            if (!items.length) return null;
            return (
              <div key={group.label} className="ds-nav">
                {group.label==='Admin'?<button type="button" className="ds-nav-group ds-nav-group-toggle" aria-expanded={adminOpen||collapsed} onClick={()=>setAdminOpen(value=>!value)}>Administration<Icon name={adminOpen?'chevronDown':'chevronRight'}/></button>:<p className="ds-nav-group">{group.label}</p>}
                {(group.label!=='Admin'||adminOpen||collapsed)&&items.map((item) => {
                  const count = item.badge ? counts[item.badge] : undefined;
                  const current = pathname === item.href || (item.href !== '/tally' && pathname.startsWith(`${item.href}/`));
                  const content = <><Icon name={item.icon} /><span className="ds-nav-label">{item.label}</span>{!!count && <span className="ds-nav-badge" data-tone={item.badgeTone} aria-label={`${count} pending`}>{count > 99 ? '99+' : count}</span>}</>;
                  return <Link key={item.href} className="ds-nav-link" href={item.href} aria-current={current ? 'page' : undefined} title={collapsed ? item.label : undefined}>{content}</Link>;
                })}
              </div>
            );
          })}
        </div>
        <div className="ds-sidebar-footer ds-desktop-only">
          <div className="ds-workspace-id"><span aria-hidden="true">ME</span><div><strong>Mehta Electronics</strong><small>Business workspace</small></div></div>
        </div>
      </nav>

      <div className="ds-main-column">
        <header className="ds-topbar">
          <IconButton className="ds-mobile-only" icon="menu" label="Open navigation" aria-expanded={drawerOpen} aria-controls="app-sidebar" onClick={() => setDrawerOpen(true)} />
          <IconButton className="ds-desktop-only" icon="sidebar" label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => update({ sidebarCollapsed: !collapsed })} />
          <div className="ds-topbar-context"><span className="subtle">Workspace</span><Icon name="chevronRight"/><strong>{activeScreen}</strong></div>
          <button type="button" className="ds-topbar-search" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Control+K">
            <Icon name="search" /><span className="truncate">Search customers, quotes, items…</span><span className="ds-desktop-only"><Kbd>Ctrl</Kbd> <Kbd>K</Kbd></span>
          </button>
          <div className="ds-topbar-actions">
            <ScopePicker />
            <Notifications unread={counts.unreadNotifications ?? 0} onRead={reloadBadges} />
            <ThemeMenu value={preferences.theme} onChange={(theme) => update({ theme })} />
            <Menu label="Account" trigger={(t) => <button type="button" className="ds-icon-button" aria-label={`Account: ${initials(state.user.name)} — ${state.user.name}`} {...t}><span aria-hidden="true"><Avatar name={state.user.name} /></span></button>}>
              <div className="ds-menu-label">{state.user.name}<br /><span style={{ textTransform: 'none', letterSpacing: 0 }}>{state.user.email} · {state.user.role.toLowerCase()}</span></div>
              <Link className="ds-menu-item" role="menuitem" href="/settings"><Icon name="settings" />Settings</Link>
              <div className="ds-menu-sep" />
              <button type="button" className="ds-menu-item" role="menuitem" onClick={() => void logout().then(() => router.replace('/login'))}><Icon name="logout" />Sign out</button>
            </Menu>
          </div>
        </header>
        <main className="ds-content" id="main" tabIndex={-1}>{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function ThemeMenu({ value, onChange }: { value: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
  const options: { id: ThemeChoice; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [{ id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }, { id: 'system', label: 'Match system', icon: 'monitor' }];
  const current = options.find((o) => o.id === value) ?? options[2];
  return (
    <Menu label="Theme" trigger={(t) => <IconButton icon={current.icon} label={`Theme: ${current.label}`} {...t} />}>
      <p className="ds-menu-label">Theme</p>
      {options.map((o) => <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === value} className="ds-menu-item" onClick={() => onChange(o.id)}><Icon name={o.icon} />{o.label}{o.id === value && <Icon name="check" style={{ marginInlineStart: 'auto' }} />}</button>)}
    </Menu>
  );
}

function ScopePicker() {
  const { companies, companyId, setCompanyId, period, setPeriod } = useScope();
  const periods: { key: PeriodKey; label: string }[] = [{ key: 'month', label: 'This month' }, { key: 'last30', label: 'Last 30 days' }, { key: 'quarter', label: 'This quarter' }, { key: 'fy', label: 'This financial year' }];
  const company = companies.find((c) => c.id === companyId);
  return (
    <Menu label="Company and period" trigger={(t) => (
      <button type="button" className="ds-button ds-desktop-only" data-variant="ghost" data-size="sm" {...t}>
        <Icon name="calendar" /><span className="truncate" style={{ maxWidth: 'var(--layout-card-min)' }}>{company ? `${company.display_name} · ` : ''}{period.label}</span><Icon name="chevronDown" />
      </button>
    )}>
      {companies.length > 0 && <><p className="ds-menu-label">Tally company</p>
        {companies.map((c) => <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === companyId} className="ds-menu-item" onClick={() => setCompanyId(c.id)}><span className="truncate">{c.display_name}</span></button>)}
        <div className="ds-menu-sep" /></>}
      <p className="ds-menu-label">Period</p>
      {periods.map((p) => <button key={p.key} type="button" role="menuitemradio" aria-checked={p.key === period.key} className="ds-menu-item" onClick={() => setPeriod(p.key)}>{p.label}</button>)}
    </Menu>
  );
}

function Notifications({ unread, onRead }: { unread: number; onRead: () => void }) {
  const api = useApi();
  const [items, setItems] = useState<Notification[] | null>(null);
  const load = () => { api.data<Notification[]>('GET', '/api/v1/notifications').then(setItems).catch(() => setItems([])); };
  return (
    <Menu label="Notifications" trigger={(t) => <IconButton icon="bell" label={unread ? `Notifications, ${unread} unread` : 'Notifications'} dot={unread > 0} {...t} onClick={() => { t.onClick(); load(); }} />}>
      <p className="ds-menu-label">Notifications</p>
      {items === null && <div className="ds-menu-item"><Spinner /></div>}
      {items?.length === 0 && <p className="ds-menu-item muted">You’re all caught up.</p>}
      {items?.slice(0, 8).map((n) => (
        <button key={n.id} type="button" className="ds-menu-item" style={{ alignItems: 'flex-start', paddingBlock: 'var(--space-1)', height: 'auto' }}
          onClick={() => { if (!n.read) void api.post(`/api/v1/notifications/${n.id}/read`, {}).then(onRead); }}>
          <Icon name={n.type === 'ESCALATION' ? 'alert' : 'bell'} />
          <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}><strong className={n.read ? 'muted' : undefined}>{n.title}</strong><span className="ds-cell-secondary">{formatRelative(n.createdAt)}</span></span>
        </button>
      ))}
    </Menu>
  );
}
