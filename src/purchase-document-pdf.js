import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {amountInWords} from './purchase-document-math.js';
const placeholder=value=>value||'[Needs confirmation]';
export function purchaseDocumentPdf(record,{draft=false,sample=false}={}){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margins:{top:112,bottom:55,left:42,right:42},bufferPages:true,info:{Title:`${record.kind} ${record.number}`}}),chunks=[];
  doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.font(fileURLToPath(new URL('./assets/NotoSansDevanagari.ttf',import.meta.url)));
  const p=record.payload,c=p.company||{},width=511,left=42,bottom=765;
  function header(){
   doc.fillColor('#203c6a').fontSize(15).text(placeholder(c.name),left,28,{width:415});const addressY=doc.y+5;
   if(c.logoBase64)doc.image(Buffer.from(c.logoBase64,'base64'),482,25,{fit:[65,40]});else doc.fillColor('#526078').fontSize(7).text('[Logo pending]',477,30,{width:76});
   doc.fillColor('#526078').fontSize(8).text(`${placeholder(c.address)}\nGSTIN: ${placeholder(c.gstin)} | ${placeholder(c.contact)}`,left,addressY,{width:430});
   const ruleY=Math.max(101,doc.y+8);doc.moveTo(left,ruleY).lineTo(left+width,ruleY).strokeColor('#bdc8d8').stroke();doc.y=ruleY+11;doc.x=left;
  }
  doc.on('pageAdded',header);header();
  const space=h=>{if(doc.y+h>bottom)doc.addPage();};
  const block=(label,value)=>{
   const content=placeholder(value);doc.fontSize(8.5);const h=doc.heightOfString(content,{width:width-135});space(Math.min(h+9,400));
   const y=doc.y;doc.fillColor('#526078').fontSize(8).text(label,left,y,{width:125});doc.fillColor('#17243a').fontSize(8.5).text(content,left+135,y,{width:width-135});doc.y=Math.max(doc.y,y+12)+6;doc.x=left;
  };
  doc.fillColor('#203c6a').fontSize(17).text(record.kind==='RFQ'?'VENDOR REQUEST FOR QUOTATION':'SUPPLIER PURCHASE ORDER');doc.moveDown(.4);
  block(`${record.kind} NO. / DATE`,`${record.number} | ${p.date}`);block('STATUS',`${sample?'SAMPLE - NOT FOR ISSUE | ':draft?'DRAFT - NOT FOR ISSUE | ':''}${record.status.replaceAll('_',' ')}`);
  block('SUPPLIER (RECIPIENT)',[p.supplier.name,p.supplier.address,p.supplier.gstin&&`GSTIN: ${p.supplier.gstin}`].filter(Boolean).join('\n'));
  if(record.kind==='RFQ'){block('RESPONSE DEADLINE',p.responseDeadline);block('REQUESTED LEAD TIME',p.requestedLeadTime);}
  else{block('BILL TO',p.billTo);block('SHIP TO',p.shipTo);block('DELIVERY DATE',p.deliveryDate);}
  const cols=record.kind==='RFQ'?[['n','#',22],['partCode','Code',88],['description','Description',176],['make','Make',95],['quantity','Qty',65],['uom','UoM',65]]:
   c.showListPriceDiscount?[['n','#',20],['item','Item / make',126],['hsn','HSN',40],['quantity','Qty / UoM',45],['unitPrice','List INR',55],['discountPercent','Disc %',35],['netRate','Net INR',65],['net','Amount',70],['taxPercent','GST %',55]]:
   [['n','#',20],['item','Item / make',181],['hsn','HSN',45],['quantity','Qty / UoM',55],['netRate','Net INR',75],['net','Amount',75],['taxPercent','GST %',60]];
  const tableHeader=()=>{space(28);const y=doc.y;doc.rect(left,y,width,24).fill('#203c6a');let x=left;for(const [,label,w]of cols){doc.fillColor('#ffffff').fontSize(7).text(label,x+4,y+6,{width:w-8});x+=w;}doc.y=y+24;};tableHeader();
  for(const [i,l]of p.lines.entries()){
   const cells={...l,n:String(i+1),item:[l.partCode,l.description,l.make&&`Make: ${l.make}`].filter(Boolean).join('\n'),quantity:record.kind==='PO'?`${l.quantity} ${l.uom}`:l.quantity};
   const pending=Object.fromEntries(cols.map(([k])=>[k,placeholder(cells[k])]));let continuation=false;
   do{
    const part={};for(const [k,,w]of cols){const chars=Array.from(pending[k]||'');let low=0,high=chars.length,best=0;doc.fontSize(k==='hsn'?6.5:7.5);
     while(low<=high){const middle=Math.floor((low+high)/2);if(doc.heightOfString(chars.slice(0,middle).join(''),{width:w-8})<=430){best=middle;low=middle+1;}else high=middle-1;}
     part[k]=chars.slice(0,best).join('');pending[k]=chars.slice(best).join('');
    }
    if(continuation)part.n='...';
    const height=Math.max(28,...cols.map(([k,,w])=>doc.fontSize(k==='hsn'?6.5:7.5).heightOfString(part[k]||' ',{width:w-8})+12));
    if(doc.y+height>bottom){doc.addPage();tableHeader();}const y=doc.y;let x=left;
    for(const [k,,w]of cols){doc.fillColor('#17243a').fontSize(k==='hsn'?6.5:7.5).text(part[k]||' ',x+4,y+6,{width:w-8});x+=w;}
    doc.moveTo(left,y+height).lineTo(left+width,y+height).strokeColor('#d9e0e9').stroke();doc.y=y+height;continuation=true;
   }while(Object.values(pending).some(Boolean));
  }
  doc.y+=14;
  if(record.kind==='PO'){
   space(145);for(const [key,label]of [['subtotal','Taxable value'],['cgst','CGST'],['sgst','SGST'],['igst','IGST'],['roundOff','Round-off'],['total','TOTAL INR']])block(label,p.totals[key]);
   block('AMOUNT IN WORDS',amountInWords(p.totals.total));block('PAYMENT TERMS',p.paymentTerms);block('FREIGHT / PACKING',p.freightPacking);if(c.taxWithholdingLine)block('TAX WITHHOLDING',c.taxWithholdingLine);
  }else for(const [key,label]of [['priceBasis','Requested price basis'],['delivery','Requested delivery'],['payment','Requested payment'],['validity','Requested offer validity']])block(label,p.requestedTerms[key]);
  block('TERMS',p.terms);if(record.kind==='PO')block('SIGNATORY',p.signatory);
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){
   doc.switchToPage(i);const margin=doc.page.margins.bottom;doc.page.margins.bottom=0;
   doc.fillColor('#526078').fontSize(7).text(`${placeholder(c.footer)} | ${record.number} | Page ${i+1} of ${range.count}`,left,800,{width,align:'center',lineBreak:false});
   doc.page.margins.bottom=margin;
  }doc.end();
 });
}
