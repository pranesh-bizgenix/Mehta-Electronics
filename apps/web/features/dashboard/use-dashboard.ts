'use client';

import { useMemo } from 'react';
import { useApi } from '@/lib/api/provider';
import { useScope } from '@/lib/scope';
import { useAsync } from '@/components/ds';
import { dashboardApi } from './api';

/** View model: loads the summary for the selected period and derives display values. */
export function useDashboard() {
  const client = useApi();
  const api = useMemo(() => dashboardApi(client), [client]);
  const { period } = useScope();
  const [state, reload] = useAsync((signal) => api.summary({ from: period.from, to: period.to }, signal), [api, period.from, period.to]);
  const data = state.status === 'ready' ? state.data : state.data;
  const derived = useMemo(() => {
    if (!data) return null;
    const conversion = data.funnel && data.funnel[1].value ? Math.round((data.funnel[3].value / data.funnel[1].value) * 100) : null;
    const slaTotal = data.sla ? data.sla.met + data.sla.breached : 0;
    const onTime = data.sla && slaTotal ? Math.round((data.sla.met / slaTotal) * 100) : null;
    const protectedPct = data.margin && data.margin.approvals ? Math.round(((data.margin.approvals - data.margin.belowFloor) / data.margin.approvals) * 100) : null;
    return { conversion, onTime, protectedPct };
  }, [data]);
  return { state, data, derived, period, reload };
}
