'use client';

import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes
} from 'react';
import { ApiError, type FieldIssue } from '@/lib/api';

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean };
/** Disabled and marked busy while a request runs, so a double click never submits twice. */
export function Button({ variant = 'primary', busy = false, disabled, children, type = 'button', className = '', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={`btn btn-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
interface FieldProps { label: string; error?: string; hint?: string; required?: boolean; children: (id: string, describedBy: string | undefined) => ReactNode }
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {children(id, describedBy)}
      {hint && <p id={hintId} className="field-hint">{hint}</p>}
      {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function TextInput({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return <Field label={label} error={error} hint={hint} required={rest.required}>{(id, d) => <input id={id} aria-describedby={d} aria-invalid={Boolean(error) || undefined} {...rest} />}</Field>;
}
export function TextArea({ label, error, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }) {
  return <Field label={label} error={error} hint={hint} required={rest.required}>{(id, d) => <textarea id={id} aria-describedby={d} aria-invalid={Boolean(error) || undefined} {...rest} />}</Field>;
}
export function Select({ label, error, hint, options, placeholder, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={rest.required}>
      {(id, d) => (
        <select id={id} aria-describedby={d} aria-invalid={Boolean(error) || undefined} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Maps server field issues (details.fields) to a { field: message } lookup. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.fields.map((f: FieldIssue) => [f.path, f.message]));
}

// ---------------------------------------------------------------------------
// Status badge and timeline
// ---------------------------------------------------------------------------
const TONES: Record<string, string> = {
  OPEN: 'info', NEW: 'info', DRAFT: 'neutral', IN_PROGRESS: 'info', WAITING: 'warn', PENDING: 'warn', PENDING_APPROVAL: 'warn', FORWARDED: 'neutral',
  APPROVED: 'ok', DONE: 'ok', SENT: 'ok', MET: 'ok', RUNNING: 'info', ACTIVE: 'ok', ON: 'ok', READY: 'ok',
  REJECTED: 'bad', BREACHED: 'bad', FAILED: 'bad', CANCELLED: 'neutral', INACTIVE: 'neutral', OFF: 'neutral', NOT_CONFIGURED: 'warn', BLOCKED: 'bad', SENDING: 'warn'
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = TONES[status] ?? 'neutral';
  return <span className={`badge badge-${tone}`}>{label ?? status.replace(/_/g, ' ').toLowerCase()}</span>;
}

export interface TimelineEntry { id: string | number; title: string; at: string; by?: string | null; detail?: ReactNode }
export function Timeline({ items }: { items: TimelineEntry[] }) {
  if (!items.length) return <p className="muted">No history yet.</p>;
  return (
    <ol className="timeline">
      {items.map((item) => (
        <li key={item.id}>
          <p className="timeline-title">{item.title}</p>
          <p className="timeline-meta"><time dateTime={item.at}>{formatDateTime(item.at)}</time>{item.by ? ` · ${item.by}` : ''}</p>
          {item.detail && <div className="timeline-detail">{item.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Page states: loading, empty, error, unauthorized
// ---------------------------------------------------------------------------
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <div className="state" role="status" aria-live="polite"><span className="spinner large" aria-hidden="true" /><p>{label}…</p></div>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="state state-empty"><p className="state-title">{title}</p>{children && <div className="muted">{children}</div>}</div>;
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  if (error instanceof ApiError && error.isForbidden) return <UnauthorizedState message={message} />;
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">Could not load this page</p>
      <p>{message}</p>
      {error instanceof ApiError && error.code === 'INTERNAL' && <p className="muted">Reference: {String((error.details as { correlationId?: string } | undefined)?.correlationId ?? '')}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export function UnauthorizedState({ message = 'Your role does not have access to this page.' }: { message?: string }) {
  return <div className="state state-locked" role="alert"><p className="state-title">No access</p><p>{message}</p><p className="muted">Ask the owner to change your role permissions in Users &amp; Roles.</p></div>;
}

// ---------------------------------------------------------------------------
// Async data hook
// ---------------------------------------------------------------------------
export type Async<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): [Async<T>, () => void] {
  const [state, setState] = useState<Async<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    loader.current().then((data) => { if (live) setState({ status: 'ready', data }); }, (error: unknown) => { if (live) setState({ status: 'error', error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [state, useCallback(() => setTick((t) => t + 1), [])];
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface Toast { id: number; tone: 'ok' | 'bad' | 'info'; message: string }
const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 9000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'bad' ? 'alert' : 'status'}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------------------
// Modal (accessible dialog) and reason prompt
// ---------------------------------------------------------------------------
export function Modal({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <div className="modal-body">
          <header className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button></header>
          <div className="modal-content">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Every state change asks for a reason; this dialog collects it and runs the action once. */
export function ReasonDialog({ open, title, confirmLabel = 'Confirm', danger, onClose, onConfirm, children }: {
  open: boolean; title: string; confirmLabel?: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void>; children?: ReactNode
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setReason(''); setError(undefined); } }, [open]);
  const submit = async () => {
    if (reason.trim().length < 3) { setError('Give a reason of at least 3 characters.'); return; }
    setBusy(true); setError(undefined);
    try { await onConfirm(reason.trim()); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The action failed.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} onClose={() => !busy && onClose()} footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={() => void submit()}>{confirmLabel}</Button>
    </>}>
      {children}
      <TextArea label="Reason" required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} error={error} hint="Recorded in the audit trail." />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Data table with server pagination (stacks into cards on narrow screens)
// ---------------------------------------------------------------------------
export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; className?: string }
export function DataTable<T>({ columns, rows, rowKey, caption, empty, onRowClick }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; caption: string; empty?: ReactNode; onRowClick?: (row: T) => void }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.className}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}>
              {columns.map((c) => <td key={c.key} data-label={c.header} className={c.className}>{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  if (pages <= 1) return <p className="pagination muted">{total} record{total === 1 ? '' : 's'}</p>;
  return (
    <nav className="pagination" aria-label="Pagination">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages} · {total} records</span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </nav>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
