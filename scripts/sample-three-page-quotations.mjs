import {mkdir,writeFile} from 'node:fs/promises';
import {quotationPdf,quotationPrintHtml} from '../src/quotation-document.js';
import {createQuotationPdf} from '../src/quotation-pdf.js';
import {calculateQuotation} from '../public/quotation-math.js';
const output='verification-output/quotation-format';await mkdir(output,{recursive:true});
const company={name:'Mehta Electric Corporation - SAMPLE ONLY',address:'[Registered address pending confirmation]',gstin:'[GSTIN pending confirmation]',email:'sample@example.test'};
const item={partCode:'SAMPLE-ITEM-001',description:'Fictional electrical component for layout review only',hsn:'00000000',quantity:'2',uom:'NOS',unitPrice:'100',discountPercent:'10',taxPercent:'18',requestDetails:{make:'SAMPLE MAKE'}};
for(const [name,state,count]of [['sample-quotation-cgst-sgst','33',2],['sample-quotation-igst','27',2],['sample-quotation-long','33',40]]){
 const q={quotation_number:'SAMPLE-QTN/2026-27/000001',documentDate:'2026-11-26',version:1,status:'DRAFT',letterhead:company,customer_name:'SAMPLE customer - fictional',customerAddress:'[Customer billing address not supplied]',validUntil:'2026-12-10',sellerState:'33',placeOfSupply:state,request:{reference:'SAMPLE-RFQ-001'},terms:'[Approved payment terms not supplied]\n[Delivery timeline not supplied]\n[Warranty terms not supplied]\n[Exclusions not supplied]',notes:'Fictional data for layout review only.',...calculateQuotation(Array.from({length:count},(_,i)=>({...item,partCode:`SAMPLE-ITEM-${String(i+1).padStart(3,'0')}`})),'33',state)};
 await writeFile(`${output}/${name}.pdf`,await quotationPdf(q));await writeFile(`${output}/${name}.html`,quotationPrintHtml(q));
}
await writeFile(`${output}/sample-quotation-legacy.pdf`,await createQuotationPdf({companyName:company.name,companyAddress:company.address},{quotation_number:'SAMPLE-LEGACY',quotation_date:'2026-11-26',customer_name:'SAMPLE customer - fictional',valid_until:'2026-12-10',subtotal:'180.00',tax_total:'32.40',total:'212.40',lines:[{part_code:'SAMPLE-ITEM-001',description:item.description,uom:'NOS',quantity:'2',unit_price:'100',discount_percent:'10',tax_percent:'18'}]}));
console.log(`Generated four fictional quotation samples in ${output}; no database writes.`);
