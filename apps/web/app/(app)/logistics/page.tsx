'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { TallyLogistics } from '@/features/workflows/tally-logistics';
import {AvailabilityQueue} from '@/features/incoming-requests/availability';
import {PackingPanel} from '@/features/warehouse/packing-panel';
import { Button, Card, Checkbox, DataTable, Drawer, ErrorState, PageHeader, SelectField, StatusBadge, TextField, useToast } from '@/components/ds';

type Line = { id?: number; poLineKey?: string; lineKey?: string; partCode?: string; actualPartCode?: string; description?: string; quantity?: string; uom?: string };
type RecordRow = { id: number; number?: string; orderNumber?: string; customerName?: string; status: string; version: number };
type Order = RecordRow & { lines: Line[]; shipments: { id: number; status: string; lr_number: string }[]; grns: RecordRow[]; assignments?: { user_id: number; name: string; status: string }[]; evidence: { id: number; kind: string; item_code: string | null; photo_name: string | null }[] };
type Po = RecordRow & { lines: Line[]; grns: RecordRow[] };
type Grn = RecordRow & { lines: Line[]; evidence?: Order['evidence'] };
const base = '/api/crm/logistics';

async function photo(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo of at most 10 MB.');
  const value = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
  return { name: file.name, base64: value.slice(value.indexOf(',') + 1) };
}

export default function LogisticsPage() {
  const api = useApi(), { can } = useSession(), toast = useToast();
  const [orders, setOrders] = useState<RecordRow[]>([]), [pos, setPos] = useState<RecordRow[]>([]), [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [order, setOrder] = useState<Order>(), [po, setPo] = useState<Po>(), [grn, setGrn] = useState<Grn>();
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [why, setWhy] = useState(''), [staffId, setStaffId] = useState(''), [lineRef, setLineRef] = useState(''), [itemCode, setItemCode] = useState(''), [file, setFile] = useState<File>(), [shipmentId, setShipmentId] = useState('');
  const [vehicle, setVehicle] = useState(''), [lr, setLr] = useState(''), [transporter, setTransporter] = useState('');
  const [observed, setObserved] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({}), [accepted, setAccepted] = useState<Record<string, string>>({}), [rejected, setRejected] = useState<Record<string, string>>({});
  const [requestKey, setRequestKey] = useState('');
  const [packingBoxes,setPackingBoxes]=useState<string[]>([]);
  const [check, setCheck] = useState<{ fingerprint: string; alerts: { code: string }[] }>();
  const [acceptDifferences, setAcceptDifferences] = useState(false);
  useEffect(() => {
    if (!can('logistics.read')) return;
    let live = true;
    api.get<{ data: RecordRow[]; pagination: { pages: number } }>(`${base}/orders`, { query: { page } }).then(r => { if (live) { setOrders(r.data); setPages(r.pagination.pages); } }).catch(setError);
    if (can('logistics.grn.read')) api.data<RecordRow[]>('GET', `${base}/pos`).then(r => { if (live) setPos(r); }).catch(setError);
    if (can('logistics.assignment.manage')) api.data<{ id: number; name: string }[]>('GET', `${base}/store-staff`).then(r => { if (live) setStaff(r); }).catch(setError);
    return () => { live = false; };
  }, [api, can, revision, page]);
  const run = async (fn: () => Promise<void>, needsReason = true) => {
    setError(undefined); setBusy(true);
    try { if (needsReason && why.trim().length < 3) throw new Error('Enter a reason of at least three characters.'); await fn(); setRevision(v => v + 1); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const openOrder = async (id: number) => { setRequestKey(crypto.randomUUID()); setOrder(await api.data<Order>('GET', `${base}/orders/${id}`)); setPo(undefined); setGrn(undefined); setLineRef(''); setItemCode(''); setFile(undefined); setShipmentId(''); setQuantities({});setPackingBoxes([]); };
  const openPo = async (id: number) => { setRequestKey(crypto.randomUUID()); setPo(await api.data<Po>('GET', `${base}/pos/${id}`)); setOrder(undefined); setGrn(undefined); setQuantities({}); setAccepted({}); setRejected({}); setObserved({}); };
  const openGrn = async (id: number) => { setGrn(await api.data<Grn>('GET', `${base}/grns/${id}`)); setPo(undefined); setLineRef(''); setItemCode(''); setFile(undefined); setCheck(undefined); setAcceptDifferences(false); };
  if (!can('logistics.read')) return <PageHeader title="Logistics & store" description="Your role does not have access to this workspace." />;
  const target = grn ?? order;
  return <div className="stack-lg">
    <PageHeader title="Logistics & store" description={can('logistics.orders.read') ? 'Manage receiving and dispatch. Commercial approvals stay with the existing reviewers.' : 'Your assigned orders. Record photos and item-code observations for review.'} />
    {can('logistics.orders.read') && <TallyLogistics />}
    <AvailabilityQueue />
    {error != null && <ErrorState error={error} onRetry={() => { setError(undefined); setRevision(v => v + 1); }} />}
    <Card title={can('logistics.orders.read') ? 'Orders' : 'Assigned orders'}>
      <DataTable<RecordRow> id="logistics-orders" caption="Operational orders" rows={orders} rowKey={r => r.id} onRowClick={r => void run(() => openOrder(r.id), false)} columns={[
        { key: 'number', header: 'Order', render: r => r.orderNumber }, { key: 'customer', header: 'Customer', render: r => r.customerName }, { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> }
      ]} />
      <div className="cluster"><Button variant="secondary" disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>Previous</Button><span>Page {page} of {Math.max(1, pages)}</span><Button variant="secondary" disabled={page >= pages || busy} onClick={() => setPage(p => p + 1)}>Next</Button></div>
    </Card>
    {can('logistics.grn.read') && <Card title="Receiving POs"><DataTable<RecordRow> id="logistics-pos" caption="Open supplier POs" rows={pos} rowKey={r => r.id} onRowClick={r => void run(() => openPo(r.id), false)} columns={[
      { key: 'number', header: 'Supplier PO', render: r => r.number }, { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> }
    ]} /></Card>}
    <Drawer open={Boolean(order || po || grn)} title={grn?.number ?? po?.number ?? order?.orderNumber ?? 'Operational details'} onClose={() => { setOrder(undefined); setPo(undefined); setGrn(undefined); setError(undefined); }}>
      <div className="stack-lg">
        {error != null && <ErrorState error={error} />}
        <TextField label="Reason for changes" value={why} onChange={e => setWhy(e.target.value)} required />
        {(grn ?? po ?? order)?.lines.map((l, i) => <Card key={l.id ?? l.lineKey ?? l.poLineKey ?? i} title={l.partCode ?? l.actualPartCode ?? l.description ?? 'Item'}>
          <p>{l.description} · {l.quantity ?? ''} {l.uom ?? ''}</p>
          {((po && can('logistics.grn.manage')) || (order && !grn && can('logistics.dispatch.manage'))) && <div className="stack">
            <TextField label={po ? 'Received quantity' : 'Dispatch quantity'} inputMode="decimal" value={quantities[String(l.lineKey ?? l.id)] ?? ''} onChange={e => setQuantities(q => ({ ...q, [String(l.lineKey ?? l.id)]: e.target.value }))} />
            {po && <><TextField label="Received item code (if different)" value={observed[l.lineKey!] ?? ''} onChange={e => setObserved(q => ({ ...q, [l.lineKey!]: e.target.value }))} /><TextField label="Accepted quantity" inputMode="decimal" value={accepted[l.lineKey!] ?? ''} onChange={e => setAccepted(q => ({ ...q, [l.lineKey!]: e.target.value }))} /><TextField label="Rejected quantity" inputMode="decimal" value={rejected[l.lineKey!] ?? ''} onChange={e => setRejected(q => ({ ...q, [l.lineKey!]: e.target.value }))} /></>}
          </div>}
        </Card>)}
        {po && <>
          {can('logistics.grn.manage') && <Button disabled={busy} onClick={() => void run(async () => {
            const data = await api.data<Grn>('POST', `${base}/pos/${po.id}/grns`, { requestKey, receivedDate: new Date().toISOString().slice(0, 10), reason: why, lines: po.lines.filter(l => quantities[l.lineKey!]).map(l => ({ poLineKey: l.lineKey, ...(observed[l.lineKey!] ? { actualPartCode: observed[l.lineKey!] } : {}), received: quantities[l.lineKey!], accepted: accepted[l.lineKey!] ?? quantities[l.lineKey!], rejected: rejected[l.lineKey!] || '0' })) }); await openGrn(data.id); toast('success', 'Receipt recorded for independent review.');
          })}>Record GRN</Button>}
          {po.grns.map(g => <Button key={g.id} variant="secondary" onClick={() => void run(() => openGrn(g.id), false)}>{g.number} · {g.status}</Button>)}
        </>}
        {order && !grn && <>
          <PackingPanel order={order} selectedBoxes={packingBoxes} onSelectedBoxes={setPackingBoxes}/>
          {order.grns.map(g => <Button key={g.id} variant="secondary" onClick={() => void run(() => openGrn(g.id), false)}>{g.number} · {g.status}</Button>)}
          {can('logistics.assignment.manage') && <Card title="Store assignments"><div className="stack">
            <SelectField label="Store staff" value={staffId} onChange={e => setStaffId(e.target.value)} placeholder="Select a person" options={staff.map(u => ({ value: String(u.id), label: u.name }))} />
            <div className="cluster">{[true, false].map(active => <Button key={String(active)} variant={active ? 'primary' : 'secondary'} disabled={busy || !staffId} onClick={() => void run(async () => { await api.data('POST', `${base}/orders/${order.id}/assignments`, { userId: Number(staffId), active, reason: why }); await openOrder(order.id); })}>{active ? 'Assign' : 'Revoke'}</Button>)}</div>
            {order.assignments?.map(a => <p key={a.user_id}>{a.name} · {a.status}</p>)}
          </div></Card>}
          {can('logistics.dispatch.manage') && <Card title="Dispatch approved order"><div className="stack">
            <TextField label="Vehicle number" value={vehicle} onChange={e => setVehicle(e.target.value)} /><TextField label="LR number" value={lr} onChange={e => setLr(e.target.value)} /><TextField label="Transporter" value={transporter} onChange={e => setTransporter(e.target.value)} />
            <Button disabled={busy} onClick={() => void run(async () => { await api.data('POST', `${base}/orders/${order.id}/dispatch`, { version: order.version, requestKey, vehicleNumber: vehicle, lrNumber: lr, transporter, reason: why,...(packingBoxes.length?{packingBoxIds:packingBoxes}:{}), lines: order.lines.filter(l => quantities[String(l.id)]).map(l => ({ lineId: l.id, quantity: quantities[String(l.id)] })) }); await openOrder(order.id); })}>Dispatch selected quantities</Button>
          </div></Card>}
          {order.evidence.map(e => <p key={e.id}>{e.kind} · {e.item_code ?? 'Photo'} {e.photo_name && <a href={`${base}/evidence/${e.id}/photo`} target="_blank" rel="noreferrer">View {e.photo_name}</a>}</p>)}
        </>}
        {grn?.evidence?.map(e => <p key={e.id}>{e.item_code ?? 'Photo'} {e.photo_name && <a href={`${base}/evidence/${e.id}/photo`} target="_blank" rel="noreferrer">View {e.photo_name}</a>}</p>)}
        {grn && can('logistics.grn.post') && <Card title="Independent GRN review"><div className="stack">
          <Button variant="secondary" disabled={busy} onClick={() => void run(async () => setCheck(await api.data('GET', `${base}/grns/${grn.id}/check`)), false)}>Check receipt</Button>
          {check && <><p>{check.alerts.length ? check.alerts.map(a => a.code.replaceAll('_', ' ')).join(', ') : 'No receipt differences.'}</p>{check.alerts.length > 0 && <Checkbox label="Accept the listed receipt differences" checked={acceptDifferences} onChange={e => setAcceptDifferences(e.target.checked)} />}<Button disabled={busy || (check.alerts.length > 0 && !acceptDifferences)} onClick={() => void run(async () => { await api.data('POST', `${base}/grns/${grn.id}/post`, { version: grn.version, fingerprint: check.fingerprint, acceptExceptions: acceptDifferences, reason: why }); await openGrn(grn.id); })}>Post receipt with this review reason</Button></>}
        </div></Card>}
        {target && can('logistics.evidence.write') && <Card title="Photos & item-code observations"><div className="stack">
          <SelectField label="Item line" value={lineRef} onChange={e => setLineRef(e.target.value)} placeholder="Select item" options={target.lines.map(l => ({ value: String(grn ? l.poLineKey : l.id), label: l.partCode ?? l.actualPartCode ?? l.description ?? 'Item' }))} />
          <TextField label={grn ? 'Received item code' : 'Observed dispatch item code'} value={itemCode} onChange={e => setItemCode(e.target.value)} />
          {order && !grn && <SelectField label="Shipment (optional)" value={shipmentId} onChange={e => setShipmentId(e.target.value)} placeholder="Order preparation" options={order.shipments.filter(s => s.status !== 'DELIVERED').map(s => ({ value: String(s.id), label: s.lr_number }))} />}
          <TextField label="Photo (PNG/JPEG, maximum 10 MB)" type="file" accept="image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0])} />
          <Button disabled={busy} onClick={() => void run(async () => { await api.data('POST', `${base}/${grn ? 'grns' : 'orders'}/${target.id}/evidence`, { version: target.version, lineRef, ...(itemCode ? { itemCode } : {}), ...(file ? { photo: await photo(file) } : {}), ...(!grn && shipmentId ? { shipmentId: Number(shipmentId) } : {}), reason: why }); toast('success', 'Observation retained for review.'); if (grn) await openGrn(grn.id); else await openOrder(target.id); })}>Record observation</Button>
          {order && !grn && can('logistics.dispatch.manage') && <>
            <Button variant="secondary" disabled={busy || !shipmentId || !file} onClick={() => void run(async () => { if (!file) return; await api.data('POST', `${base}/orders/${order.id}/shipments/${shipmentId}/proof`, { ...await photo(file), version: order.version, reason: why }); toast('success', 'Delivery proof retained.'); })}>Retain selected photo as delivery proof</Button>
            <Button variant="secondary" disabled={busy || !shipmentId} onClick={() => void run(async () => { await api.data('POST', `${base}/shipments/${shipmentId}/deliver`, { version: order.version, reason: why }); await openOrder(order.id); })}>Confirm selected shipment delivered</Button>
          </>}
        </div></Card>}
      </div>
    </Drawer>
  </div>;
}
