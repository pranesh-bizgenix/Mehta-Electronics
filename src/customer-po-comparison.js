import {scaled} from '../public/quotation-math.js';
import {decimal,sub,mul,div,format,compare} from '../public/money.js';

const fields=['partCode','description','uom','quantity','unitPrice','discountPercent','taxPercent'];
const publicLine=line=>line?Object.fromEntries(fields.map(key=>[key,line[key]??''])):null;
const difference=(a,b)=>format(sub(decimal(a),decimal(b)),6);
const net=line=>div(mul(decimal(line.unitPrice),sub(decimal('100'),decimal(line.discountPercent))),decimal('100'));
const exactRate=value=>format(value,12).replace(/0+$/,'').replace(/\.$/,'');
const sameItem=(a,b)=>a.itemId!=null&&b.itemId!=null?String(a.itemId)===String(b.itemId):Boolean(a.partCode)&&a.partCode===b.partCode;

/** Compare saved customer instructions with the quotation captured when the PO was saved.
 * No fuzzy matching, unit conversion, price tolerance or private cost projection.
 */
export function compareCustomerPo(order,quote){
 const comparisons=[],flags=[];
 if(!quote)return {flags:['MANUAL_ORDER'],comparisons,linked:false,quoteTotal:null,quoteDifference:null};
 const used=new Set();
 for(const [index,line]of order.lines.entries()){
  const candidates=quote.lines.map((value,i)=>({value,i})).filter(({value})=>sameItem(line,value));
  const repeated=order.lines.filter(value=>sameItem(line,value)).length>1;
  const ambiguous=candidates.length>1||(candidates.length===1&&repeated);
  const match=!ambiguous&&candidates.length===1&&!used.has(candidates[0].i)?candidates[0]:null;
  const issues=[];let differences=[];
  if(!match)issues.push(ambiguous?'AMBIGUOUS_QUOTE_LINE':'PART_NOT_IN_QUOTE');
  else{
   used.add(match.i);
   for(const [field,code]of [['quantity','QUANTITY_DIFFERENCE'],['unitPrice','RATE_DIFFERENCE'],['discountPercent','DISCOUNT_DIFFERENCE'],['taxPercent','TAX_DIFFERENCE']]){
    if(scaled(line[field])!==scaled(match.value[field])){issues.push(code);differences.push({field,po:String(line[field]),quote:String(match.value[field]),delta:difference(line[field],match.value[field])});}
   }
   if(line.uom!==match.value.uom)issues.push('UOM_DIFFERENCE');
   const actual=net(line),quoted=net(match.value);
   if(compare(actual,quoted)!==0){issues.push('NET_RATE_DIFFERENCE');differences.push({field:'netUnitPrice',po:exactRate(actual),quote:exactRate(quoted),delta:exactRate(sub(actual,quoted))});}
  }
  comparisons.push({key:`po-${index}`,partCode:line.partCode,issues,po:publicLine(line),quote:publicLine(match?.value),differences});flags.push(...issues);
 }
 for(const [index,line]of quote.lines.entries())if(!used.has(index)){
  const ambiguous=order.lines.some(value=>sameItem(value,line));
  comparisons.push({key:`quote-${index}`,partCode:line.partCode,issues:[ambiguous?'AMBIGUOUS_QUOTE_LINE':'QUOTE_ITEMS_MISSING'],po:null,quote:publicLine(line),differences:[]});
  flags.push(ambiguous?'AMBIGUOUS_QUOTE_LINE':'QUOTE_ITEMS_MISSING');
 }
 if(order.placeOfSupply!==quote.placeOfSupply||order.sellerState!==quote.sellerState)flags.push('TAX_JURISDICTION_DIFFERENCE');
 const delta=sub(decimal(order.poTotal),decimal(quote.total));
 // Preserve the existing total-review gate; every line difference is still flagged exactly.
 if(compare(delta,decimal('1'))>0||compare(delta,decimal('-1'))<0)flags.push('QUOTE_TOTAL_DIFFERENCE_OVER_1');
 return {flags:[...new Set(flags)],comparisons,linked:true,quoteNumber:quote.quotation_number??null,quoteVersion:quote.version??null,quoteTotal:quote.total,poTotal:order.poTotal,quoteDifference:format(delta,2)};
}
