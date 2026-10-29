'use client';

import Link from 'next/link';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { formatDateTime } from '@/lib/format';

export interface Crumb { label: string; href?: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="ds-breadcrumbs" aria-label="Breadcrumb">
      <ol>{items.map((c, i) => <li key={`${c.label}-${i}`}>{c.href && i < items.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>}</li>)}</ol>
    </nav>
  );
}

/** Breadcrumbs, title, one-line description and the page's primary action. */
export function PageHeader({ title, description, crumbs, actions }: { title: string; description?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode }) {
  return (
    <div className="page-enter">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <header className="ds-page-header">
        <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
        {actions && <div className="ds-page-actions">{actions}</div>}
      </header>
    </div>
  );
}

export function Card({ title, actions, children, padded = true, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean; id?: string }) {
  const headingId = useId();
  return (
    <section className="ds-card" aria-labelledby={title ? headingId : undefined} id={id}>
      {title && <header className="ds-card-header"><h2 id={headingId}>{title}</h2>{actions && <div className="cluster">{actions}</div>}</header>}
      <div className={padded ? 'ds-card-body' : undefined}>{children}</div>
    </section>
  );
}

/** Minimal trend line; no axes or labels (the number is the message). */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / span) * 26 - 2}`).join(' ');
  return (
    <svg className="ds-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={`0,30 ${points} 100,30`} fill="currentColor" opacity="0.12" stroke="none" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({ label, value, title, delta, trend, href, footnote }: {
  label: string; value: ReactNode; title?: string; delta?: { text: string; tone: 'up' | 'down' | 'flat' }; trend?: number[]; href?: string; footnote?: ReactNode;
}) {
  const body = (
    <div className="ds-stat">
      <span className="ds-stat-label">{label}</span>
      <span className="ds-stat-value" title={title}>{value}</span>
      <div className="ds-stat-foot">
        <span>{delta && <span className="ds-delta" data-tone={delta.tone}>{delta.text}</span>}{footnote && <span className="ds-cell-secondary">{footnote}</span>}</span>
        {trend && <Sparkline values={trend} label={`${label} trend`} />}
      </div>
    </div>
  );
  const linkStyle = { color: 'inherit', textDecoration: 'none', display: 'block' } as const;
  return <div className="ds-card">{href ? (/^https?:/.test(href) ? <a href={href} style={linkStyle}>{body}</a> : <Link href={href} style={linkStyle}>{body}</Link>) : body}</div>;
}

export interface TabItem { id: string; label: string; count?: number; icon?: IconName }
/** WAI-ARIA tabs with arrow-key navigation. Render the panel for `value` yourself. */
export function Tabs({ items, value, onChange, label }: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    const next = e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const i = (next + items.length) % items.length;
    refs.current[i]?.focus();
    onChange(items[i].id);
  };
  return (
    <div className="ds-tabs" role="tablist" aria-label={label}>
      {items.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`}
          aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} className="ds-tab" onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.icon && <Icon name={t.icon} />}{t.label}{t.count !== undefined && <span className="ds-nav-badge" data-tone="neutral">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>{children}</div>;
}

export interface Step { label: string; detail?: string; state: 'done' | 'current' | 'todo' | 'blocked' }
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className="ds-stepper" aria-label={label} tabIndex={0}>
      {steps.map((s) => (
        <li key={s.label} className="ds-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <strong>{s.label}</strong>{s.detail && <span>{s.detail}</span>}
          <span className="sr-only">{{ done: 'completed', current: 'current step', todo: 'not started', blocked: 'blocked' }[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}

export interface TimelineEntry { id: string | number; title: ReactNode; at: string | null; by?: string | null; body?: ReactNode; icon?: IconName; tone?: 'success' | 'danger' | 'warning' }
export function Timeline({ items, empty = 'No history yet.' }: { items: TimelineEntry[]; empty?: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ol className="ds-timeline">
      {items.map((e) => (
        <li key={e.id} className="ds-timeline-item">
          <span className="ds-timeline-dot" data-tone={e.tone}><Icon name={e.icon ?? 'clock'} /></span>
          <div>
            <p className="ds-timeline-title">{e.title}</p>
            <p className="ds-timeline-meta"><time dateTime={e.at ?? undefined}>{formatDateTime(e.at)}</time>{e.by ? ` · ${e.by}` : ''}</p>
            {e.body && <div className="ds-timeline-body">{e.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="ds-facts">{items.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value ?? '—'}</dd></div>)}</dl>;
}
