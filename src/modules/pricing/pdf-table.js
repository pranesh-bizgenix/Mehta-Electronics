import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unavailable,validationFailed} from '../../core/errors.js';
const script=fileURLToPath(new URL('../../../scripts/lib/price-pdf-table.py',import.meta.url));
let activeExtractions=0;
/** One transient offline CLI, with no server, shell, network or filesystem upload. */
export async function extractPricePdf(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8388608||bytes.subarray(0,5).toString()!=='%PDF-')throw validationFailed('Choose a PDF of at most 8 MiB.');
 if(activeExtractions>=2)throw unavailable('PDF inspection is busy. Retry after another inspection finishes.','PDF_EXTRACTOR_BUSY');
 activeExtractions++;
 try{return await new Promise((resolve,reject)=>{
  const child=spawn('python',['-I',script],{windowsHide:true,stdio:['pipe','pipe','ignore']}),chunks=[];let size=0,settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{finish(unavailable('PDF extraction timed out. Split the source into smaller files.','PDF_EXTRACTION_TIMEOUT'));child.kill();},30000);
  child.on('error',()=>finish(unavailable('Offline PDF support requires Python and pypdf on the app host.','PDF_EXTRACTOR_UNAVAILABLE')));
  child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){finish(validationFailed('PDF layout exceeds the extraction limit.'));child.kill();}else chunks.push(chunk);});
  child.on('close',code=>{
   if(code===77)return finish(unavailable('Offline PDF support requires pypdf on the app host.','PDF_EXTRACTOR_UNAVAILABLE'));
   if(code===66)return finish(validationFailed('This PDF has no readable table text. Supply a text PDF or reviewed CSV/XLSX; OCR is not performed.'));
   if(code!==0)return finish(validationFailed('The PDF is damaged, encrypted or exceeds extraction limits.'));
   try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));validateLayout(value);finish(null,value);}catch{finish(validationFailed('The PDF extractor returned an invalid layout.'));}
  });
  child.stdin.end(bytes);
 });}finally{activeExtractions--;}
}
function validateLayout(layout){
 if(!layout||!Number.isSafeInteger(layout.pages)||layout.pages<1||layout.pages>1000||!Array.isArray(layout.rows)||layout.rows.length>20000)throw new Error('layout');
 for(const [index,row]of layout.rows.entries())if(row.number!==index+1||!Number.isSafeInteger(row.page)||row.page<1||row.page>layout.pages||typeof row.text!=='string'||row.text.length>2000)throw new Error('row');
}
/** Fixed character boundaries are supplied by the reviewer, never inferred. */
export function pdfLayoutTable(layout,columns){
 validateLayout(layout);
 if(columns!==undefined&&(!Array.isArray(columns)||!columns.length||columns.length>100))throw validationFailed('Set 1 to 100 explicit PDF column ranges.');
 if(columns)for(const [index,column]of columns.entries()){
  if(!column||!Number.isSafeInteger(column.start)||!Number.isSafeInteger(column.end)||column.start<0||column.end<=column.start||column.end>2000||index&&column.start<columns[index-1].end)throw validationFailed('PDF column ranges must be ordered, non-overlapping character positions from 0 to 2000.');
 }
 return {sheets:['PDF layout'],sheet:'PDF layout',pages:layout.pages,unmapped:!columns,rows:layout.rows.map(row=>({number:row.number,page:row.page,sourceText:row.text,cells:columns?columns.map(column=>({text:row.text.slice(column.start,column.end),type:'text',formula:false})):[{text:row.text,type:'text',formula:false}]}))};
}
