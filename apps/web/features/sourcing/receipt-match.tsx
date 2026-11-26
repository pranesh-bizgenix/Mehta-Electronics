'use client';
import {Badge,DataTable,Notice,WorkflowNavigation} from '@/components/ds';
import {PdfActions} from '@/features/billing/pdf-actions';
import {formatQty,titleCase} from '@/lib/format';

interface MatchRow {itemId:number;partCode:string;uom:string;ordered:string;accepted:string;rejected:string;previouslyInvoiced:string;thisInvoice:string;remainingAccepted:string;outstandingDelivery:string}
export interface ReceiptMatch {rows:MatchRow[];blockers:{code:string;itemId?:number}[];differences:{code:string;itemId?:number}[];matched:boolean;receiptEvidence:{id:number;version:number}[];invoiceEvidence:{id:number;version:number}[];note:string}
export function ReceiptMatchPanel({match,documentId}:{match:ReceiptMatch;documentId:number}){
 return <section className="stack" aria-label="PO, goods receipt and invoice matching">
  <div className="cluster"><h3>Order, receipt and invoice check</h3><Badge tone={match.matched?'success':'warning'}>{match.blockers.length?'Action required':match.differences.length?'Price review needed':'Quantities matched'}</Badge></div>
  <p className="muted">{match.note}</p>
  {match.blockers.length>0&&<Notice tone="warning">Approval is blocked. Resolve the listed receipt, quantity or invoice-reference problems first; accepting differences cannot bypass them.</Notice>}
  <DataTable<MatchRow> id="supplier-three-way-match" caption="Ordered, received and invoiced quantities" rows={match.rows} rowKey={r=>String(r.itemId)} columns={[
   {key:'item',header:'Item / unit',render:r=><><span className="ds-cell-primary">{r.partCode}</span><span className="ds-cell-secondary">{r.uom}</span></>},
   {key:'ordered',header:'Ordered',numeric:true,render:r=>formatQty(r.ordered)},{key:'accepted',header:'Accepted goods',numeric:true,render:r=>formatQty(r.accepted)},
   {key:'rejected',header:'Rejected',numeric:true,render:r=>formatQty(r.rejected)},{key:'prior',header:'Previously invoiced',numeric:true,render:r=>formatQty(r.previouslyInvoiced)},
   {key:'current',header:'This invoice',numeric:true,render:r=>formatQty(r.thisInvoice)},{key:'available',header:'Accepted, unbilled',numeric:true,render:r=>formatQty(r.remainingAccepted)},
   {key:'pending',header:'Delivery pending',numeric:true,render:r=>formatQty(r.outstandingDelivery)}
  ]}/>
  <p className="muted">Based on {match.receiptEvidence.length} posted goods receipts and {match.invoiceEvidence.length} previously reviewed invoices.</p>
  {match.receiptEvidence.length+match.invoiceEvidence.length>0&&<WorkflowNavigation label="Matching evidence" links={[
   ...match.receiptEvidence.map(r=>({href:'/purchasing?kind=grns&open='+r.id,label:'Goods receipt #'+r.id,icon:'items' as const})),
   ...match.invoiceEvidence.map(r=>({href:'/purchasing?kind=documents&open='+r.id,label:'Earlier invoice #'+r.id,icon:'ledger' as const}))
  ]}/>}
  {[...match.blockers,...match.differences].length>0&&<ul>{[...match.blockers,...match.differences].map((f,i)=><li key={i}>{titleCase(f.code)}{f.itemId!==undefined?' (item '+f.itemId+')':''}</li>)}</ul>}
  <PdfActions path={'/api/crm/purchasing/documents/'+documentId+'/matching-pdf'} body={{}} filename={'supplier-invoice-'+documentId+'-matching.pdf'}/>
 </section>;
}
