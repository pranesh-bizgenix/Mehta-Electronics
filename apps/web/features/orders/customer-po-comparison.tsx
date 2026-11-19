'use client';
import {Badge,Card,DataTable,Notice} from '@/components/ds';
import {formatMoney,titleCase} from '@/lib/format';
interface Line {partCode:string;description:string;uom:string;quantity:string;unitPrice:string;discountPercent:string;taxPercent:string}
interface Difference {field:string;po:string;quote:string;delta:string}
interface Row {key:string;partCode:string;issues:string[];po:Line|null;quote:Line|null;differences:Difference[]}
export interface CustomerPoComparisonData {linked:boolean;flags:string[];comparisons:Row[];quoteNumber?:string|null;quoteVersion?:number|null;quoteTotal:string|null;poTotal?:string;quoteDifference:string|null}
const labels:Record<string,string>={quantity:'Quantity',unitPrice:'List unit rate',discountPercent:'Discount %',taxPercent:'GST %',netUnitPrice:'Net unit rate'};
const values=(line:Line|null)=>line?<div className="stack"><strong>{line.quantity} {line.uom}</strong><span>Unit rate {formatMoney(line.unitPrice)}</span><span>Discount {line.discountPercent}% · GST {line.taxPercent}%</span></div>:<span>Item missing</span>;
export function CustomerPoComparison({value}:{value:CustomerPoComparisonData}){
 if(!value.linked)return <Notice tone="warning" title="No linked quotation">This customer PO was entered manually. Link an approved quotation when revising the PO to compare agreed prices and quantities.</Notice>;
 return <Card title="Customer PO compared with quotation">
  <div className="stack">
   <Notice tone={value.flags.length?'warning':'success'} title={value.flags.length?'Differences require review':'PO lines agree with the quotation'}>
    Comparing the saved customer PO with quotation {value.quoteNumber||'reference'}{value.quoteVersion?` · version ${value.quoteVersion}`:''}, captured when this PO was saved. Positive differences mean the PO value is higher.
   </Notice>
   <div className="cluster"><span>Quotation total: <strong>{formatMoney(value.quoteTotal||'0')}</strong></span><span>Customer PO total: <strong>{formatMoney(value.poTotal||'0')}</strong></span><span>Difference: <strong>{formatMoney(value.quoteDifference||'0')}</strong></span></div>
   {value.flags.length>0&&<div className="cluster">{value.flags.map(flag=><Badge key={flag} tone="warning">{titleCase(flag)}</Badge>)}</div>}
   <DataTable<Row> id="customer-po-quotation-comparison" caption="Quoted and customer PO quantities and prices" rows={value.comparisons} rowKey={row=>row.key} columns={[
    {key:'part',header:'Item',render:row=><><strong>{row.partCode}</strong><p>{row.po?.description||row.quote?.description}</p></>},
    {key:'quote',header:'Quotation',render:row=>values(row.quote)},
    {key:'po',header:'Customer PO',render:row=>values(row.po)},
    {key:'differences',header:'Differences',render:row=>row.issues.length?<div className="stack">{row.issues.map(issue=><span key={issue}>{titleCase(issue)}</span>)}{row.differences.map(d=><span key={d.field}>{labels[d.field]||d.field}: {d.po} − {d.quote} = {d.delta}</span>)}</div>:<Badge tone="success">Agrees</Badge>}
   ]}/>
   <p>Exact item links are used. Duplicate matches require correction; names and row positions do not establish a match. No quantities, prices or units are changed automatically.</p>
  </div>
 </Card>;
}
