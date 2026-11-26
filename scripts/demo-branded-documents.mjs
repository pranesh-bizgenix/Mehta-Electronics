import fs from 'node:fs';
import path from 'node:path';
import {quotationPdf} from '../src/quotation-document.js';
import {createQuotationPdf} from '../src/quotation-pdf.js';
import {invoicePayload} from '../src/modules/billing/domain.js';
import {invoicePdf} from '../src/modules/billing/pdf.js';

// File-only previews: no database, invoice issuance or numbering allocation.
const destination=path.resolve('output/document-branding');
fs.mkdirSync(destination,{recursive:true});
const company='MEHTA ELECTRIC CORPORATION';
const quote={quotation_number:'TEST-DEMO-QUOTATION',version:1,status:'DRAFT',letterhead:{name:company,address:'[Company address pending confirmation]'},customer_name:'TEST_ Fictional Buyer',customerAddress:'[Demo customer address]',validUntil:'2026-11-27',sellerState:'33',placeOfSupply:'33',subtotal:'200.00',cgst:'18.00',sgst:'18.00',igst:'0.00',total:'236.00',notes:'TEST_ Logo and layout preview only. Not for customer issue.',lines:[{partCode:'TEST-DEMO-ITEM',description:'Fictional electrical component',hsn:'',uom:'NOS',quantity:'2',unitPrice:'100',discountPercent:'0',taxPercent:'18',net:'200.00'}]};
fs.writeFileSync(path.join(destination,'quotation-logo-demo.pdf'),await quotationPdf(quote));
fs.writeFileSync(path.join(destination,'legacy-quotation-logo-demo.pdf'),await createQuotationPdf({companyName:company,companyAddress:'[Company address pending confirmation]'},{quotation_number:quote.quotation_number,revision_number:1,customer_name:quote.customer_name,valid_until:quote.validUntil,subtotal:quote.subtotal,tax_total:'36.00',total:quote.total,notes:quote.notes,lines:[{part_code:'TEST-DEMO-ITEM',description:quote.lines[0].description,uom:'NOS',quantity:'2',unit_price:'100',discount_percent:'0',tax_percent:'18'}]}));

const invoice=await invoicePdf({id:'TEST-DEMO-INVOICE',status:'DRAFT',payload:invoicePayload({date:'2026-11-26',placeOfSupply:'33',billTo:'[Demo customer address]',shipTo:'[Demo delivery address]',terms:'',lines:[{code:'TEST-DEMO-ITEM',description:'Fictional electrical component - layout preview only',hsn:'8536',uom:'NOS',quantity:'2',unitPrice:'100',taxPercent:'18'}]}, {id:1,name:'TEST ONLY - Fictional Buyer'}, {name:company,address:'[Company address pending confirmation]',gstin:'',contact:'',signatory:'[Signatory pending confirmation]'})});
fs.writeFileSync(path.join(destination,'invoice-layout-logo-demo.pdf'),invoice);
console.log('Demo PDFs saved to '+destination);
