import {inflateRawSync} from 'node:zlib';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {validationFailed} from '../../core/errors.js';
const fail=message=>{throw validationFailed(message);};
const list=v=>v==null?[]:Array.isArray(v)?v:[v];
const MAX_XML=32*1024*1024,MAX_TOTAL=64*1024*1024,MAX_ROWS=20000,MAX_COLUMNS=100;
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function unzip(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>8*1024*1024)fail('Choose a non-empty XLSX file of at most 8 MiB.');
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))fail('Use an ordinary single-volume XLSX workbook.');
 const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16),total=0;const files=new Map();
 if(count>512||count!==bytes.readUInt16LE(end+8)||at+bytes.readUInt32LE(end+12)!==end)fail('Invalid or excessive workbook directory.');
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)fail('Invalid workbook directory.');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),crc=bytes.readUInt32LE(at+16),packed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
  if(at+46+length+extra+comment>end)fail('Invalid workbook entry.');const name=bytes.subarray(at+46,at+46+length).toString('utf8');at+=46+length+extra+comment;total+=size;
  if(flags&1||![0,8].includes(method)||size>MAX_XML||total>MAX_TOTAL||files.has(name)||name.includes('..')||name.includes('\\')||name.startsWith('/')||/vbaProject|externalLinks|embeddings/i.test(name))fail('Encrypted, unsafe, external-linked, macro or excessive workbook entries are not accepted.');
  if(offset+30>end||bytes.readUInt32LE(offset)!==0x04034b50)fail('Invalid workbook local header.');
  const localLength=bytes.readUInt16LE(offset+26),start=offset+30+localLength+bytes.readUInt16LE(offset+28);
  if(start+packed>end||bytes.subarray(offset+30,offset+30+localLength).toString('utf8')!==name||bytes.readUInt16LE(offset+8)!==method)fail('Invalid workbook entry bounds.');
  const compressed=bytes.subarray(start,start+packed),data=method===8?inflateRawSync(compressed,{maxOutputLength:MAX_XML}):compressed;
  if(data.length!==size||crc32(data)!==crc)fail('Workbook integrity check failed.');files.set(name,data.toString('utf8'));
 }
 if(at!==end)fail('Invalid workbook directory length.');return files;
}
function xml(text){if(typeof text!=='string'||/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)fail('Invalid workbook XML.');return new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false}).parse(text);}
function rich(value){return typeof value==='string'?value:value?.t!=null?String(value.t?.['#text']??value.t):list(value?.r).map(rich).join('');}
function rowCells(row,shared){
 const cells=[];
 for(const cell of list(row.c)){
  const match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(cell['@_r']??'');if(!match)fail('Every cell needs a valid address.');
  let column=0;for(const letter of match[1])column=column*26+letter.charCodeAt(0)-64;column--;
  if(column>=MAX_COLUMNS||cells[column]!==undefined||Number(match[2])!==Number(row['@_r']))fail('Invalid, duplicate or excessive worksheet cell.');
  const type=cell['@_t'];let text='';
  if(type==='s'){if(!/^\d+$/.test(cell.v??'')||shared[Number(cell.v)]===undefined)fail('Invalid shared string.');text=shared[Number(cell.v)];}
  else if(type==='inlineStr')text=rich(cell.is);
  else if(type==null||['n','str','b','e','d'].includes(type))text=String(cell.v??'');else fail('Unsupported spreadsheet cell encoding.');
  if(text.length>2000)fail('A worksheet cell exceeds 2,000 characters.');
  cells[column]={text,type:type??'n',formula:Object.hasOwn(cell,'f')};
 }return cells;
}
/** Literal values only. No formula evaluation, currency coercion or edition-number conversion. */
export function readPriceWorkbook(bytes,selectedSheet){
 try{
  const files=unzip(bytes),sheets=list(xml(files.get('xl/workbook.xml')).workbook?.sheets?.sheet);
  if(!sheets.length||sheets.length>30)fail('Choose a workbook with between 1 and 30 worksheets.');
  const names=sheets.map(s=>String(s['@_name']??''));if(new Set(names).size!==names.length)fail('Duplicate worksheet names are ambiguous.');
  if(selectedSheet==null)return {sheets:names};
  const sheet=sheets.find(s=>s['@_name']===selectedSheet);if(!sheet)fail('Select an exact worksheet name.');
  const relation=list(xml(files.get('xl/_rels/workbook.xml.rels')).Relationships?.Relationship).find(r=>r['@_Id']===sheet['@_id']);
  const target=relation?.['@_Target'];if(!target||relation['@_TargetMode']==='External'||!/^\/?(?:xl\/)?worksheets\/[^/]+\.xml$/.test(target))fail('Unsupported worksheet relationship.');
  const filename=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:`xl/${target}`;
  const shared=files.has('xl/sharedStrings.xml')?list(xml(files.get('xl/sharedStrings.xml')).sst?.si).map(rich):[];
  const data=xml(files.get(filename)).worksheet;if(data?.sheetProtection)fail('Remove sheet protection before reviewed import.');
  const source=list(data?.sheetData?.row);if(source.length>MAX_ROWS)fail('Selected worksheet exceeds 20,000 source rows.');
  const seen=new Set(),rows=source.map(row=>{const number=Number(row['@_r']);if(!Number.isSafeInteger(number)||number<1||number>MAX_ROWS||seen.has(number))fail('Invalid or duplicate worksheet row.');seen.add(number);return {number,cells:rowCells(row,shared)};});
  rows.sort((a,b)=>a.number-b.number);return {sheets:names,sheet:selectedSheet,rows};
 }catch(error){if(error.status)throw error;fail('The XLSX workbook is damaged or exceeds safe extraction limits.');}
}
export function readPriceCsv(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>8*1024*1024||text.includes('\u0000'))fail('Invalid or excessive UTF-8 CSV.');
 text=text.replace(/^\uFEFF/,'');const rows=[];let cells=[],textValue='',quoted=false,closed=false,number=1;
 const cell=()=>{if(textValue.length>2000||cells.length>=MAX_COLUMNS)fail('CSV cell or column limit exceeded.');cells.push({text:textValue,type:'text',formula:/^[=]/.test(textValue)});textValue='';closed=false;};
 const row=()=>{cell();rows.push({number:number++,cells});cells=[];if(rows.length>MAX_ROWS)fail('CSV exceeds 20,000 source rows.');};
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){textValue+='"';i++;}else{quoted=false;closed=true;}}else textValue+=ch;continue;}
  if(ch==='"'){if(textValue||closed)fail('Malformed CSV quoting.');quoted=true;}
  else if(ch===',')cell();else if(ch==='\r'||ch==='\n'){row();if(ch==='\r'&&text[i+1]==='\n')i++;}
  else{if(closed)fail('Unexpected characters after a CSV quote.');textValue+=ch;}
 }
 if(quoted)fail('Unclosed CSV quote.');if(textValue||cells.length||closed)row();return {sheets:['CSV'],sheet:'CSV',rows};
}
