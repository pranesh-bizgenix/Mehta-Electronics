import {formatIndian,lineNet,format} from '../public/money.js';
import {quotationDocumentModel} from './quotation-document.js';
import {renderQuotationPdf} from './quotation-pdf-layout.js';

// Legacy quotes share the new layout while preserving their aggregate tax and
// six-decimal net-rate policy. Never infer a GST split absent from the source.
export function createQuotationPdf(config,quote,options={}){
 const normalized={
  quotation_number:quote.quotation_number,version:quote.revision_number||1,
  status:quote.status==='ACCEPTED'?'WON':quote.status||'DRAFT',documentDate:quote.quotation_date||quote.created_at||'',
  letterhead:{name:config.companyName,address:config.companyAddress,gstin:config.companyGstin,phone:config.companyPhone,email:config.companyEmail},
  customer_name:quote.customer_name,customerAddress:quote.customer_address||'',customerGstin:quote.customer_gstin||'',contact_email:quote.contact_email||'',
  validUntil:quote.valid_until,placeOfSupply:quote.place_of_supply||'',sellerState:'',
  request:{reference:quote.enquiry_number||''},terms:quote.terms||'',notes:quote.notes||'',
  subtotal:quote.subtotal,cgst:'0.00',sgst:'0.00',igst:quote.tax_total,total:quote.total,
  lines:quote.lines.map(line=>({partCode:line.part_code||'Custom',description:line.description,hsn:line.hsn||'',quantity:line.quantity,uom:line.uom,unitPrice:line.unit_price,discountPercent:line.discount_percent||'0',taxPercent:line.tax_percent||'0',net:format(lineNet(line))}))
 };
 const model=quotationDocumentModel(normalized);
 model.taxRows=[['Taxable value',formatIndian(quote.subtotal)],['GST (source total)',formatIndian(quote.tax_total)]];
 model.items.forEach((item,index)=>{item.rate=formatIndian(format(lineNet({...quote.lines[index],quantity:'1'}),6),6);});
 return renderQuotationPdf(model,options);
}
