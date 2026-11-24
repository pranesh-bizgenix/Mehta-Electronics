import fs from 'node:fs';
import {decimal,compare} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';

// Reference-only: never used to price a quotation or publish an approved list.
export function buildBaseCatalog(workbook,sourceSha256){
 if(workbook.sheet!=='master price')throw new Error('Select the master price sheet.');
 const source=workbook.rows.filter(r=>r.number>1&&r.cells[0]?.text?.trim());
 const counts=new Map();for(const r of source){const code=r.cells[0].text.trim();counts.set(code,(counts.get(code)??0)+1);}
 const rows=source.map(r=>{
  const cell=i=>r.cells[i],text=i=>cell(i)?.text?.trim()||null,code=text(0),issues=[];
  let price=text(2);
  if(cell(0)?.formula)issues.push('Article code is a formula');
  if(counts.get(code)>1)issues.push('Duplicate article code');
  if(cell(2)?.formula)issues.push('Price is a formula');
  try{if(!price||compare(decimal(price),decimal('0'))<=0)issues.push('Price needs review');}catch{issues.push('Price needs review');}
  if(issues.length)price=null;
  return {sourceRow:r.number,partCode:code,description:text(1),unitPrice:price,uom:text(7),edition:text(8),issues};
 });
 return {sourceName:'pricelist level wise.xlsx',sheet:'master price',sourceSha256,currency:'INR',referenceOnly:true,rows};
}

let cached;
export function baseCatalogPage(params,catalog){
 const pageText=params.get('page')??'1',search=(params.get('search')??'').trim();
 if(!/^[1-9]\d{0,5}$/.test(pageText)||search.length>200)throw validationFailed('Use a valid page and a search of at most 200 characters.');
 if(!catalog)catalog=cached??=JSON.parse(fs.readFileSync(new URL('./base-catalog.json',import.meta.url),'utf8'));
 const needle=search.toLowerCase(),rows=catalog.rows.filter(r=>!needle||r.partCode.toLowerCase().includes(needle)||(r.description??'').toLowerCase().includes(needle));
 const page=Number(pageText),pageSize=25,{rows:unused,...source}=catalog;
 return {data:rows.slice((page-1)*pageSize,page*pageSize),source,pagination:{page,pageSize,total:rows.length,pages:Math.ceil(rows.length/pageSize)}};
}
