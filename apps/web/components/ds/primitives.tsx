'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { formatRelative, initials, titleCase } from '@/lib/format';

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; busy?: boolean; icon?: IconName; iconEnd?: IconName; block?: boolean;
};

/** While `busy`, the button is disabled so a double click never submits twice. */
export function Button({ variant = 'primary', size = 'md', busy = false, icon, iconEnd, block, disabled, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={`ds-button ${rest.className ?? ''}`} data-variant={variant} data-size={size} data-block={block || undefined}
      disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="ds-spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
      {iconEnd && !busy && <Icon name={iconEnd} />}
    </button>
  );
}

export function IconButton({ icon, label, dot, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; dot?: boolean }) {
  return (
    <button type="button" {...rest} className={`ds-icon-button ${rest.className ?? ''}`} aria-label={label} title={label}>
      <Icon name={icon} />
      {dot && <span className="ds-dot" aria-hidden="true" />}
    </button>
  );
}

export function Spinner({ size }: { size?: 'lg' }) { return <span className="ds-spinner" data-size={size} role="status" aria-label="Loading" />; }
export function Kbd({ children }: { children: ReactNode }) { return <kbd className="ds-kbd">{children}</kbd>; }

// ---------------------------------------------------------------------------
// Tooltip and truncation
// ---------------------------------------------------------------------------
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return <span className="ds-tooltip-wrap">{children}<span role="tooltip" className="ds-tooltip">{content}</span></span>;
}

/** Long text: truncated to one line, full value in the tooltip and to screen readers. */
export function Truncate({ text, className = '' }: { text: string | null | undefined; className?: string }) {
  const value = text ?? '—';
  return <span className={`truncate ${className}`} title={value} style={{ display: 'block' }}>{value}</span>;
}

// ---------------------------------------------------------------------------
// Badges, margin flags, SLA chip, avatars
// ---------------------------------------------------------------------------
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success', APPROVED: 'success', DONE: 'success', SENT: 'success', WON: 'success', ACCEPTED: 'success', DELIVERED: 'success', MET: 'success', ON: 'success', RECEIVED: 'success', CONNECTED: 'success', COMPLETED: 'success', READY: 'success',
  OPEN: 'info', NEW: 'info', IN_PROGRESS: 'info', RUNNING: 'info', QUALIFIED: 'info', ISSUED: 'info', DISPATCHED: 'info', PARTIALLY_DISPATCHED: 'info', CONFIRMED: 'info', PROCESSING: 'info', QUOTED: 'info',
  PENDING: 'warning', PENDING_APPROVAL: 'warning', WAITING: 'warning', HELD: 'warning', NOT_CONFIGURED: 'warning', SENDING: 'warning', PARTIALLY_RECEIVED: 'warning', EXPIRED: 'warning', ON_HOLD: 'warning', LOCKED: 'warning',
  REJECTED: 'danger', BREACHED: 'danger', FAILED: 'danger', LOST: 'danger', BLOCKED: 'danger', OVERDUE: 'danger',
  DRAFT: 'neutral', FORWARDED: 'neutral', CANCELLED: 'neutral', INACTIVE: 'neutral', OFF: 'neutral', ARCHIVED: 'neutral', STOPPED: 'neutral', WITHDRAWN: 'neutral'
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className="ds-badge" data-tone={tone}>{children}</span>;
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label ?? titleCase(status)}</Badge>;
}

/** BR-02 margin flag: green = OK, blue = cost-to-cost, red = below cost. */
export function MarginFlag({ flag, children }: { flag: 'green' | 'blue' | 'red'; children?: ReactNode }) {
  const label = { green: 'Margin OK', blue: 'Cost to cost', red: 'Below cost' }[flag];
  return <span className="ds-flag" data-flag={flag}>{children ?? label}</span>;
}

/** Countdown to a due time; turns amber within the warning window and red when breached. */
export function SlaChip({ dueAt, state, now = new Date(), warnMinutes = 120 }: { dueAt: string | null; state?: string; now?: Date; warnMinutes?: number }) {
  if (state === 'NOT_CONFIGURED' || !dueAt) return <span className="ds-sla" title="The owner has not set an SLA for this record type.">SLA not set</span>;
  const minutes = Math.round((new Date(dueAt).getTime() - now.getTime()) / 60000);
  const tone = minutes < 0 || state === 'BREACHED' ? 'breached' : minutes <= warnMinutes ? 'soon' : 'ok';
  return <span className="ds-sla" data-state={tone} title={`Due ${new Date(dueAt).toLocaleString('en-IN')}`}><Icon name="clock" />{minutes < 0 ? `Overdue ${formatRelative(dueAt, now).replace(' ago', '')}` : `Due ${formatRelative(dueAt, now)}`}</span>;
}

export function Avatar({ name }: { name: string | null | undefined }) {
  return <span className="ds-avatar" title={name ?? undefined} aria-label={name ?? 'Unknown'}>{initials(name)}</span>;
}
export function AvatarGroup({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return <span className="ds-avatar-group">{shown.map((n) => <Avatar key={n} name={n} />)}{names.length > max && <span className="ds-avatar" aria-label={`${names.length - max} more`}>+{names.length - max}</span>}</span>;
}

// ---------------------------------------------------------------------------
// Notices and skeletons
// ---------------------------------------------------------------------------
export function Notice({ tone = 'info', title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const icon: IconName = tone === 'danger' ? 'alert' : tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return (
    <div className="ds-notice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div className="stack-sm" style={{ flex: '1 1 auto' }}>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
      {action}
    </div>
  );
}

export function Skeleton({ width = '100%', height }: { width?: string; height?: string }) {
  return <span className="ds-skeleton" style={{ width, height: height ?? 'var(--space-1-5)' }} aria-hidden="true" />;
}
