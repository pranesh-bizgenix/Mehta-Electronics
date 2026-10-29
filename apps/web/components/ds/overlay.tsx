'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from './primitives';
import { TextAreaField } from './fields';

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { opener.current = document.activeElement; dialog.showModal(); }
    if (!open && dialog.open) { dialog.close(); (opener.current as HTMLElement | null)?.focus?.(); }
  }, [open]);
  return ref;
}

interface OverlayProps { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; description?: string }

/** Accessible modal (native <dialog>: focus trap, Esc, inert background). */
export function Modal({ open, title, onClose, children, footer, description, size }: OverlayProps & { size?: 'lg' }) {
  const ref = useDialog(open);
  const titleId = useId();
  return (
    <dialog ref={ref} className="ds-dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {open && (
        <div className="ds-modal" data-size={size}>
          <header className="ds-modal-header"><div><h2 id={titleId}>{title}</h2>{description && <p className="muted">{description}</p>}</div><IconButton icon="x" label="Close" onClick={onClose} /></header>
          <div className="ds-modal-body">{children}</div>
          {footer && <footer className="ds-modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Side drawer for detail views and secondary forms. */
export function Drawer({ open, title, onClose, children, footer, description }: OverlayProps) {
  const ref = useDialog(open);
  const titleId = useId();
  return (
    <dialog ref={ref} className="ds-dialog ds-drawer-dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {open && (
        <div className="ds-drawer">
          <header className="ds-modal-header"><div><h2 id={titleId}>{title}</h2>{description && <p className="muted">{description}</p>}</div><IconButton icon="x" label="Close" onClick={onClose} /></header>
          <div className="ds-modal-body">{children}</div>
          {footer && <footer className="ds-modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Every state change asks for a reason (recorded in the audit trail) and runs once. */
export function ReasonDialog({ open, title, confirmLabel = 'Confirm', danger, onClose, onConfirm, children, description }: {
  open: boolean; title: string; confirmLabel?: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void>; children?: ReactNode; description?: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setReason(''); setError(undefined); } }, [open]);
  const submit = async () => {
    if (reason.trim().length < 3) { setError('Add a short reason (at least 3 characters).'); return; }
    setBusy(true); setError(undefined);
    try { await onConfirm(reason.trim()); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} description={description} onClose={() => !busy && onClose()} footer={<>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={() => void submit()}>{confirmLabel}</Button>
    </>}>
      {children}
      <TextAreaField label="Reason" required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} error={error} hint="Saved in the audit trail with your name." />
    </Modal>
  );
}

/** Small dropdown menu anchored to its trigger. */
export function Menu({ trigger, children, align = 'end', label }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: ReactNode; align?: 'start' | 'end'; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="ds-anchor" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && <div className="ds-popover" role="menu" aria-label={label} data-align={align} style={{ top: 'calc(100% + var(--space-0-5))' }} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
