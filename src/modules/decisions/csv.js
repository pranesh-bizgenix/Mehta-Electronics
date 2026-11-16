import {validationFailed} from '../../core/errors.js';
export const MAX_DECISION_CSV_BYTES=262144;
export function csvCell(value){const text=String(value??''),safe=/^[\s\uFEFF]*[=+@-]/u.test(text)?`'${text}`:text;return `"${safe.replaceAll('"','""')}"`;}
export function decisionCsv(rows){return [['key','question','status','value','evidence_source','answer','version'],...rows.map(r=>[r.key,r.plainQuestion,r.status,r.value===null?'':JSON.stringify(r.value),r.evidenceSource??'','',r.version])].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
// RFC 4180-style bounded literal reader. Formula cells are never executed.
export function readDecisionCsv(text){
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_DECISION_CSV_BYTES)throw validationFailed('Decision CSV must be UTF-8 text at most 256 KiB.');
 const input=text.replace(/^\uFEFF/u,''),rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw validationFailed('CSV has a quote outside a quoted field.');quoted=true;continue;}
  if(c===','||c==='\r'||c==='\n'){
   row.push(cell);cell='';closed=false;
   if(c!==','){if(c==='\r'&&input[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}
  }else{if(closed)throw validationFailed('CSV has characters after a closing quote.');cell+=c;}
 }
 if(quoted)throw validationFailed('CSV contains an unclosed quoted field.');
 if(cell||closed||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}
 if(rows.length<2||rows.length>201)throw validationFailed('Provide a header and between 1 and 200 decision rows.');
 const header=rows.shift().map(v=>v.trim()),allowed=new Set(['key','question','status','value','evidence_source','answer','version']);
 if(new Set(header).size!==header.length||header.some(v=>!allowed.has(v))||!['key','answer','version'].every(k=>header.includes(k)))throw validationFailed('CSV needs unique key, answer and version columns; export the decision sheet for the full template.');
 return rows.map((values,index)=>{if(values.length!==header.length)throw validationFailed(`CSV row ${index+2} has a different column count.`);return {row:index+2,...Object.fromEntries(header.map((key,i)=>[key,values[i]]))};});
}
