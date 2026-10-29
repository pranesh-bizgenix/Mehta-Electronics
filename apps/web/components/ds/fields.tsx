'use client';

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError, type FieldIssue } from '@/lib/api/client';
import { Icon } from './icons';
import { Button } from './primitives';

interface FieldChrome { label: string; error?: string; hint?: string }

function Chrome({ id, label, error, hint, required, children }: FieldChrome & { id: string; required?: boolean; children: (describedBy: string | undefined) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ds-field" data-invalid={Boolean(error) || undefined}>
      {children(describedBy)}
      {hint && !error && <p id={hintId} className="ds-field-hint">{hint}</p>}
      {error && <p id={errorId} className="ds-field-error" role="alert"><Icon name="alert" />{error}</p>}
      {required && <span className="sr-only">{label} is required.</span>}
    </div>
  );
}

/** Text input with a floating label and inline validation. */
export function TextField({ label, error, hint, required, ...rest }: FieldChrome & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Chrome id={id} label={label} error={error} hint={hint} required={required}>
      {(describedBy) => (
        <div className="ds-float">
          <input {...rest} id={id} placeholder=" " required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} />
          <label htmlFor={id}>{label}{required && <span className="ds-required" aria-hidden="true"> *</span>}</label>
        </div>
      )}
    </Chrome>
  );
}

export function TextAreaField({ label, error, hint, required, ...rest }: FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Chrome id={id} label={label} error={error} hint={hint} required={required}>
      {(describedBy) => (
        <div className="ds-float">
          <textarea {...rest} id={id} placeholder=" " required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} />
          <label htmlFor={id}>{label}{required && <span className="ds-required" aria-hidden="true"> *</span>}</label>
        </div>
      )}
    </Chrome>
  );
}

export interface Option { value: string; label: string; hint?: string }

export function SelectField({ label, error, hint, options, placeholder, required, ...rest }: FieldChrome & SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Chrome id={id} label={label} error={error} hint={hint} required={required}>
      {(describedBy) => (
        <div className="ds-float" data-filled="true">
          <select {...rest} id={id} required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label htmlFor={id}>{label}{required && <span className="ds-required" aria-hidden="true"> *</span>}</label>
        </div>
      )}
    </Chrome>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="ds-check-row"><input type="checkbox" {...rest} /><span>{label}</span></label>;
}

export function Switch({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="ds-switch"><input type="checkbox" role="switch" {...rest} /><span className="ds-switch-track" aria-hidden="true" /><span>{label}</span></label>;
}

/**
 * Searchable select. `search` is called (debounced) as the user types, so it
 * works with server-side lookups over thousands of records.
 */
export function Combobox({ label, value, onChange, search, error, hint, required, placeholder = 'Type to search' }: FieldChrome & {
  value: Option | null; onChange: (option: Option | null) => void; search: (term: string) => Promise<Option[]>; required?: boolean; placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [term, setTerm] = useState(value?.label ?? '');
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => { setTerm(value?.label ?? ''); }, [value?.value, value?.label]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      searchRef.current(term).then((o) => { if (live) { setOptions(o); setActive(0); } }).catch(() => { if (live) setOptions([]); }).finally(() => { if (live) setLoading(false); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [term, open]);

  const choose = (o: Option) => { onChange(o); setTerm(o.label); setOpen(false); };
  return (
    <Chrome id={id} label={label} error={error} hint={hint} required={required}>
      {(describedBy) => (
        <div className="ds-combobox">
          <div className="ds-float">
            <input id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined}
              aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined} placeholder=" " value={term} autoComplete="off"
              onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
              onChange={(e) => { setTerm(e.target.value); setOpen(true); if (value) onChange(null); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); setOpen(true); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active]); }
                if (e.key === 'Escape') setOpen(false);
              }} />
            <label htmlFor={id}>{label}{required && <span className="ds-required" aria-hidden="true"> *</span>}</label>
          </div>
          {open && (
            <ul id={listId} role="listbox" className="ds-listbox" aria-label={label}>
              {loading && <li className="ds-option" aria-disabled="true"><span className="muted">Searching…</span></li>}
              {!loading && options.length === 0 && <li className="ds-option" aria-disabled="true"><span className="muted">{term ? 'No matches' : placeholder}</span></li>}
              {!loading && options.map((o, i) => (
                <li key={o.value} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} className="ds-option" onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
                  <span className="truncate">{o.label}</span>{o.hint && <small className="truncate">{o.hint}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Chrome>
  );
}

export interface DateRange { from: string; to: string }
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** From/to dates with quick presets (this month, last 30 days, this financial year). */
export function DateRangeField({ value, onChange, label = 'Date range' }: { value: DateRange; onChange: (range: DateRange) => void; label?: string }) {
  const today = new Date();
  const fyStart = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
  const presets: { label: string; range: DateRange }[] = [
    { label: 'Last 7 days', range: { from: iso(new Date(today.getTime() - 6 * 864e5)), to: iso(today) } },
    { label: 'Last 30 days', range: { from: iso(new Date(today.getTime() - 29 * 864e5)), to: iso(today) } },
    { label: 'This month', range: { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) } },
    { label: 'This financial year', range: { from: iso(fyStart), to: iso(today) } }
  ];
  return (
    <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="sr-only">{label}</legend>
      <div className="ds-date-range">
        <TextField label="From" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <TextField label="To" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </div>
      <div className="ds-presets">{presets.map((p) => <Button key={p.label} size="sm" variant="ghost" onClick={() => onChange(p.range)}>{p.label}</Button>)}
        {(value.from || value.to) && <Button size="sm" variant="ghost" onClick={() => onChange({ from: '', to: '' })}>Clear</Button>}</div>
    </fieldset>
  );
}

/** Maps server validation details to { field: message }. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.fields.map((f: FieldIssue) => [f.path, `${f.path.split('.').pop()?.replace(/([A-Z])/g, ' $1').toLowerCase()} ${f.message}`.replace(/^./, (c) => c.toUpperCase())]));
}
