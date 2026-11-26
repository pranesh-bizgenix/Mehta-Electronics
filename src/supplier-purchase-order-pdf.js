import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {drawCompanyLogo} from './document-branding.js';
import {amountInWords} from './purchase-document-math.js';
import {scaled} from '../public/quotation-math.js';
import {formatIndian} from '../public/money.js';

// Presentation only: numbering, approval, tax and download policies remain in
// purchase-documents.js. No legal text or values are taken from the reference.
export const PURCHASE_ORDER_LAYOUT_VERSION='mehta-po-reference-1';
const LEFT=24,WIDTH=547.28,RIGHT=LEFT+WIDTH,BOTTOM=788,PAD=5,LEADING=10;
const INK='#172033',MUTED='#59616c',RULE='#969ca5',FILL='#f1f2f4';
const supplied=value=>value==null||value===''?'[Not supplied]':String(value);
const invalid=message=>Object.assign(new Error(message),{status:422});

export function supplierPurchaseOrderPdf(record,{draft=false,sample=false,onLayout}={}){
 return referenceOrderPdf(record,{draft,sample,onLayout});
}

// Shared boxed order layout. Commercial models and access gates are supplied by
// each workflow; this renderer neither issues nor approves an order.
export function referenceOrderPdf(record,{draft=false,sample=false,onLayout,presentation={}}={}){
 const p=record.payload,c=p.company||{},supplier=p.supplier||{},totals=p.totals;
 if(!Array.isArray(p.lines)||!p.lines.length||!totals)throw invalid('PO lines and saved totals are required.');
 // Reconcile stored rounded components, never recalculate commercial amounts.
 for(const key of ['net','cgst','sgst','igst']){
  const totalKey=key==='net'?'subtotal':key;
  if(p.lines.reduce((sum,line)=>sum+scaled(line[key]),0n)!==scaled(totals[totalKey]))throw invalid('PO line amounts do not match saved totals.');
 }
 const signed=value=>String(value).startsWith('-')?-scaled(String(value).slice(1)):scaled(value);
 if(['subtotal','cgst','sgst','igst','roundOff'].reduce((sum,key)=>sum+signed(totals[key]),0n)!==scaled(totals.total))throw invalid('PO total does not reconcile.');
 const quantities=new Map();
 for(const line of p.lines)quantities.set(line.uom,(quantities.get(line.uom)||0n)+scaled(line.quantity));
 const quantity=value=>{const digits=value.toString().padStart(7,'0');return (digits.slice(0,-6)+'.'+digits.slice(-6)).replace(/\.?0+$/,'');};
 const isDraft=draft||record.status==='DRAFT'||record.status==='PENDING_APPROVAL';
 const marker=sample?'SAMPLE - NOT FOR ISSUE':isDraft?'DRAFT - NOT FOR ISSUE':'';
 return new Promise((resolve,reject)=>{
  const title=presentation.title||'Purchase Order';
  const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true,info:{Title:`${title} - ${record.number}`,Author:supplied(c.name)}}),chunks=[];
  doc.registerFont('Unicode',fileURLToPath(new URL('./assets/NotoSansDevanagari.ttf',import.meta.url)));
  doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  let y=0,page=0;
  const trace=(kind,x,top,width,height)=>onLayout?.({kind,page,x,y:top,width,height});
  function font(value,size,bold=false){doc.font(/[^\x20-\x7e\r\n]/.test(value)?'Unicode':bold?'Helvetica-Bold':'Helvetica').fontSize(size);}
  function text(value,x,top,width,{size=7.8,bold=false,align='left',fit=false,color=INK}={}){
   value=String(value??'');font(value,size,bold);
   if(fit&&doc.widthOfString(value)>width)size*=width/doc.widthOfString(value);
   doc.fontSize(size).fillColor(color).text(value,x,top,{width,align,lineBreak:false});trace('text',x,top,width,size*1.2);
  }
  function wrap(value,width,size=7.8,bold=false){
   value=String(value??'');font(value,size,bold);const result=[];
   for(const paragraph of value.split(/\r?\n/)){
    let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){
     if(doc.widthOfString(line?line+' '+word:word)<=width){line+=(line?' ':'')+word;continue;}
     if(line){result.push(line);line='';}
     for(const char of word){if(line&&doc.widthOfString(line+char)>width){result.push(line);line='';}line+=char;}
    }result.push(line);
   }return result;
  }
  const lines=(values,x,top,width,options={})=>values.forEach((line,i)=>text(line,x,top+i*LEADING,width,options));
  function box(x,top,width,height,fill){if(fill)doc.rect(x,top,width,height).fill(fill);doc.lineWidth(.45).strokeColor(RULE).rect(x,top,width,height).stroke();trace('box',x,top,width,height);}
  function startPage(continued=false){
   if(page)doc.addPage();page++;box(LEFT,24,WIDTH,784);
   const name=wrap(supplied(c.name),315,12,true);
   const details=continued?[`GSTIN: ${supplied(c.gstin)}`]:[...wrap(supplied(c.address),315),...wrap(supplied(c.contact),315),`GSTIN: ${supplied(c.gstin)}`];
   const height=Math.max(82,name.length*15+details.length*LEADING+17);
   if(height>260)throw invalid('Company letterhead exceeds the supported PO header height.');
   if(c.logoBase64)doc.image(Buffer.from(c.logoBase64,'base64'),LEFT+8,34,{fit:[49,49]});else drawCompanyLogo(doc,LEFT+8,34,49);
   name.forEach((line,i)=>text(line,LEFT+68,34+i*15,315,{size:12,bold:true}));
   lines(details,LEFT+68,36+name.length*15,315,{size:7.6});
   text(title,RIGHT-154,24+height-27,146,{size:19,align:'right',fit:true});
   box(LEFT,24,WIDTH,height);y=24+height;
   if(continued){text(record.number+' | continued',LEFT+PAD,y+5,WIDTH-10,{bold:true});y+=22;}
   if(marker){box(LEFT,y,WIDTH,17,FILL);text(marker,LEFT+PAD,y+4,WIDTH-10,{size:7.4,bold:true});y+=17;}
  }
  function ensure(height){if(y+height>BOTTOM)startPage(true);if(y+height>BOTTOM)throw invalid('PO content block exceeds page height.');}
  function metadata(){
   const half=WIDTH/2,labelWidth=105;
   const columns=presentation.metadata||[[
    ['Purchase Order-ID',record.number],['Purchase Order Date',p.date],['Payment Terms',p.paymentTerms],['Delivery Date',p.deliveryDate]
   ],[
    ['Place Of Supply',c.stateCode?`State code ${c.stateCode}`:''],['Document Status',String(record.status).replaceAll('_',' ')],['Freight / Packing',p.freightPacking]
   ]];
   for(let i=0;i<Math.max(...columns.map(column=>column.length));i++){
    const values=columns.map(column=>column[i]),wrapped=values.map(value=>value?wrap(supplied(value[1]),half-labelWidth-15):[]);
    const h=Math.max(16,...wrapped.map(value=>value.length*LEADING+6));ensure(h);
    for(let col=0;col<2;col++){
     const x=LEFT+col*half;box(x,y,half,h);
     if(values[col]){text(values[col][0],x+PAD,y+4,labelWidth-4,{size:7.2});text(':',x+labelWidth,y+4,5);lines(wrapped[col],x+labelWidth+7,y+4,half-labelWidth-15,{bold:true,size:7.6});}
    }y+=h;
   }
  }
  function parties(){
   const half=WIDTH/2,blocks=presentation.parties?presentation.parties.map(party=>wrap(party.value,half-12)):[[
    ...wrap(supplied(supplier.name),half-12,8.4,true),...wrap(supplied(supplier.address),half-12),...wrap('GSTIN: '+supplied(supplier.gstin),half-12)
   ],wrap(supplied(p.shipTo),half-12)];
   let offset=0;const count=Math.max(...blocks.map(block=>block.length));
   while(offset<count){
    ensure(48);const take=Math.min(count-offset,Math.floor((BOTTOM-y-27)/LEADING)),h=take*LEADING+12;
    for(let col=0;col<2;col++){
     const x=LEFT+col*half;box(x,y,half,16,FILL);text((presentation.parties?.[col].label||(col?'Deliver To':'Vendor Address'))+(offset?' (continued)':''),x+PAD,y+4,half-10,{bold:true});
     box(x,y+16,half,h);lines(blocks[col].slice(offset,offset+take),x+6,y+22,half-12);
    }y+=h+16;offset+=take;if(offset<count)startPage(true);
   }
  }
  const cols=presentation.deliveryColumn?
   [['n','#',20],['description','Description of Goods & Services',222.28],['delivery','Delivery',52],['quantity','Qty / UoM',48],['rate','Net Rate INR',72],['gst','GST %',46],['net','Amount INR',87]]:c.showListPriceDiscount?
   [['n','#',20],['description','Description of Goods & Services',254.28],['quantity','Qty / UoM',45],['rate','Rate INR',65],['discount','Disc %',37],['gst','GST %',46],['net','Amount INR',80]]:
   [['n','#',20],['description','Description of Goods & Services',281.28],['quantity','Qty / UoM',48],['rate','Net Rate INR',72],['gst','GST %',46],['net','Amount INR',80]];
  function tableHeader(){ensure(27);let x=LEFT;for(const [key,label,width]of cols){box(x,y,width,25,FILL);text(label,x+4,y+8,width-8,{size:7,bold:true,align:key==='description'?'left':'right',fit:true});x+=width;}y+=25;}
  function items(){
   tableHeader();
   p.lines.forEach((line,index)=>{
    const detail=[supplied(line.partCode),`HSN/SAC Code: ${supplied(line.hsn)}`,supplied(line.description),...(line.make?[`Make: ${line.make}`]:[])].join('\n');
    const body=wrap(detail,cols[1][2]-10);let offset=0;
    while(offset<body.length){
     if(BOTTOM-y<28){startPage(true);tableHeader();}
     const take=Math.min(body.length-offset,Math.floor((BOTTOM-y-12)/LEADING)),h=Math.max(32,take*LEADING+12);
     if(y+h>BOTTOM){startPage(true);tableHeader();continue;}
     const cells={n:offset?'...':String(index+1),delivery:offset?'':supplied(line.delivery),quantity:offset?'':`${line.quantity}\n${line.uom}`,rate:offset?'':formatIndian(c.showListPriceDiscount?line.unitPrice:line.netRate),discount:offset?'':line.discountPercent,gst:offset?'':line.taxPercent,net:offset?'':formatIndian(line.net)};
     let x=LEFT;for(const [key,,width]of cols){
      box(x,y,width,h);
      if(key==='description')lines(body.slice(offset,offset+take),x+5,y+6,width-10);
      else String(cells[key]??'').split('\n').forEach((value,i)=>text(value,x+4,y+6+i*LEADING,width-8,{align:'right',fit:true}));
      x+=width;
     }y+=h;offset+=take;
    }
   });
  }
  function summary(){
   const half=WIDTH/2,notes=[
    ...Array.from(quantities,([uom,value])=>wrap(`Items in Total: ${quantity(value)} ${uom}`,half-14)).flat(),
    '',...wrap('Amount in words: '+amountInWords(totals.total),half-14),
    '',...wrap('Bill To: '+supplied(p.billTo),half-14),
    ...(presentation.bank?['',...wrap('Bank details for remittance: '+presentation.bank,half-14)]:[]),
    ...(c.taxWithholdingLine?['',...wrap('Tax withholding note: '+c.taxWithholdingLine,half-14)]:[])
   ];
   const amounts=[['Gross-Total (taxable)',totals.subtotal],...['cgst','sgst','igst'].filter(key=>scaled(totals[key])!==0n).map(key=>[key==='sgst'?(totals.localTaxLabel||'SGST'):key.toUpperCase(),totals[key]]),['Round-off',totals.roundOff],['Total INR',totals.total]];
   const signature=wrap(supplied(p.signatory),half-18);
   const h=Math.max(notes.length*LEADING+14,amounts.length*17+72+signature.length*LEADING);
   // Very long addresses/notes continue in their own section instead of clipping.
   const visible=notes.slice(0,20),height=Math.min(h,Math.max(visible.length*LEADING+14,amounts.length*17+72+signature.length*LEADING));
   ensure(height);box(LEFT,y,half,height);box(LEFT+half,y,half,height);
   lines(visible,LEFT+7,y+8,half-14);
   let rowY=y;for(const [label,value]of amounts){const bold=label==='Total INR';if(bold)box(LEFT+half,rowY,half,18,FILL);text(label,LEFT+half+7,rowY+5,half-102,{bold});text(formatIndian(value),RIGHT-94,rowY+5,86,{bold,align:'right',fit:true});rowY+=17;}
   text('For '+supplied(c.name),LEFT+half+7,rowY+10,half-14,{size:8,align:'right',fit:true});
   lines(signature,LEFT+half+9,y+height-30-signature.length*LEADING,half-18,{align:'right'});
   text('Authorised Signatory',LEFT+half+7,y+height-19,half-14,{size:7.4,align:'right'});y+=height;
   if(notes.length>20)section('Order details (continued)',notes.slice(20));
  }
  function section(title,content){
   let offset=0;while(offset<content.length){ensure(47);const take=Math.min(content.length-offset,Math.floor((BOTTOM-y-26)/LEADING)),h=take*LEADING+12;
    box(LEFT,y,WIDTH,16,FILL);text(title+(offset?' (continued)':''),LEFT+PAD,y+4,WIDTH-10,{bold:true});box(LEFT,y+16,WIDTH,h);lines(content.slice(offset,offset+take),LEFT+7,y+22,WIDTH-14);y+=16+h;offset+=take;
   }
  }
  try{
   startPage();metadata();parties();items();summary();
   section(presentation.termsLabel||'Notes / Purchasing terms',wrap(supplied(p.terms),WIDTH-14));
   const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){
    doc.switchToPage(i);text(`${record.number} | Page ${i+1} of ${range.count}`,LEFT,816,WIDTH,{size:7,align:'center',fit:true});
    if(c.footer)text(c.footer,LEFT+5,797,WIDTH-10,{size:6.5,align:'center',fit:true,color:MUTED});
   }doc.end();
  }catch(error){doc.destroy();reject(error);}
 });
}
