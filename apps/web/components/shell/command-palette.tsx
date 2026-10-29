'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon, Kbd, type IconName } from '@/components/ds';
import type { ApiClient, Paginated } from '@/lib/api/client';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { usePreferences } from '@/lib/preferences';
import { NAV, LEGACY_SCREENS, legacyUrl } from './nav-config';

interface Hit { id: string; group: string; label: string; hint?: string; icon: IconName; run: () => void }

interface Searchable { group: string; permission: string; icon: IconName; path: string; label: (r: Record<string, unknown>) => string; hint: (r: Record<string, unknown>) => string; href: (r: Record<string, unknown>) => string }
const SOURCES: Searchable[] = [
  { group: 'Customers', permission: 'customers.read', icon: 'customers', path: '/api/crm/customers', label: (r) => String(r.name), hint: (r) => String(r.gstin ?? r.customer_code ?? ''), href: (r) => `/customers/${r.id}` },
  { group: 'Enquiries', permission: 'enquiries.read', icon: 'inbox', path: '/api/crm/enquiries', label: (r) => `${r.enquiry_number} · ${r.subject}`, hint: (r) => String(r.customer_name ?? ''), href: (r) => `/enquiries?open=${r.id}` },
  { group: 'Quotations', permission: 'quotations.read', icon: 'quote', path: '/api/crm/quotations', label: (r) => String(r.quotation_number ?? `Quotation ${r.id}`), hint: (r) => String(r.customer_name ?? ''), href: (r) => `/quotations/${r.id}` },
  { group: 'Items', permission: 'items.read', icon: 'items', path: '/api/crm/items', label: (r) => String(r.part_code), hint: (r) => String(r.description ?? ''), href: (r) => `/items?open=${r.id}` }
];

async function searchRecords(api: ApiClient, sources: Searchable[], term: string, signal: AbortSignal) {
  const results = await Promise.allSettled(sources.map((s) => api.get<Paginated<Record<string, unknown>>>(s.path, { query: { search: term, pageSize: 5 }, signal }).then((r) => ({ s, rows: r.data.slice(0, 5) }))));
  return results.flatMap((r) => r.status === 'fulfilled' ? r.value.rows.map((row) => ({ s: r.value.s, row })) : []);
}

/** Ctrl/Cmd+K: jump to any screen, run an action, or find a customer, enquiry, quotation or item. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const { can } = useSession();
  const { preferences, update } = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [term, setTerm] = useState('');
  const [records, setRecords] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);

  const go = (href: string) => {
    onClose();
    if (LEGACY_SCREENS.has(href.split('?')[0].replace(/\/\d+$/, ''))) window.location.href = legacyUrl();
    else router.push(href);
  };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setTerm(''); setActive(0); setTimeout(() => input.current?.focus(), 0); }
    if (!open && d.open) d.close();
  }, [open]);

  const staticHits = useMemo<Hit[]>(() => {
    const pages = NAV.flatMap((g) => g.items.filter((i) => i.permission === 'authenticated' || can(i.permission)).map((i) => ({ id: `nav-${i.href}`, group: 'Go to', label: i.label, hint: i.keywords, icon: i.icon, run: () => go(i.href) })));
    const actions: Hit[] = [
      ...(can('enquiries.create') ? [{ id: 'a-enquiry', group: 'Actions', label: 'New enquiry', icon: 'plus' as IconName, run: () => go('/enquiries?new=1') }] : []),
      ...(can('quotations.create') ? [{ id: 'a-quote', group: 'Actions', label: 'New quotation', icon: 'plus' as IconName, run: () => go('/quotations/new') }] : []),
      ...(can('customers.create') ? [{ id: 'a-customer', group: 'Actions', label: 'New customer', icon: 'plus' as IconName, run: () => go('/customers?new=1') }] : []),
      ...(can('tasks.write') ? [{ id: 'a-task', group: 'Actions', label: 'New task', icon: 'plus' as IconName, run: () => go('/tasks?new=1') }] : []),
      { id: 'a-theme', group: 'Actions', label: preferences.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: preferences.theme === 'dark' ? 'sun' : 'moon', run: () => { update({ theme: preferences.theme === 'dark' ? 'light' : 'dark' }); onClose(); } }
    ];
    return [...actions, ...pages];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, preferences.theme]);

  useEffect(() => {
    if (!open || term.trim().length < 2) { setRecords([]); return; }
    const controller = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      searchRecords(api, SOURCES.filter((s) => can(s.permission)), term.trim(), controller.signal)
        .then((rows) => setRecords(rows.map(({ s, row }) => ({ id: `${s.group}-${String(row.id)}`, group: s.group, label: s.label(row), hint: s.hint(row), icon: s.icon, run: () => go(s.href(row)) }))))
        .catch(() => setRecords([]))
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 220);
    return () => { controller.abort(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, open, api, can]);

  const q = term.trim().toLowerCase();
  const hits = [...staticHits.filter((h) => !q || `${h.label} ${h.hint ?? ''}`.toLowerCase().includes(q)).slice(0, q ? 8 : 12), ...records];
  useEffect(() => { setActive(0); }, [term, records.length]);
  const groups = [...new Set(hits.map((h) => h.group))];

  return (
    <dialog ref={dialog} className="ds-dialog" aria-label="Command palette" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {open && (
        <div className="ds-palette">
          <div className="ds-palette-input">
            <Icon name="search" />
            <input ref={input} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={hits[active] ? `cmd-${hits[active].id}` : undefined}
              aria-label="Search screens, actions and records" placeholder="Search customers, quotes, items or type a command…" value={term} onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter') { e.preventDefault(); hits[active]?.run(); }
              }} />
            {searching && <span className="ds-spinner" aria-label="Searching" />}
          </div>
          <ul id={listId} role="listbox" className="ds-palette-results" aria-label="Results">
            {hits.length === 0 && <li className="ds-palette-item" aria-disabled="true"><span className="muted">{searching ? 'Searching…' : 'No matches. Try a customer name, GSTIN, part code or quotation number.'}</span></li>}
            {groups.map((g) => (
              <li key={g} role="presentation">
                <div className="ds-palette-group" role="presentation">{g}</div>
                <ul role="group" aria-label={g} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {hits.filter((h) => h.group === g).map((h) => {
                    const index = hits.indexOf(h);
                    return (
                      <li key={h.id} id={`cmd-${h.id}`} role="option" aria-selected={index === active} className="ds-palette-item" onMouseEnter={() => setActive(index)} onClick={h.run}>
                        <Icon name={h.icon} /><span className="truncate">{h.label}</span>{h.hint && g !== 'Go to' && <small className="truncate">{h.hint}</small>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <div className="ds-palette-foot"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span></div>
        </div>
      )}
    </dialog>
  );
}
