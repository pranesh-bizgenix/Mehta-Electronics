import {mkdir,writeFile} from 'node:fs/promises';
import {salesOrderPdf} from '../src/sales-order-document.js';
import {calculateQuotation} from '../public/quotation-math.js';
const output='verification-output/sales-order-format';await mkdir(output,{recursive:true});
const line={partCode:'SAMPLE-ITEM-001',description:'Fictional electrical component for layout review only',hsn:'00000000',quantity:'2',uom:'NOS',unitPrice:'100',discountPercent:'10',taxPercent:'18'};
for(const [name,state,count]of [['sample-sales-order-cgst-sgst','33',2],['sample-sales-order-igst','27',2],['sample-sales-order-multipage','33',40]]){
 const order={order_number:'SAMPLE-SO/2026-27/000001',status:'HELD',effectiveStatus:'HELD',customer_name:'SAMPLE customer - fictional',poNumber:'SAMPLE-CUSTOMER-PO',promisedDate:'2026-12-01',placeOfSupply:state,notes:'Fictional data for layout review only.',...calculateQuotation(Array.from({length:count},(_,i)=>({...line,partCode:`SAMPLE-ITEM-${String(i+1).padStart(3,'0')}`})),'33',state)};
 const context={company:{name:'Mehta Electric Corporation - SAMPLE ONLY',address:'[Registered address not supplied]',gstin:'[GSTIN not supplied]'},customer:{billing_address:'[Billing address not supplied]',shipping_address:'[Delivery address not supplied]'},createdAt:'2026-11-26T04:00:00Z',quote:{quotation_number:'SAMPLE-QUOTATION',terms:'[Approved sales terms not supplied]'}};
 await writeFile(`${output}/${name}.pdf`,await salesOrderPdf(order,context,{sample:true}));
}
console.log(`Generated three fictional sales-order previews in ${output}; no database changes.`);
