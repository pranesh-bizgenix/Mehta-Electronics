'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/client';
import { SuccessCheck } from './icons';
import { Button, IconButton, Skeleton } from './primitives';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type ToastTone = 'success' | 'danger' | 'info';
interface ToastItem { id: number; tone: ToastTone; message: string }
const ToastContext = createContext<(tone: ToastTone, message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone: ToastTone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => dismiss(id), tone === 'danger' ? 9000 : 4500);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="ds-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="ds-toast" data-tone={t.tone} role={t.tone === 'danger' ? 'alert' : 'status'}>
            {t.tone === 'success' && <SuccessCheck />}
            <p>{t.message}</p>
            <IconButton icon="x" label="Dismiss" onClick={() => dismiss(t.id)} style={{ width: 'var(--control-sm)', height: 'var(--control-sm)' }} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------------------
// Illustrations (single-colour line art that follows the theme)
// ---------------------------------------------------------------------------
const ILLUSTRATIONS = {
  empty: <><rect x="20" y="34" width="80" height="62" rx="10" opacity=".15" fill="currentColor" /><path d="M20 58h22l6 10h24l6-10h22" /><path d="M34 34l8-14h36l8 14" /><circle cx="92" cy="22" r="6" opacity=".5" /></>,
  search: <><circle cx="52" cy="52" r="26" opacity=".15" fill="currentColor" /><circle cx="52" cy="52" r="26" /><path d="M71 71l22 22" strokeWidth="6" /><path d="M42 52h20" /></>,
  error: <><path d="M60 18l44 78H16z" opacity=".15" fill="currentColor" /><path d="M60 18l44 78H16z" /><path d="M60 48v22M60 82v2" strokeWidth="6" /></>,
  locked: <><rect x="30" y="52" width="60" height="46" rx="10" opacity=".15" fill="currentColor" /><rect x="30" y="52" width="60" height="46" rx="10" /><path d="M42 52V40a18 18 0 0 1 36 0v12" /><circle cx="60" cy="74" r="5" /></>,
  done: <><circle cx="60" cy="60" r="38" opacity=".15" fill="currentColor" /><circle cx="60" cy="60" r="38" /><path d="M42 61l12 12 24-26" strokeWidth="6" /></>
} as const;
export type IllustrationName = keyof typeof ILLUSTRATIONS;
export function Illustration({ name }: { name: IllustrationName }) {
  return <svg className="ds-illustration" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ILLUSTRATIONS[name]}</svg>;
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------
export function EmptyState({ title, children, action, illustration = 'empty' }: { title: string; children?: ReactNode; action?: ReactNode; illustration?: IllustrationName }) {
  return <div className="ds-state"><Illustration name={illustration} /><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function UnauthorizedState({ message = 'Your role does not include this page.' }: { message?: string }) {
  return (
    <div className="ds-state" role="alert"><Illustration name="locked" /><h3>You don’t have access</h3><p>{message} Ask the owner to update your role in Users &amp; roles.</p></div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.isForbidden) return <UnauthorizedState message={error.message} />;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const reference = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div className="ds-state" data-tone="danger" role="alert">
      <Illustration name="error" />
      <h3>We couldn’t load this</h3>
      <p>{message}</p>
      {reference && <p className="subtle mono">Reference {reference}</p>}
      {onRetry && <Button variant="secondary" icon="refresh" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Skeleton rows that match the table layout they stand in for. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="stack-sm" style={{ padding: 'var(--space-2)' }} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="cluster" style={{ flexWrap: 'nowrap' }}>{Array.from({ length: columns }, (_, c) => <Skeleton key={c} width={`${c === 0 ? 28 : 100 / columns}%`} height="var(--space-2)" />)}</div>
      ))}
    </div>
  );
}
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return <div className="ds-card ds-card-pad stack-sm" role="status" aria-label="Loading"><Skeleton width="40%" height="var(--space-2)" />{Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={`${90 - i * 15}%`} />)}</div>;
}
