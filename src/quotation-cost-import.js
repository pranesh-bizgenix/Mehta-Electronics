import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {validationFailed,forbidden} from './core/errors.js';
import {hasPermission} from './rbac.js';
import {costErrors} from '../public/quotation-setup-validation.js';

const invalid=message=>{throw validationFailed(message);};
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function unzip(bytes){
 const files=new Map();let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))invalid('Use an ordinary single-volume .xlsx file.');
 const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16),total=0;
 if(count>128||count!==bytes.readUInt16LE(end+8)||at+bytes.readUInt32LE(end+12)!==end)invalid('Invalid or oversized workbook directory.');
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)invalid('Invalid workbook directory.');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),crc=bytes.readUInt32LE(at+16),packed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),len=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
  if(at+46+len+extra+comment>end)invalid('Invalid workbook entry.');
  const name=bytes.subarray(at+46,at+46+len).toString('utf8');at+=46+len+extra+comment;total+=size;
  if(flags&1||![0,8].includes(method)||total>8*1024*1024||size>4*1024*1024||files.has(name)||name.includes('..')||name.includes('\\')||name.startsWith('/'))invalid('Encrypted, duplicate, unsafe or oversized workbook entries are not supported.');
  if(offset+30>end||bytes.readUInt32LE(offset)!==0x04034b50)invalid('Invalid workbook local header.');
  const localLen=bytes.readUInt16LE(offset+26),start=offset+30+localLen+bytes.readUInt16LE(offset+28);
  if(start+packed>end||bytes.subarray(offset+30,offset+30+localLen).toString('utf8')!==name||bytes.readUInt16LE(offset+8)!==method)invalid('Invalid workbook entry bounds.');
  const source=bytes.subarray(start,start+packed),data=method===8?inflateRawSync(source,{maxOutputLength:4*1024*1024}):source;
  if(data.length!==size||crc32(data)!==crc)invalid('Workbook integrity check failed.');files.set(name,data.toString('utf8'));
 }
 if(at!==end)invalid('Invalid workbook directory size.');return files;
}
function xml(text){
 if(typeof text!=='string'||/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)invalid('Invalid workbook XML.');
 return new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,processEntities:true}).parse(text);
}
function rich(v){return typeof v==='string'?v: v?.t!=null?String(v.t?.['#text']??v.t):array(v?.r).map(r=>rich(r)).join('');}
function workbook(bytes){
 const files=unzip(bytes),book=xml(files.get('xl/workbook.xml')),sheets=array(book.workbook?.sheets?.sheet);
 if(sheets.length!==1)invalid('Use a workbook containing exactly one worksheet for cost import.');
 const rels=array(xml(files.get('xl/_rels/workbook.xml.rels')).Relationships?.Relationship),rel=rels.find(r=>r['@_Id']===sheets[0]['@_id']);
 const target=rel?.['@_Target'];
 if(!target||rel['@_TargetMode']==='External'||!/^\/?(?:xl\/)?worksheets\/[^/]+\.xml$/.test(target))invalid('Unsupported worksheet relationship.');
 const path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:`xl/${target}`;
 const shared=files.has('xl/sharedStrings.xml')?array(xml(files.get('xl/sharedStrings.xml')).sst?.si).map(rich):[];
 return array(xml(files.get(path)).worksheet?.sheetData?.row).map(row=>{
  const values=[];
  for(const cell of array(row.c)){
   if(Object.hasOwn(cell,'f'))invalid('Formulas are not accepted. Paste literal values before importing.');
   const ref=/^([A-Z]{1,3})\d+$/.exec(cell['@_r']??'');if(!ref)invalid('Every spreadsheet cell needs a valid address.');
   let index=0;for(const ch of ref[1])index=index*26+ch.charCodeAt(0)-64;index--;
   if(index>20||values[index]!==undefined)invalid('Use a simple table with at most 21 columns.');
   const type=cell['@_t'];let value;
   if(type==='s'){if(!/^\d+$/.test(cell.v??'')||shared[Number(cell.v)]===undefined)invalid('Invalid shared string.');value=shared[Number(cell.v)];}
   else if(type==='inlineStr')value=rich(cell.is);
   else if(type==null||type==='n'||type==='str')value=String(cell.v??'');
   else invalid('Use text or ordinary numeric cells, without dates, errors or boolean values.');
   values[index]=value;
  }return values;
 });
}
export function parseCostCsv(text){
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'){if(cell||closed)invalid('Malformed CSV quoting.');quoted=true;}
  else if(ch===','||ch==='\n'||ch==='\r'){row.push(cell);cell='';closed=false;if(ch!==','){rows.push(row);row=[];if(ch==='\r'&&text[i+1]==='\n')i++;}}
  else{if(closed)invalid('Unexpected characters after a CSV quote.');cell+=ch;}
  if(rows.length>1001||row.length>21)invalid('Import at most 1,000 rows and 21 columns.');
 }
 if(quoted)invalid('Unclosed CSV quote.');if(cell||row.length||closed){row.push(cell);rows.push(row);}return rows;
}
export function parseCostFile(body){
 if(typeof body.filename!=='string'||body.filename.length>200||! /\.(csv|xlsx)$/i.test(body.filename))invalid('Choose a .csv or .xlsx file (.xls is not supported).');
 if(typeof body.base64!=='string'||body.base64.length>700000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64))invalid('Invalid upload. Maximum file size is 512 KB.');
 const bytes=Buffer.from(body.base64,'base64');if(!bytes.length||bytes.length>512*1024)invalid('Choose a non-empty file of at most 512 KB.');
 let table;
 try{table=/\.csv$/i.test(body.filename)?parseCostCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'')):workbook(bytes);}catch(error){if(error.status)throw error;invalid('The workbook or UTF-8 CSV is damaged or unsupported.');}
 table=table.filter(row=>row.some(v=>String(v??'').trim()));
 if(table.length<2||table.length>1001)invalid('Include a header and between 1 and 1,000 item rows.');
 const headers=table.shift().map(v=>String(v??'').trim().toLowerCase());
 if(headers.length!==2||!headers.includes('part_code')||!headers.includes('unit_cost'))invalid('Use exactly these two column headers: part_code,unit_cost.');
 return table.map((row,i)=>({row:i+2,partCode:String(row[headers.indexOf('part_code')]??'').trim(),unitCost:String(row[headers.indexOf('unit_cost')]??'').trim(),extra:row.length>headers.length}));
}
export async function previewQuoteCosts(db,body,user,lock=false){
 if(!hasPermission(user,'quotations.cost.manage')||!hasPermission(user,'quotations.cost.read'))throw forbidden();
 const errors=costErrors({unitCost:'0',reason:body.reason});if(errors.reason)throw validationFailed(errors.reason,{fields:[{path:'reason',message:errors.reason}]});
 const input=parseCostFile(body),seen=new Set(),rows=[];
 for(const row of input){
  const issues=[],key=row.partCode.toLowerCase();
  if(!key||row.partCode.length>200)issues.push('Enter a CRM part code.');
  if(seen.has(key))issues.push('Duplicate part code in this file.');seen.add(key);
  const error=costErrors({unitCost:row.unitCost,reason:body.reason}).unitCost;if(error)issues.push(error);
  if(row.extra)issues.push('Unexpected extra columns.');
  const matches=key?await db.prepare(`SELECT i.id,i.part_code,i.description,i.updated_at::text AS item_version,c.unit_cost::text AS current_cost,c.updated_at::text AS cost_version FROM items i LEFT JOIN crm_quotation_costs c ON c.item_id=i.id WHERE i.part_code=? AND i.status='ACTIVE'${lock?' FOR SHARE OF i':''}`).all(row.partCode):[];
  const item=matches.length===1?matches[0]:null;if(!item)issues.push('Part code must identify one active CRM item.');
  rows.push({...row,itemId:item?.id??null,description:item?.description??'',currentCost:item?.current_cost??null,itemVersion:item?.item_version??null,costVersion:item?.cost_version??null,issues});
 }
 const fingerprint=createHash('sha256').update(JSON.stringify({file:body.base64,filename:body.filename,reason:body.reason,rows})).digest('hex');
 return{rows,fingerprint,canSave:rows.every(row=>!row.issues.length)};
}
