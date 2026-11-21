import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import {quotationPdf,amountInWords} from '../src/quotation-document.js';
import {createQuotationPdf} from '../src/quotation-pdf.js';
import {drawCompanyLogo} from '../src/document-branding.js';
import {purchaseDocumentTotals} from '../src/purchase-document-math.js';

// File-only previews: no database, invoice issuance or numbering allocation.
const destination=path.resolve('output/document-branding');
fs.mkdirSync(destination,{recursive:true});
const company='MEHTA ELECTRIC CORPORATION';
const quote={quotation_number:'TEST-DEMO-QUOTATION',version:1,status:'DRAFT',letterhead:{name:company,address:'[Company address pending confirmation]'},customer_name:'TEST_ Fictional Buyer',customerAddress:'[Demo customer address]',validUntil:'2026-11-27',sellerState:'33',placeOfSupply:'33',subtotal:'200.00',cgst:'18.00',sgst:'18.00',igst:'0.00',total:'236.00',notes:'TEST_ Logo and layout preview only. Not for customer issue.',lines:[{partCode:'TEST-DEMO-ITEM',description:'Fictional electrical component',hsn:'',uom:'NOS',quantity:'2',unitPrice:'100',discountPercent:'0',taxPercent:'18',net:'200.00'}]};
fs.writeFileSync(path.join(destination,'quotation-logo-demo.pdf'),await quotationPdf(quote));
fs.writeFileSync(path.join(destination,'legacy-quotation-logo-demo.pdf'),await createQuotationPdf({companyName:company,companyAddress:'[Company address pending confirmation]'},{quotation_number:quote.quotation_number,revision_number:1,customer_name:quote.customer_name,valid_until:quote.validUntil,subtotal:quote.subtotal,tax_total:'36.00',total:quote.total,notes:quote.notes,lines:[{part_code:'TEST-DEMO-ITEM',description:quote.lines[0].description,uom:'NOS',quantity:'2',unit_price:'100',discount_percent:'0',tax_percent:'18'}]}));

const invoice=await new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:48,info:{Title:'Invoice layout demo - not for issue'}}),chunks=[];
 doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 const totals=purchaseDocumentTotals([{quantity:'2',unitPrice:'100',discountPercent:'0',taxPercent:'18'}],'33','33');
 doc.rect(0,0,doc.page.width,6).fill('#125c40');drawCompanyLogo(doc,48,26,60);
 doc.fillColor('#1c2a24').font('Helvetica-Bold').fontSize(13).text(company,122,33,{width:365});
 doc.font('Helvetica').fontSize(9).fillColor('#5e6b64').text('[Company address and GSTIN pending confirmation]',122,56,{width:365});
 doc.moveTo(48,102).lineTo(547,102).strokeColor('#dfe5e1').stroke();
 doc.fillColor('#125c40').font('Helvetica-Bold').fontSize(22).text('Invoice layout demo',48,122);
 doc.fillColor('#a8321f').fontSize(10).text('DEMO ONLY - NOT A TAX INVOICE - NOT FOR ISSUE',48,155);
 doc.font('Helvetica').fontSize(10).fillColor('#1c2a24').text('Reference: TEST-DEMO-INVOICE',48,187).text('Demo date: 20 November 2026',48,205);
 doc.font('Helvetica-Bold').fontSize(10).text('BILL TO',48,246);
 doc.font('Helvetica').fontSize(11).text('TEST_ Fictional Buyer',48,266).fontSize(9).text('[Demo customer address]',48,285);
 doc.rect(48,326,499,28).fill('#125c40');doc.fillColor('white').font('Helvetica-Bold').fontSize(9);
 doc.text('Item / description',58,336,{width:270}).text('Qty',330,336,{width:45,align:'right'}).text('Rate (INR)',386,336,{width:70,align:'right'}).text('Amount (INR)',462,336,{width:75,align:'right'});
 doc.fillColor('#1c2a24').font('Helvetica').text('TEST-DEMO-ITEM',58,369,{width:260}).text('Fictional electrical component',58,385,{width:260});
 doc.text('2 NOS',330,369,{width:45,align:'right'}).text('100.00',386,369,{width:70,align:'right'}).text(totals.subtotal,462,369,{width:75,align:'right'});
 let y=435;for(const [label,value]of [['Taxable value',totals.subtotal],['CGST (demo)',totals.cgst],['SGST (demo)',totals.sgst],['Total INR',totals.total]]){
  doc.font(label==='Total INR'?'Helvetica-Bold':'Helvetica').fontSize(11).text(label,340,y,{width:110}).text(value,455,y,{width:82,align:'right'});y+=24;
 }
 doc.font('Helvetica').fontSize(10).text(amountInWords(totals.total),48,565,{width:499});
 doc.fillColor('#5e6b64').fontSize(9).text('Logo and layout preview only. No legal terms, bank details or invoice numbering policy are established by this demo.',48,625,{width:499});
 doc.save().opacity(.08).translate(300,440).rotate(-30).font('Helvetica-Bold').fontSize(75).text('DEMO',-140,-35,{width:300});doc.restore();doc.end();
});
fs.writeFileSync(path.join(destination,'invoice-layout-logo-demo.pdf'),invoice);
console.log('Demo PDFs saved to '+destination);
