'use client';

import Link from 'next/link';
import { screenHref } from '@/components/shell/nav-config';
import { useSession } from '@/lib/session';
import { formatMoney, formatMoneyCompact, formatRelative, titleCase } from '@/lib/format';
import { useDashboard } from '@/features/dashboard/use-dashboard';
import type { Decision } from '@/features/dashboard/api';
import {
  BarChart, Button, Card, CardSkeleton, EmptyState, ErrorState, Funnel, Icon, Meter, Notice, PageHeader, StatCard, Timeline, type IconName
} from '@/components/ds';

const DECISION_ICON: Record<Decision['kind'], IconName> = { exception: 'alert', quotation: 'quote', order: 'truck', draft: 'mail' };

export default function DashboardPage() {
  const { state: session, can } = useSession();
  const { state, data, derived, period, reload } = useDashboard();
  const name = session.kind === 'ready' ? session.user.name.split(' ')[0] : '';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader title={`${greeting}${name ? `, ${name}` : ''}`} description={`Here’s what needs you today · ${period.label}`}
        actions={<>
          {can('enquiries.create') && <Button variant="secondary" icon="plus" onClick={() => { window.location.href = screenHref('/enquiries?new=1'); }}>New enquiry</Button>}
          {can('quotations.create') && <Button icon="plus" onClick={() => { window.location.href = screenHref('/quotations/new'); }}>New quotation</Button>}
        </>} />

      {state.status === 'error' && !data && <ErrorState error={state.error} onRetry={reload} />}

      {/* First fold: the numbers an owner checks every morning */}
      <section aria-label="Key numbers" className="grid-kpis" style={{ marginBottom: 'var(--space-3)' }}>
        {!data ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} lines={2} />) : <>
          {data.kpis.pipeline && <StatCard label="Open pipeline" value={formatMoneyCompact(data.kpis.pipeline.value)} title={formatMoney(data.kpis.pipeline.value)} footnote={`${data.kpis.pipeline.count} open quotation${data.kpis.pipeline.count === 1 ? '' : 's'}`} trend={data.quoteTrend?.map((m) => m.created)} href={screenHref('/quotations')} />}
          {data.kpis.orderBook && <StatCard label="Order book" value={formatMoneyCompact(data.kpis.orderBook.value)} title={formatMoney(data.kpis.orderBook.value)} footnote={`${data.kpis.orderBook.count} open order${data.kpis.orderBook.count === 1 ? '' : 's'}`} href={screenHref('/orders')} />}
          {data.kpis.quotesAwaitingApproval !== undefined && <StatCard label="Quotes awaiting approval" value={data.kpis.quotesAwaitingApproval} footnote={data.kpis.quotesAwaitingApproval ? 'Waiting on a second person' : 'Nothing waiting'} href={screenHref('/quotations')} />}
          {data.kpis.openEnquiries !== undefined && <StatCard label="Open enquiries" value={data.kpis.openEnquiries} footnote={derived?.conversion !== null && derived?.conversion !== undefined ? `${derived.conversion}% quote-to-win this period` : undefined} trend={data.quoteTrend?.map((m) => m.won)} href={screenHref('/enquiries')} />}
          {data.kpis.slaBreaches !== undefined && <StatCard label="SLA breaches" value={data.kpis.slaBreaches} delta={data.kpis.slaBreaches ? { text: 'Needs attention', tone: 'down' } : { text: 'All on time', tone: 'up' }} href="/work" />}
          {data.kpis.openExceptions !== undefined && <StatCard label="Open exceptions" value={data.kpis.openExceptions} footnote="Stopped until reviewed" href="/exceptions" />}
        </>}
      </section>

      <div className="grid-main-aside" style={{ marginBottom: 'var(--space-3)' }}>
        <Card title="Needs your decision" actions={data && data.decisions.length > 0 ? <span className="ds-nav-badge" data-tone="warning">{data.decisions.length}</span> : undefined} padded={false}>
          {!data ? <div className="ds-card-body"><CardSkeleton /></div> : data.decisions.length === 0 ? (
            <EmptyState title="You’re all caught up" illustration="done">Approvals, held orders and email drafts that need you will appear here.</EmptyState>
          ) : (
            <ul className="ds-list">
              {data.decisions.map((d) => (
                <li key={`${d.kind}-${d.id}`}>
                  <Link className="ds-list-item" href={screenHref(d.href)} prefetch={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-1-5)', textDecoration: 'none' }}>
                    <span className="ds-timeline-dot" data-tone={d.kind === 'exception' ? 'warning' : undefined}><Icon name={DECISION_ICON[d.kind]} /></span>
                    <span className="stack-sm" style={{ gap: 0, minWidth: 0, flex: '1 1 auto' }}>
                      <span className="ds-cell-primary truncate">{d.title}</span>
                      <span className="ds-cell-secondary truncate">{d.subtitle ?? titleCase(d.kind)} · waiting {formatRelative(d.at).replace(' ago', '')}</span>
                    </span>
                    {d.amount && <span className="num ds-desktop-only">{formatMoney(d.amount)}</span>}
                    <Icon name="chevronRight" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="stack">
          {data?.sla && (
            <Card title="SLA this period">
              {derived?.onTime === null ? <Notice tone="warning" title="No closed records yet">{data.sla.notConfigured ? `${data.sla.notConfigured} record(s) have no SLA because the policy is not set in Rules.` : 'Met and breached counts appear once records close.'}</Notice> : (
                <div className="stack">
                  <Meter label="Closed on time" value={derived?.onTime ?? 0} />
                  <p className="ds-cell-secondary">{data.sla.met} met · {data.sla.breached} breached · {data.sla.running} running</p>
                </div>
              )}
            </Card>
          )}
          {data?.margin && (
            <Card title="Margin protected">
              {data.margin.approvals === 0 ? <p className="muted">No quotation approvals in this period.</p> : (
                <div className="stack">
                  <Meter label="Approved at or above the margin floor" value={derived?.protectedPct ?? 0} />
                  <p className="ds-cell-secondary">{data.margin.belowFloor} of {data.margin.approvals} approvals needed a below-floor exception.</p>
                </div>
              )}
            </Card>
          )}
          <Card title="Receivables ageing">
            <Notice tone="info" title="Waiting for Tally voucher data">Ageing appears once the connector delivers bill-wise receivables. No figures are estimated.</Notice>
          </Card>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 'var(--space-3)' }}>
        {data?.funnel && <Card title="Pipeline funnel"><Funnel stages={data.funnel} /></Card>}
        {data?.quoteTrend && <Card title="Quotations created vs won (6 months)"><BarChart title="Quotations created and won per month" labels={data.quoteTrend.map((m) => m.label)} series={[{ name: 'Created', values: data.quoteTrend.map((m) => m.created) }, { name: 'Won', values: data.quoteTrend.map((m) => m.won) }]} format={(n) => String(Math.round(n))} /></Card>}
      </div>

      {data?.activity && (
        <Card title="Recent activity" actions={<Link href="/audit" className="ds-button" data-variant="link">Open audit trail</Link>}>
          <Timeline items={data.activity.map((a) => ({ id: a.id, title: `${titleCase(a.action)} · ${titleCase(a.module)}`, at: a.at, by: a.user ?? 'System', body: a.reason ?? undefined, icon: 'audit' }))} empty="No activity yet." />
        </Card>
      )}
    </>
  );
}
