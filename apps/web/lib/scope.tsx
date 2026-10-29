'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from './api/provider';
import { useSession } from './session';

export type PeriodKey = 'month' | 'quarter' | 'fy' | 'last30';
export interface Company { id: string; name: string; display_name: string }
export interface Period { key: PeriodKey; label: string; from: string; to: string }

const KEY = 'controldesk.scope';
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function periodRange(key: PeriodKey, now = new Date()): Period {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (key === 'month') return { key, label: 'This month', from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) };
  if (key === 'quarter') { const q = Math.floor(m / 3) * 3; return { key, label: 'This quarter', from: iso(new Date(Date.UTC(y, q, 1))), to: iso(now) }; }
  if (key === 'last30') return { key, label: 'Last 30 days', from: iso(new Date(now.getTime() - 29 * 864e5)), to: iso(now) };
  const fy = m >= 3 ? y : y - 1;
  return { key, label: `FY ${fy}–${String(fy + 1).slice(2)}`, from: iso(new Date(Date.UTC(fy, 3, 1))), to: iso(now) };
}

interface ScopeValue { companies: Company[]; companyId: string | null; setCompanyId: (id: string | null) => void; period: Period; setPeriod: (key: PeriodKey) => void }
const ScopeContext = createContext<ScopeValue | null>(null);

/** Company (Tally) and reporting period chosen in the top bar; used by reports and the dashboard. */
export function ScopeProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { state, can } = useSession();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<PeriodKey>('month');

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { companyId?: string; period?: PeriodKey }; if (saved.period) setPeriodKey(saved.period); if (saved.companyId) setCompanyId(saved.companyId); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (state.kind !== 'ready' || !(can('customers.read') || can('items.read'))) return;
    api.data<Company[]>('GET', '/api/tally/read-companies').then((list) => {
      setCompanies(list);
      setCompanyId((current) => current && list.some((c) => c.id === current) ? current : list[0]?.id ?? null);
    }).catch(() => setCompanies([]));
  }, [api, state.kind, can]);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ companyId, period: periodKey })); }, [companyId, periodKey]);

  const value = useMemo(() => ({ companies, companyId, setCompanyId, period: periodRange(periodKey), setPeriod: setPeriodKey }), [companies, companyId, periodKey]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope must be used inside ScopeProvider.');
  return ctx;
}
