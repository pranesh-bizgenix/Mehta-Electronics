'use client';
import {Badge,Card,DataTable,Notice} from '@/components/ds';

interface ComparisonLine {
  key:string;item:string;issues:string[];matchedQuantity:string|null;
  sales:{quantity?:string;unit?:string;unitPrice?:string}|null;
  po:{quantity?:string;unit?:string;unitPrice?:string}|null;
  differences:{field:string;sales:string|null;po:string|null;delta:string|null;status:string}[];
  estimatedGrossProfit:string|null;
}
export interface OrderComparisonResult {
  mode:'CUSTOMER_PO'|'SUPPLIER_PO';currency:string|null;complete:boolean;
  issues:string[];rows:ComparisonLine[];note:string;
  coveredRevenue:string|null;coveredPurchaseCost:string|null;coveredGrossProfit:string|null;
  estimatedOrderGrossProfit:string|null;marginPercent:string|null;outcome:string;
}
const label=(value:string)=>value.toLowerCase().replaceAll('_',' ');
const money=(value:string|null,currency:string|null)=>value===null?'Not determined':`${currency||'Currency unavailable'} ${value}`;

/** Read-only result presentation; caller must enforce financial access and company scope. */
export function ComparisonResult({result}:{result:OrderComparisonResult}){
  const supplier=result.mode==='SUPPLIER_PO';
  return <div className="stack">
    <Notice tone={result.complete?'success':'warning'} title={result.complete?'Comparison complete':'Review required'}>
      {supplier?'Sales value compared with supplier purchase cost.':'Customer purchase instructions compared with the Sales Order.'}
      {result.issues.length>0&&<ul>{result.issues.map(issue=><li key={issue}>{label(issue)}</li>)}</ul>}
    </Notice>
    {supplier&&<Card title="Expected gross margin">
      <dl>
        <dt>Sales value covered by matched quantities</dt><dd>{money(result.coveredRevenue,result.currency)}</dd>
        <dt>Supplier purchase cost for matched quantities</dt><dd>{money(result.coveredPurchaseCost,result.currency)}</dd>
        <dt>Gross profit on matched quantities</dt><dd>{money(result.coveredGrossProfit,result.currency)}</dd>
        <dt>Expected gross profit for the complete order</dt><dd><strong>{money(result.estimatedOrderGrossProfit,result.currency)}</strong></dd>
        <dt>Expected gross margin</dt><dd>{result.marginPercent===null?'Not determined':`${result.marginPercent}%`}</dd>
      </dl>
      <Badge tone={result.outcome==='EXPECTED_GROSS_LOSS'?'danger':result.complete?'success':'warning'}>{label(result.outcome)}</Badge>
    </Card>}
    <DataTable<ComparisonLine> id="so-po-comparison-lines" caption="Order line comparison" rows={result.rows} rowKey={row=>row.key} columns={[
      {key:'item',header:'Item',render:row=>row.item},
      {key:'sales',header:'Sales Order',render:row=>row.sales?`${row.sales.quantity??'—'} ${row.sales.unit??''} × ${row.sales.unitPrice??'Rate unavailable'}`:'Missing item'},
      {key:'po',header:supplier?'Supplier PO':'Customer PO',render:row=>row.po?`${row.po.quantity??'—'} ${row.po.unit??''} × ${row.po.unitPrice??'Rate unavailable'}`:'Missing item'},
      {key:'differences',header:'Differences and missing information',render:row=><ul>{row.issues.map(issue=><li key={issue}>{label(issue)}</li>)}{row.differences.map(d=><li key={d.field}>{label(d.field)}: SO {d.sales??'not supplied'} / PO {d.po??'not supplied'}{d.delta===null?'':` (difference ${d.delta})`}</li>)}{!row.issues.length&&!row.differences.length&&<li>Values agree</li>}</ul>},
      ...(supplier?[{key:'profit',header:'Expected gross profit',render:(row:ComparisonLine)=>money(row.estimatedGrossProfit,result.currency)}]:[])
    ]}/>
    <Notice title={supplier?'How to read this margin':'Agreement comparison'}>{result.note}</Notice>
  </div>;
}
