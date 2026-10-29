import type { ApiClient } from '@/lib/api/client';

export interface Decision { kind: 'exception' | 'quotation' | 'order' | 'draft'; id: string; title: string; subtitle?: string | null; amount?: string | null; at: string; href: string }
export interface DashboardSummary {
  period: { from: string; to: string };
  kpis: {
    openEnquiries?: number; quotesAwaitingApproval?: number; slaBreaches?: number; openExceptions?: number;
    pipeline?: { value: string; count: number }; orderBook?: { value: string; count: number };
  };
  decisions: Decision[];
  funnel?: { label: string; value: number }[];
  quoteTrend?: { label: string; created: number; won: number }[];
  sla?: { met: number; breached: number; running: number; notConfigured: number };
  margin?: { approvals: number; belowFloor: number };
  activity?: { id: number; module: string; recordId: string; action: string; reason: string | null; at: string; user: string | null }[];
}

export interface DashboardApi { summary(range: { from: string; to: string }, signal?: AbortSignal): Promise<DashboardSummary> }

export const dashboardApi = (client: ApiClient): DashboardApi => ({
  summary: (range, signal) => client.data<DashboardSummary>('GET', '/api/v1/dashboard/summary', undefined, { query: range, signal })
});
