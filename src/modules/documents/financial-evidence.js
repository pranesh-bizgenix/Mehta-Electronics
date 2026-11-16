import {decimal,sub as subtract,mul as multiply,div as divide,compare,format,sumMoney} from '../../../public/money.js';

const amount='[\\d,]+(?:\\.\\d+)?';
const value=text=>{if(typeof text!=='string'||!/^[-+]?(?:\d+|\d{1,3}(?:,\d{2,3})+)(?:\.\d+)?$/.test(text.trim()))throw new Error('Financial document contains an unsupported decimal.');const result=text.trim().replaceAll(',','').replace(/^\+/,'');decimal(result);return result;};
const product=(quantity,rate)=>format(multiply(decimal(quantity),decimal(rate)),2);
const percent=(base,rate)=>format(divide(multiply(decimal(base),decimal(rate)),decimal('100')),2);
const difference=(a,b)=>format(subtract(decimal(a),decimal(b)),2);
const capture=(text,pattern,label)=>{const found=pattern.exec(text);if(!found)throw new Error(`Financial evidence missing: ${label}.`);return found;};
const absolute=text=>compare(decimal(text),decimal('0'))<0?format(multiply(decimal(text),decimal('-1')),2):text;
function checkLine(line){
 const computedNet=line.discountPercent===undefined?product(line.quantity,line.unitPrice):format(divide(multiply(multiply(decimal(line.quantity),decimal(line.unitPrice)),subtract(decimal('100'),decimal(line.discountPercent))),decimal('100')),2);
 const taxes=(line.taxes??[]).map(t=>({...t,computed:percent(line.net,t.rate)}));
 const computedTotal=taxes.length?sumMoney([line.net,...taxes.map(t=>t.computed)]):null;
 return {...line,computedNet,netMatches:compare(decimal(computedNet),decimal(line.net))===0,taxes:taxes.map(t=>({...t,matches:t.amount===undefined?null:compare(decimal(t.amount),decimal(t.computed))===0})),computedTotal,totalDifference:line.total===undefined||computedTotal===null?null:difference(line.total,computedTotal)};
}
function report(layout,lines,extra={}){
 if(!lines.length)throw new Error('No supported financial rows were extracted; manual review is required.');
 const checked=lines.map(checkLine);
 const net=sumMoney(checked.map(l=>l.net));
 return {layout,lines:checked,net,reviewRequired:checked.some(l=>!l.netMatches||l.sourceGaps?.length||l.taxes.some(t=>t.matches===false)||l.totalDifference!==null&&l.totalDifference!=='0.00'),...extra};
}

/** Financial evidence only, not an approved PO, an import or a business policy. */
export function financialEvidence(layout,{plain='',positioned=''}={}){
 if(typeof plain!=='string'||typeof positioned!=='string'||plain.length+positioned.length>12*1024*1024)throw new Error('Invalid or excessive financial evidence.');
 if(layout==='JOHNSON_PO_V1'){
  if(!/SNo\s+.*Material Description/.test(positioned))throw new Error('Unsupported Johnson financial table header.');
  const rows=[];
  const row=new RegExp(`^\\s*(\\d+)\\s+.*?\\s+(${amount})\\s+([A-Za-z]+)\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s*$`,'gm');
  for(const m of positioned.matchAll(row))rows.push({row:Number(m[1]),quantity:value(m[2]),uom:m[3],unitPrice:value(m[4]),net:value(m[5]),taxes:[{kind:'SGST',rate:value(m[6])},{kind:'CGST',rate:value(m[7])},{kind:'IGST',rate:value(m[8])}],total:value(m[9])});
  if(new Set(rows.map(r=>r.row)).size!==rows.length||rows.some((r,i)=>r.row!==i+1))throw new Error('Johnson table has duplicate or missing financial rows.');
  const result=report(layout,rows,{scope:'PRINTED_LINE_TOTALS',documentTotal:null});
  result.printedLineTotal=sumMoney(rows.map(r=>r.total));result.calculatedLineTotal=sumMoney(result.lines.map(r=>r.computedTotal));
  result.reviewRequired=result.lines.some(r=>!r.netMatches||r.totalDifference!=='0.00');
  result.warnings=['No document grand total is inferred from the schedule or amount-in-words.',...(result.reviewRequired?['Printed line totals differ from component rounding; no global rounding policy has been inferred.']:[])];return result;
 }
 if(layout==='KONE_PO_V1'){
  if(!/Item Material/.test(plain)||!/Total Amount with Tax/.test(plain))throw new Error('Unsupported KONE financial table header.');
  const rows=[],start=new RegExp(`^\\s*(\\d{5})\\s+\\S+\\s+(?:\\d{4,8}\\s+)?\\d{2}\\.\\d{2}\\.\\d{4}\\s+(${amount})\\s+(\\S+)\\s+(${amount})\\s*\\/\\s*(${amount})\\s*$`,'gm'),matches=[...plain.matchAll(start)];
  for(let i=0;i<matches.length;i++){
   const m=matches[i],block=plain.slice(m.index+m[0].length,matches[i+1]?.index??plain.length);
   const denominator=capture(block.split(/\b(?:CGST|SGST|IGST)\s+\d/)[0],new RegExp(`\\b(${amount})\\s+${m[3].replace(/[^\w]/g,'')}[ \\t]*$`,'m'),'price denominator');
   if(compare(decimal(value(denominator[1])),decimal('1'))!==0)throw new Error('Non-unit price denominator requires explicit unit conversion review.');
   const taxBlock=block.slice(0,block.indexOf('Total Amount with Tax'));
   const taxes=[...taxBlock.matchAll(new RegExp(`\\b(CGST|SGST|IGST)\\s+(${amount})%\\s+(${amount})`,'g'))].map(t=>({kind:t[1],rate:value(t[2]),amount:value(t[3])}));
   if(new Set(taxes.map(t=>t.kind)).size!==taxes.length)throw new Error('Ambiguous source tax components.');
   const total=capture(block,new RegExp(`Total Amount with Tax\\s+(${amount})`),'line total');
   const sourceGaps=[];if(!taxes.length)sourceGaps.push('TAX_NOT_PRINTED');if(!/^\s*\d{5}\s+\S+\s+\d{4,8}\s+\d{2}\./.test(m[0]))sourceGaps.push('HSN_NOT_PRINTED');
   rows.push({row:Number(m[1]),quantity:value(m[2]),uom:m[3],unitPrice:value(m[4]),net:value(m[5]),taxes,total:value(total[1]),sourceGaps});
  }
  if(rows.length!==(plain.match(/Total Amount with Tax/g)??[]).length)throw new Error('A printed KONE financial row was not extracted.');
  return report(layout,rows,{scope:'PRINTED_LINE_TOTALS',documentTotal:null});
 }
 if(layout==='CONNECTWELL_AO_V1'){
  if(!/ACCEPTANCE OF ORDER/.test(plain)||!/Total Net Value/.test(plain))throw new Error('Unsupported acceptance financial header.');
  const row=new RegExp(`(?:^|\\n)[ \\t]*([\\d,]+\\.\\d{4})[ \\t]+(${amount})[ \\t]*\\n([A-Z]+)[ \\t]*\\n[ \\t]*(${amount})[ \\t]+(${amount})[ \\t]*\\n\\d{2}\\.\\d{2}\\.\\d{4}`,'g');
  const rows=[...plain.matchAll(row)].map((m,i)=>({row:i+1,quantity:value(m[2]),uom:m[3],unitPrice:value(m[1]),net:value(m[4]),scheduleQuantity:value(m[5])}));
  const totals=capture(plain,new RegExp(`Total Net Value\\s+IGST\\s+TOTAL VALUE INR\\s+(${amount})\\s+(${amount})\\s+(${amount})`),'acceptance totals');
  const declaredNet=value(totals[1]),tax=value(totals[2]),total=value(totals[3]),result=report(layout,rows,{declaredNet,tax,total,scope:'NET_LINES_AND_PRINTED_TAX',warnings:['Tax rate is not inferred from the printed tax amount.']});
  result.netDifference=difference(result.net,declaredNet);result.totalDifference=difference(total,sumMoney([declaredNet,tax]));return result;
 }
 if(layout==='HCE_OA_V1'){
  if(!/ORDER ACCEPTANCE FORM/.test(plain)||!/Pkg\. Chrgs\./.test(plain))throw new Error('Unsupported HCE financial header.');
  const table=plain.slice(plain.indexOf('HSN Code Dis'),plain.indexOf('Packing Charges'));
  const start=new RegExp(`(?:^|\\s)(\\d+)\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s+(\\d+\\.\\d{2})`,'g'),matches=[...table.matchAll(start)],rows=[];
  for(let i=0;i<matches.length;i++){
   const m=matches[i],block=table.slice(m.index+m[0].length,matches[i+1]?.index??table.length);
   const tail=capture(block,new RegExp(`\\s+(${amount})\\s+(\\d+\\.\\d{2})\\d{8}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s+(\\d+(?:\\.\\d+)?)`),'HCE quantity/rate/discount');
   if(compare(decimal(value(m[4])),decimal('0'))!==0)throw new Error('HCE split-state tax requires a separately reviewed layout.');
   rows.push({row:Number(m[1]),quantity:value(tail[2]),unitPrice:value(tail[1]),discountPercent:value(tail[3]),net:value(m[2]),packing:value(m[3]),packingPercent:value(m[6]),sourceIgstRate:value(m[5])});
  }
  const packing=value(capture(plain,new RegExp(`Packing Charges\\s+(${amount})`),'packing total')[1]),base=value(capture(plain,new RegExp(`Total Amount\\s+(${amount})`),'taxable base')[1]);
  const taxMatch=capture(plain,new RegExp(`(${amount})\\s*IGST\\s+(${amount})\\s*%`),'printed IGST'),tax=value(taxMatch[1]),rate=value(taxMatch[2]);
  const adjustment=value(capture(plain,/Round Off\s+(-?[\d,]+(?:\.\d+)?)/,'explicit round-off')[1]),total=value(capture(plain,new RegExp(`Grand Total\\s+(${amount})`),'grand total')[1]);
  const result=report(layout,rows,{packing,base,tax,taxRate:rate,roundOff:adjustment,total,scope:'LINES_PACKING_TAX_AND_EXPLICIT_ROUND_OFF'});
  result.packingMatches=result.lines.every(l=>compare(decimal(percent(l.net,l.packingPercent)),decimal(l.packing))===0)&&compare(decimal(sumMoney(rows.map(l=>l.packing))),decimal(packing))===0;
  result.baseDifference=difference(base,sumMoney([result.net,packing]));result.taxDifference=difference(tax,percent(base,rate));result.totalDifference=difference(total,sumMoney([base,tax,adjustment]));return result;
 }
 if(layout==='DK_PO_V1'){
  if(!/List Price\s+Disc%/.test(positioned)||!/Sub Total/.test(positioned))throw new Error('Unsupported DK financial table header.');
  const row=new RegExp(`^\\s*(\\d+)\\s+.+?\\s+\\d{4,8}\\s+(${amount})\\s+(\\S+)\\s+(${amount})\\s+(${amount})\\s+(${amount})\\s*$`,'gm');
  const rows=[...positioned.matchAll(row)].map(m=>({row:Number(m[1]),quantity:value(m[2]),uom:m[3],unitPrice:value(m[4]),discountPercent:value(m[5]),net:value(m[6])}));
  const subtotal=value(capture(positioned,new RegExp(`Sub Total\\s+(${amount})`),'subtotal')[1]);
  const taxes=[...positioned.matchAll(new RegExp(`Add\\s*:\\s*(CGST|SGST|IGST)\\s+@\\s+(${amount})\\s*%\\s+(${amount})`,'g'))].map(m=>({kind:m[1],rate:value(m[2]),amount:value(m[3])}));
  if(!taxes.length)throw new Error('No printed tax evidence.');
  const round=capture(positioned,new RegExp(`Less\\s*:\\s*Rounded Off\\s*\\(-\\)\\s+(${amount})`),'signed rounding adjustment');
  const total=value(capture(positioned,new RegExp(`Grand Total[^\\n]*?\\x60\\s*(${amount})\\s*$`,'m'),'grand total')[1]);
  const adjustment='-'+value(round[1]),result=report(layout,rows,{declaredNet:subtotal,taxes,roundOff:adjustment,total,scope:'NET_LINES_TAX_AND_EXPLICIT_ROUND_OFF'});
  result.netDifference=difference(result.net,subtotal);result.taxMatches=taxes.every(t=>compare(decimal(t.amount),decimal(percent(subtotal,t.rate)))===0);result.totalDifference=difference(total,sumMoney([subtotal,...taxes.map(t=>t.amount),adjustment]));return result;
 }
 throw new Error('Choose an explicitly supported financial evidence layout.');
}

export function withinDocumentTolerance(differenceText,toleranceText){return compare(decimal(absolute(differenceText)),decimal(toleranceText))<=0;}
