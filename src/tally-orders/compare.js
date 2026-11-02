import {decimal as D,add,sub,mul,div,compare,format} from './decimal.js';
const zero=()=>D('0');
const key=line=>line.itemId?`id:${line.itemId}`:line.itemCode?`code:${line.itemCode}`:null;
const grouped=lines=>{const result=new Map();for(const line of lines){const k=key(line);if(k)result.set(k,[...(result.get(k)||[]),line]);}return result;};
const parsed=v=>{try{return v==null?null:D(v);}catch{return null;}};
function netUnit(line){
  const qty=parsed(line.quantity),net=parsed(line.netAmount);
  if(!qty||compare(qty,zero())<=0)return null;
  if(line.netAmount!=null&&!net)return null;
  if(net&&compare(net,zero())<0)return null;
  if(net&&compare(net,zero())>=0)return div(net,qty);
  const rate=parsed(line.unitPrice),discount=parsed(line.discountPercent);
  if(!rate||!discount||compare(rate,zero())<0||compare(discount,zero())<0||compare(discount,D('100'))>0)return null;
  return mul(rate,sub(D('1'),div(discount,D('100'))));
}
function documentIssues(sales,other,options){
  const issues=[];
  if(sales.companyId!==other.companyId)issues.push('COMPANY_MISMATCH');
  if(!sales.currency||!other.currency)issues.push('CURRENCY_NOT_SUPPLIED');
  else if(sales.currency!==other.currency)issues.push('CURRENCY_MISMATCH');
  if([sales,other].some(d=>['CANCELLED','DELETED'].includes(d.status)))issues.push('CANCELLED_OR_DELETED_DOCUMENT');
  if(!options.netExTaxConfirmed)issues.push('NET_EX_TAX_BASIS_REQUIRES_REVIEW');
  if(!sales.lines?.length||!other.lines?.length)issues.push('NO_COMPARABLE_LINES');
  return issues;
}
/** Explicitly selected documents only. No automatic PO association by party/name/total. */
export function compareOrders(sales,other,{mode,netExTaxConfirmed=false}={}){
  if(!['CUSTOMER_PO','SUPPLIER_PO'].includes(mode))throw new Error('Choose customer PO or supplier PO comparison.');
  if(sales.kind!=='sales_orders')throw new Error('Select a Sales Order.');
  if(mode==='SUPPLIER_PO'&&other.kind!=='purchase_orders')throw new Error('Select a supplier Purchase Order.');
  if(mode==='CUSTOMER_PO'&&other.kind!=='customer_po')throw new Error('Select a customer Purchase Order.');
  const issues=documentIssues(sales,other,{netExTaxConfirmed}),left=grouped(sales.lines||[]),right=grouped(other.lines||[]),rows=[];
  let revenue=zero(),cost=zero(),covered=0;
  for(const k of new Set([...left.keys(),...right.keys()])){
    const l=left.get(k)||[],r=right.get(k)||[];
    const row={key:k,item:l[0]?.itemCode||r[0]?.itemCode||k,sales:l[0]||null,po:r[0]||null,issues:[],differences:[],matchedQuantity:null,revenue:null,cost:null,estimatedGrossProfit:null};
    if(l.length!==1||r.length!==1){row.issues.push(l.length>1||r.length>1?'AMBIGUOUS_REPEATED_ITEM':'ITEM_MISSING_ON_ONE_DOCUMENT');rows.push(row);continue;}
    const a=l[0],b=r[0];
    if(!a.unit||!b.unit)row.issues.push('UNIT_NOT_SUPPLIED');else if(a.unit!==b.unit)row.issues.push('UNIT_MISMATCH');
    for(const field of ['quantity','unitPrice','discountPercent','discountAmount','netAmount','taxPercent','hsn']){
      const av=a[field]??null,bv=b[field]??null,an=parsed(av),bn=parsed(bv);
      if(av===null||bv===null){row.differences.push({field,sales:av,po:bv,delta:null,status:'NOT_SUPPLIED'});continue;}
      const numeric=field!=='hsn'&&an&&bn;
      const same=numeric?compare(an,bn)===0:av===bv;
      if(!same)row.differences.push({field,sales:av,po:bv,delta:numeric?format(sub(an,bn),6):null,status:'DIFFERENT'});
    }
    const aq=parsed(a.quantity),bq=parsed(b.quantity),sell=netUnit(a),buy=netUnit(b);
    if(!aq||!bq||compare(aq,zero())<=0||compare(bq,zero())<=0)row.issues.push('INVALID_OR_MISSING_QUANTITY');
    if(!sell||!buy)row.issues.push('NET_PRICE_MISSING_OR_SIGN_AMBIGUOUS');
    if(!row.issues.length){
      const q=compare(aq,bq)<=0?aq:bq;row.matchedQuantity=format(q,6);
      if(compare(aq,bq)!==0)row.issues.push('QUANTITY_COVERAGE_DIFFERS');
      if(!issues.length&&mode==='SUPPLIER_PO'){
        const rev=mul(q,sell),purchase=mul(q,buy);revenue=add(revenue,rev);cost=add(cost,purchase);covered++;
        Object.assign(row,{revenue:format(rev),cost:format(purchase),estimatedGrossProfit:format(sub(rev,purchase))});
      }
    }
    rows.push(row);
  }
  if((sales.lines||[]).some(l=>!key(l))||(other.lines||[]).some(l=>!key(l)))issues.push('ITEM_IDENTITY_MISSING');
  const complete=!issues.length&&rows.length>0&&rows.every(r=>!r.issues.length);
  const profit=sub(revenue,cost),valid=mode==='SUPPLIER_PO'&&covered>0&&!issues.length;
  return {mode,salesOrderId:sales.id,poId:other.id,companyId:sales.companyId,currency:sales.currency,issues,rows,complete,
    coveredRevenue:valid?format(revenue):null,coveredPurchaseCost:valid?format(cost):null,coveredGrossProfit:valid?format(profit):null,
    estimatedOrderGrossProfit:complete&&valid?format(profit):null,
    marginPercent:complete&&valid&&compare(revenue,zero())>0?format(mul(div(profit,revenue),D('100'))):null,
    outcome:!complete||!valid?'INCOMPLETE':compare(profit,zero())<0?'EXPECTED_GROSS_LOSS':compare(profit,zero())>0?'EXPECTED_GROSS_PROFIT':'BREAK_EVEN',
    realizedProfit:null,estimatedNetProfit:null,
    note:mode==='CUSTOMER_PO'?'Agreement check only. A customer PO is not a purchase cost.':'Expected gross margin on matched quantities, using reviewed net prices excluding recoverable tax. Freight, other expenses, actual receipts and invoices are not included. This is not realized or net profit.'};
}
