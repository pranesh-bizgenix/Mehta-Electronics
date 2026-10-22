// Shared browser/server decimal arithmetic: six-place inputs, half-up paise per line/component.
const SCALE=1000000n;
export const scaled=value=>{
 const v=String(value??'');if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(v))throw new Error('Use non-negative numbers with at most 12 whole and six decimal places.');
 const [w,f='']=v.split('.');return BigInt(w)*SCALE+BigInt(f.padEnd(6,'0'));
};
const round=(n,d)=>(n+d/2n)/d;
export const money=n=>`${n<0n?'-':''}${(n<0n?-n:n)/100n}.${String((n<0n?-n:n)%100n).padStart(2,'0')}`;
export function calculateQuotation(lines,sellerState,placeOfSupply,costs=null,floor='0',basis='LINE_AND_TOTAL') {
 let net=0n,cgst=0n,sgst=0n,igst=0n,cost=0n,missingCost=false,lineBelow=false;
 const threshold=scaled(floor);if(threshold>100n*SCALE)throw new Error('Margin floor must be between 0 and 100.');
 const local=sellerState===placeOfSupply;
 const result=lines.map(l=>{
  const q=scaled(l.quantity),r=scaled(l.unitPrice),discount=scaled(l.discountPercent??'0'),tax=scaled(l.taxPercent??'0');
  if(q===0n||discount>100n*SCALE||tax>100n*SCALE)throw new Error('Quantity must be positive; discount and GST must be between 0 and 100.');
  const amount=round(q*r*(100n*SCALE-discount)*100n,100n*SCALE*SCALE*SCALE);
  const c=local?round(amount*tax,200n*SCALE):0n,s=c,i=local?0n:round(amount*tax,100n*SCALE);
  net+=amount;cgst+=c;sgst+=s;igst+=i;
  const row={...l,net:money(amount),cgst:money(c),sgst:money(s),igst:money(i),total:money(amount+c+s+i)};
  if(costs){const unit=costs[String(l.itemId)];if(unit==null){missingCost=true;row.unitCost=null;row.marginPercent=null;}else{
   const lc=round(q*scaled(unit)*100n,SCALE*SCALE);cost+=lc;const below=amount===0n?lc>0n:(amount-lc)*100n*SCALE<amount*threshold;
   lineBelow ||=below;Object.assign(row,{unitCost:String(unit),cost:money(lc),marginPercent:amount===0n?null:money((amount-lc)*10000n/amount),belowFloor:below});
  }}return row;
 });
 const out={lines:result,subtotal:money(net),cgst:money(cgst),sgst:money(sgst),igst:money(igst),total:money(net+cgst+sgst+igst),localTaxLabel:['04','26','31','35','38'].includes(sellerState)?'UTGST':'SGST'};
 if(costs)Object.assign(out,{cost:money(cost),missingCost,marginPercent:missingCost||net===0n?null:money((net-cost)*10000n/net),belowFloor:missingCost||((net===0n?cost>0n:(net-cost)*100n*SCALE<net*threshold)||(basis==='LINE_AND_TOTAL'&&lineBelow))});
 return out;
}
