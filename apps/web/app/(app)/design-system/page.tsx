'use client';

import { useState } from 'react';
import {
  Avatar, AvatarGroup, Badge, BarChart, Button, Card, Checkbox, Combobox, DataTable, DateRangeField, Drawer, EmptyState, ErrorState, Facts, FileDrop, Funnel,
  IconButton, LineChart, MarginFlag, Meter, Modal, Notice, PageHeader, ReasonDialog, SelectField, SlaChip, StatCard, StatusBadge, Stepper, Switch, TabPanel, Tabs,
  TableSkeleton, TextAreaField, TextField, Timeline, Tooltip, Truncate, UnauthorizedState, useToast, type DateRange, type Option
} from '@/components/ds';
import { ApiError } from '@/lib/api/client';
import { formatMoney, formatQty } from '@/lib/format';

const SCALES = ['emerald', 'stone', 'amber', 'red', 'blue'];
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const SEMANTIC = ['canvas', 'surface', 'surface-sunken', 'border', 'text', 'text-muted', 'primary', 'primary-soft', 'success', 'warning', 'danger', 'info'];
const CUSTOMERS: Option[] = [{ value: '1', label: 'Shree Ganesh Controls Pvt Ltd', hint: '27AAECS1234F1Z5' }, { value: '2', label: 'Apex Automation Systems', hint: '27AABCA4321G1Z2' }, { value: '3', label: 'Western Process Solutions', hint: '24AACFW2468K1Z7' }];
const ROWS = [
  { id: 1, part: '3RT2026-1AP00', name: 'SIRIUS power contactor, 25 A, 11 kW, 230 V AC coil', qty: '12', rate: '3650.000000', flag: 'green' as const },
  { id: 2, part: '3RV2021-1KA10', name: 'Motor protection circuit breaker, 9–12.5 A', qty: '12', rate: '2450', flag: 'blue' as const },
  { id: 3, part: '6SL3210-1KE17-5UF1', name: 'SINAMICS G120C drive, 7.5 kW — a deliberately long description that truncates with a tooltip', qty: '3', rate: '128500.5', flag: 'red' as const }
];

/** Living documentation for tokens and components (light and dark). */
export default function DesignSystemPage() {
  const toast = useToast();
  const [tab, setTab] = useState('a');
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [reason, setReason] = useState(false);
  const [customer, setCustomer] = useState<Option | null>(null);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack-lg">
      <PageHeader title="Design system" crumbs={[{ label: 'Admin' }, { label: 'Design system' }]} description="Tokens and components every ControlDesk screen is built from. Switch the theme from the top bar to check dark mode." />

      <Card title="Colour scales (tokens.css)">
        <div className="stack">{SCALES.map((s) => <div key={s} className="ds-swatches">{STEPS.map((n) => <div key={n} className="ds-swatch"><i style={{ background: `var(--${s}-${n})` }} /><span>{s} {n}</span></div>)}</div>)}</div>
      </Card>
      <Card title="Semantic colours (follow the theme)">
        <div className="ds-swatches">{SEMANTIC.map((n) => <div key={n} className="ds-swatch"><i style={{ background: `var(--color-${n})` }} /><span>{n}</span></div>)}</div>
      </Card>

      <Card title="Typography and numbers">
        <div className="stack">
          <h1>Heading 1 · Plus Jakarta Sans</h1><h2>Heading 2</h2><h3>Heading 3</h3>
          <p>Body text in Inter. हिन्दी पाठ Noto Sans Devanagari में दिखता है।</p>
          <p>Money uses Indian grouping and is right-aligned in tables: <span className="num">{formatMoney('1234567')}</span> · <span className="num">{formatMoney('-98765.432')}</span> · quantity <span className="num">{formatQty('1200.500', 'NOS')}</span></p>
        </div>
      </Card>

      <Card title="Buttons">
        <div className="cluster">
          <Button icon="plus">Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="link">Link</Button>
          <Button size="sm">Small</Button><Button size="lg">Large</Button><Button busy={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1200); }}>Busy (blocks double submit)</Button><Button disabled>Disabled</Button>
          <IconButton icon="bell" label="Notifications" dot />
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Fields (floating labels, inline validation)">
          <div className="stack">
            <TextField label="Customer name" required />
            <TextField label="GSTIN" defaultValue="27ABCDE1234" error="GSTIN must have 15 characters." />
            <SelectField label="Pricing class" options={[{ value: 'rc', label: 'Rate contract' }, { value: 'dealer', label: 'Dealer' }]} placeholder="Choose" />
            <Combobox label="Customer (search)" value={customer} onChange={setCustomer} search={async (t) => CUSTOMERS.filter((c) => c.label.toLowerCase().includes(t.toLowerCase()))} />
            <TextAreaField label="Notes" hint="Shown to your team only." />
            <Checkbox label="Send a copy to me" /><Switch label="Automation on" defaultChecked />
            <DateRangeField value={range} onChange={setRange} />
          </div>
        </Card>
        <Card title="Status, flags, chips, avatars, tooltip">
          <div className="stack">
            <div className="cluster">{['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'REJECTED', 'BREACHED', 'NOT_CONFIGURED'].map((s) => <StatusBadge key={s} status={s} />)}</div>
            <div className="cluster"><Badge tone="info">Info</Badge><Badge tone="success">Success</Badge><Badge tone="warning">Warning</Badge><Badge tone="danger">Danger</Badge></div>
            <div className="cluster"><MarginFlag flag="green" /><MarginFlag flag="blue" /><MarginFlag flag="red" /></div>
            <div className="cluster"><SlaChip dueAt={new Date(Date.now() + 6 * 3600e3).toISOString()} /><SlaChip dueAt={new Date(Date.now() + 45 * 60e3).toISOString()} /><SlaChip dueAt={new Date(Date.now() - 3 * 3600e3).toISOString()} /><SlaChip dueAt={null} state="NOT_CONFIGURED" /></div>
            <div className="cluster"><Avatar name="Prem Mehta" /><AvatarGroup names={['Prem Mehta', 'Sindhu R', 'Jivita K', 'Bharat M', 'Maheshwari S']} /></div>
            <Tooltip content="Full value appears here"><Button variant="secondary" size="sm">Hover or focus me</Button></Tooltip>
            <div style={{ maxWidth: 'var(--layout-card-min)' }}><Truncate text="A very long customer name that does not fit in a narrow column" /></div>
            <Notice tone="warning" title="Rule not configured">Discount levels are empty, so quotations cannot be sent yet.</Notice>
          </div>
        </Card>
      </div>

      <section className="grid-auto" aria-label="Stat cards">
        <StatCard label="Open pipeline" value="₹18.40 L" footnote="12 open quotations" trend={[3, 5, 4, 7, 6, 9]} />
        <StatCard label="SLA breaches" value={2} delta={{ text: 'Needs attention', tone: 'down' }} />
        <StatCard label="Quotes awaiting approval" value={4} footnote="Waiting on a second person" />
      </section>

      <Card title="Tabs, stepper, timeline">
        <Tabs label="Example" value={tab} onChange={setTab} items={[{ id: 'a', label: 'Overview', icon: 'dashboard' }, { id: 'b', label: 'Activity', count: 3 }, { id: 'c', label: 'Documents' }]} />
        <TabPanel id={tab}>
          <div className="stack-lg">
            <Stepper label="Quotation approval" steps={[{ label: 'Draft', state: 'done' }, { label: 'Submitted', state: 'done' }, { label: 'Manager review', detail: 'Waiting on Prem', state: 'current' }, { label: 'Sent', state: 'todo' }]} />
            <Timeline items={[{ id: 1, title: 'Quotation approved', at: new Date().toISOString(), by: 'Prem Mehta', icon: 'check', tone: 'success', body: 'Margin above floor.' }, { id: 2, title: 'Submitted for approval', at: new Date(Date.now() - 36e5).toISOString(), by: 'Sales Executive', icon: 'quote' }]} />
            <Facts items={[{ label: 'GSTIN', value: '27AAECS1234F1Z5' }, { label: 'Credit limit', value: <span className="num">{formatMoney('750000')}</span> }, { label: 'Owner', value: 'Prem Mehta' }]} />
          </div>
        </TabPanel>
      </Card>

      <DataTable id="ds-demo" caption="Example quotation lines" rows={ROWS} rowKey={(r) => r.id} bulkActions={[{ label: 'Remove lines', onRun: (rows) => toast('info', `${rows.length} line(s) selected`), danger: true }]}
        search={{ value: '', onChange: () => undefined, placeholder: 'Search lines' }} rowActions={() => <IconButton icon="more" label="Line actions" />}
        columns={[
          { key: 'part', header: 'Part code', render: (r) => <span className="mono">{r.part}</span> },
          { key: 'name', header: 'Description', render: (r) => <Truncate text={r.name} /> },
          { key: 'qty', header: 'Qty', numeric: true, render: (r) => formatQty(r.qty) },
          { key: 'rate', header: 'Unit rate', numeric: true, render: (r) => formatMoney(r.rate) },
          { key: 'flag', header: 'Margin', render: (r) => <MarginFlag flag={r.flag} /> }
        ]} />

      <div className="grid-2">
        <Card title="Charts"><BarChart title="Quotations per month" labels={['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']} series={[{ name: 'Created', values: [12, 18, 15, 22, 19, 25] }, { name: 'Won', values: [5, 7, 6, 10, 8, 11] }]} /></Card>
        <Card title="Trend and funnel">
          <LineChart title="SLA on time %" labels={['W1', 'W2', 'W3', 'W4']} series={[{ name: 'On time', values: [82, 88, 91, 94] }]} format={(n) => `${Math.round(n)}%`} />
          <Funnel stages={[{ label: 'Enquiries', value: 120 }, { label: 'Quoted', value: 86 }, { label: 'Approved / sent', value: 70 }, { label: 'Won', value: 31 }]} />
          <Meter label="Margin protected" value={92} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="States"><div className="stack"><EmptyState title="No quotations yet" action={<Button icon="plus">New quotation</Button>}>Start from an enquiry or create one directly.</EmptyState><TableSkeleton rows={3} columns={4} /></div></Card>
        <Card title="Errors and access"><div className="stack"><ErrorState error={new ApiError(500, 'INTERNAL', 'Something went wrong on the server.', undefined, 'aB3dE9xYz1')} onRetry={() => toast('info', 'Retrying…')} /><UnauthorizedState /></div></Card>
      </div>

      <Card title="Overlays, toasts and uploads">
        <div className="stack">
          <div className="cluster">
            <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button><Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <Button variant="secondary" onClick={() => setReason(true)}>Reason dialog</Button><Button variant="secondary" onClick={() => toast('success', 'Quotation approved.')}>Success toast</Button>
            <Button variant="secondary" onClick={() => toast('danger', 'Not sent: the customer has no registered email.')}>Error toast</Button>
          </div>
          <FileDrop onFile={async (f) => { toast('success', `${f.name} ready (${Math.round(f.size / 1024)} KB)`); }} />
        </div>
      </Card>
      <Modal open={modal} title="Modal title" description="Focus is trapped; Esc closes." onClose={() => setModal(false)} footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => setModal(false)}>Save</Button></>}><TextField label="Field inside a modal" /></Modal>
      <Drawer open={drawer} title="Drawer" description="For record details and side forms." onClose={() => setDrawer(false)}><p className="muted">Drawer content.</p></Drawer>
      <ReasonDialog open={reason} title="Approve exception" onClose={() => setReason(false)} onConfirm={async () => { toast('success', 'Recorded.'); }} />
    </div>
  );
}
