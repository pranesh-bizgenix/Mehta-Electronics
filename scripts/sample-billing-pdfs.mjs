// File-only fictional examples. Never opens a database or issues a legal invoice.
import fs from 'node:fs';
import path from 'node:path';
import {invoicePayload} from '../src/modules/billing/domain.js';
import {invoicePdf,renderPdf} from '../src/modules/billing/pdf.js';
const dir=path.resolve('output/billing-pdf-samples');fs.mkdirSync(dir,{recursive:true});
const company={name:'TEST ONLY - fictional Mehta issuer',address:'TEST ONLY address',gstin:'33ABCDE1234F1Z5',contact:'fictional@example.test',signatory:'TEST ONLY'};
for(const state of ['33','27']){
 const payload=invoicePayload({date:'2026-11-21',placeOfSupply:state,billTo:'TEST ONLY bill-to',shipTo:'TEST ONLY ship-to',terms:'Fictional example only; no commercial terms agreed.',lines:[{code:'TEST-ITEM',description:'Fictional electrical item',hsn:'8536',uom:'NOS',quantity:'2',unitPrice:'100',taxPercent:'18'}]}, {id:1,name:'TEST ONLY customer'},company);
 fs.writeFileSync(path.join(dir,`invoice-draft-${state}.pdf`),await invoicePdf({id:'TEST-'+state,status:'DRAFT',payload}));
}
fs.writeFileSync(path.join(dir,'report-pagination.pdf'),await renderPdf({title:'TEST ONLY task report',subtitle:'Fictional examples - not business records',sections:[],columns:[{label:'Task',fraction:.7},{label:'Status',fraction:.3}],rows:Array.from({length:200},(_,i)=>[`TEST task ${i+1}`,'OPEN'])}));
console.log(`Fictional PDF samples saved to ${dir}`);
