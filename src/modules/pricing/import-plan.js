import {createHash} from 'node:crypto';
import {decimal,compare,format,mul} from '../../../public/money.js';
import {fingerprint} from '../../core/runtime.js';
import {validationFailed} from '../../core/errors.js';
const fail=message=>{throw validationFailed(message);};
const fields=['partCode','uom','unitPrice','minQuantity','discountPercent','edition','level','description'];
const required=['partCode','uom','unitPrice','minQuantity','discountPercent'];
const exact=/^\d{1,14}(?:\.\d{1,6})?$/;
const unitKey=text=>text.normalize('NFKC').trim().toUpperCase();
function column(mapping,key){const source=mapping.columns?.[key];if(source!==undefined){if(!Number.isSafeInteger(source)||source<0||source>=100)fail('Column mappings are zero-based indexes from 0 to 99.');return source;}if(typeof mapping.constants?.[key]==='string')return null;if(required.includes(key))fail(`Not set: price_import.mapping.${key}`);return undefined;}
/** Pure O(rows + items) plan. All metadata/constants come from the reviewing user. */
export function planPriceImport(table,mapping,items,{fileSha256,metadata}={}){
 if(!mapping||typeof mapping!=='object'||!Number.isSafeInteger(mapping.dataStartRow)||mapping.dataStartRow<1||mapping.dataStartRow>20000)fail('Select the first data row explicitly.');
 if(mapping.discountUnit!==undefined&&!['PERCENT','FRACTION'].includes(mapping.discountUnit))fail('Choose discount units: PERCENT (60) or FRACTION (0.60).');
 if(mapping.excludeRows!==undefined&&(!Array.isArray(mapping.excludeRows)||mapping.excludeRows.length>20000||mapping.excludeRows.some(n=>!Number.isSafeInteger(n)||n<1||n>20000)||new Set(mapping.excludeRows).size!==mapping.excludeRows.length))fail('Excluded source rows must be unique row numbers from 1 to 20,000.');
 const excluded=new Set(mapping.excludeRows??[]);
 const sourceNumbers=new Set(table.rows.map(row=>row.number));if([...excluded].some(n=>!sourceNumbers.has(n)))fail('Every excluded row must exist in the selected source.');
 for(const source of [mapping.columns??{},mapping.constants??{}])if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(k=>!fields.includes(k)))fail('Unsupported price-import mapping field.');
 const resolved=Object.fromEntries(fields.map(key=>[key,column(mapping,key)])),used=Object.values(resolved).filter(v=>typeof v==='number');
 if(new Set(used).size!==used.length||fields.some(k=>mapping.columns?.[k]!==undefined&&mapping.constants?.[k]!==undefined))fail('Each column may have one meaning; choose a column or an explicit constant per field.');
 const index=new Map();for(const item of items){const key=String(item.part_code).trim().toUpperCase(),matches=index.get(key)??[];matches.push(item);index.set(key,matches);}
 const input=table.rows.filter(r=>r.number>=mapping.dataStartRow&&!excluded.has(r.number)&&r.cells.some(c=>c?.text?.trim()||c?.formula));if(!input.length||input.length>15000)fail('Select between 1 and 15,000 non-empty price rows.');
 const seen=new Set(),rows=input.map(row=>{
  const values={},issues=[];for(const key of fields){const source=resolved[key],cell=typeof source==='number'?row.cells[source]:null;values[key]=source===null?mapping.constants[key]:cell?.text??'';if(typeof values[key]!=='string'||values[key].length>2000)fail('Mapped values must be bounded literal text.');values[key]=values[key].trim();if(cell?.formula)issues.push(`${key}: formula values require literal-value review`);if(cell&&['e','b','d'].includes(cell.type))issues.push(`${key}: unsupported cell type`);}
  const sourceDiscount=values.discountPercent;
  if(mapping.discountUnit==='FRACTION'){
   if(!/^\d{1,2}(?:\.\d{1,8})?$/.test(sourceDiscount)||compare(decimal(sourceDiscount),decimal('1'))>0)issues.push('discountPercent: a fractional discount must be 0 to 1 with at most eight decimal places');
   else values.discountPercent=format(mul(decimal(sourceDiscount),decimal('100')),6);
  }
  for(const key of required)if(!values[key])issues.push(`${key}: not supplied`);
  if(values.partCode.length>200||values.uom.length>40||values.edition.length>200||values.level.length>200)issues.push('Identifier, unit, edition or level text is too long');
  for(const key of ['unitPrice','minQuantity','discountPercent'])if(!exact.test(values[key]))issues.push(`${key}: use a plain exact decimal with at most six places`);
  if(exact.test(values.minQuantity)&&compare(decimal(values.minQuantity),decimal('0'))<=0)issues.push('minQuantity: must be positive');
  if(exact.test(values.discountPercent)&&compare(decimal(values.discountPercent),decimal('100'))>0)issues.push('discountPercent: must be 0 to 100');
  const matches=index.get(values.partCode.toUpperCase())??[],item=matches.length===1?matches[0]:null;
  if(!item||item.status!=='ACTIVE')issues.push('partCode: must identify exactly one active CRM product');
  if(item&&unitKey(values.uom)!==unitKey(String(item.uom??'')))issues.push('uom: differs from the CRM unit; no conversion inferred');
  const minimum=exact.test(values.minQuantity)?format(decimal(values.minQuantity),6):values.minQuantity,key=`${values.partCode.toUpperCase()}\0${minimum}`;
  if(seen.has(key))issues.push('Duplicate part code and minimum quantity in this file');seen.add(key);
  return {sourceRow:row.number,...values,...(mapping.discountUnit==='FRACTION'?{sourceDiscount}:{}),itemId:item?.id??null,itemRevision:item?.updated_at??null,issues};
 });
 // Both copies of a duplicate need a visible error, not only the later row.
 const duplicates=new Map();for(const row of rows){const minimum=exact.test(row.minQuantity)?format(decimal(row.minQuantity),6):row.minQuantity,key=`${row.partCode.toUpperCase()}\0${minimum}`,group=duplicates.get(key)??[];group.push(row);duplicates.set(key,group);}for(const group of duplicates.values())if(group.length>1)for(const row of group)if(!row.issues.some(i=>i.startsWith('Duplicate')))row.issues.push('Duplicate part code and minimum quantity in this file');
 return {rows,excludedSourceRows:[...excluded],validRows:rows.filter(r=>!r.issues.length).length,invalidRows:rows.filter(r=>r.issues.length).length,canSave:rows.every(r=>!r.issues.length),fileSha256,previewFingerprint:fingerprint({fileSha256,metadata,mapping,rows})};
}
export const priceFileHash=bytes=>createHash('sha256').update(bytes).digest('hex');
