import {mkdir,writeFile} from 'node:fs/promises';
import {purchaseDocumentPdf} from '../src/purchase-document-pdf.js';
import {purchaseDocumentTotals} from '../src/purchase-document-math.js';

// File-only fictional fixtures; no database, document numbering or email writes.
const output='verification-output/purchase-order-format';
await mkdir(output,{recursive:true});
const line={partCode:'SAMPLE-ITEM-001',description:'Fictional electrical component for layout review only',make:'SAMPLE MAKE',hsn:'00000000',quantity:'2',uom:'NOS',unitPrice:'100',discountPercent:'10',taxPercent:'18',netRate:'90.00'};
const company={name:'Mehta Electric Corporation - SAMPLE ONLY',address:'[Registered address pending confirmation]',gstin:'[GSTIN pending confirmation]',contact:'[Contact pending confirmation]',stateCode:'33',footer:'Fictional data for layout review only',showListPriceDiscount:true};
for(const [name,state,showListPriceDiscount,count]of [['sample-po-cgst-sgst','33',true,1],['sample-po-igst','19',true,1],['sample-po-net-rate','33',false,1],['sample-po-multipage','33',true,40]]){
 const totals=purchaseDocumentTotals(Array.from({length:count},(_,i)=>({...line,partCode:`SAMPLE-ITEM-${String(i+1).padStart(3,'0')}`})),state,'33',true);
 const record={kind:'PO',number:'SAMPLE-PO/2026-27/000001',status:'DRAFT',payload:{company:{...company,showListPriceDiscount},supplier:{name:'SAMPLE supplier - fictional',address:'[Supplier address not supplied]',gstin:'[Supplier GSTIN not supplied]'},date:'2026-11-26',deliveryDate:'2026-12-01',paymentTerms:'[Payment terms not supplied]',freightPacking:'[Freight / packing not supplied]',billTo:'[Billing address not supplied]',shipTo:'[Delivery address not supplied]',signatory:'[Signatory not supplied]',terms:'[Purchasing terms pending confirmation]',lines:totals.lines,totals}};
 await writeFile(`${output}/${name}.pdf`,await purchaseDocumentPdf(record,{sample:true,draft:true}));
}
console.log(`Generated four fictional PO layout samples in ${output}; no database changes.`);
