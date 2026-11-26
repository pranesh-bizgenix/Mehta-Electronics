import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {drawCompanyLogo} from './document-branding.js';

export const QUOTATION_LAYOUT_VERSION='mehta-three-section-1';
const L=40,W=515.28,R=L+W,BOTTOM=778,STEP=11;
const NAVY='#142847',BLUE='#3154d9',INK='#1e2d43',MUTED='#63718a',LINE='#d9e1ec',SOFT='#f3f6fb';

/** Receives an allowlisted display model, never the private quotation snapshot. */
export function renderQuotationPdf(model,{onLayout}={}){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true,info:{Title:`Quotation ${model.number}`,Author:model.company.name,Subject:'Summary, pricing schedule and commercial terms'}}),chunks=[];
  doc.registerFont('Unicode',fileURLToPath(new URL('./assets/NotoSansDevanagari.ttf',import.meta.url)));
  doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  let y=0,page=0,section=0;
  const trace=(kind,x,top,width,height)=>onLayout?.({kind,page,section,x,y:top,width,height});
  function font(value,size,bold=false){doc.font(/[^\x20-\x7e\r\n]/.test(value)?'Unicode':bold?'Helvetica-Bold':'Helvetica').fontSize(size);}
  function text(value,x,top,width,{size=8.4,bold=false,color=INK,align='left',fit=false,kind='text'}={}){
   value=String(value??'');font(value,size,bold);if(fit&&doc.widthOfString(value)>width)size*=width/doc.widthOfString(value);
   doc.fontSize(size).fillColor(color).text(value,x,top,{width,align,lineBreak:false});trace(kind,x,top,width,size*1.25);
  }
  function wrap(value,width,size=8.4,bold=false){
   value=String(value??'');font(value,size,bold);const result=[];
   for(const paragraph of value.split(/\r?\n/)){
    let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){
     if(doc.widthOfString(line?line+' '+word:word)<=width){line+=(line?' ':'')+word;continue;}
     if(line){result.push(line);line='';}
     for(const ch of word){if(line&&doc.widthOfString(line+ch)>width){result.push(line);line='';}line+=ch;}
    }result.push(line);
   }return result;
  }
  const lines=(values,x,top,width,options={})=>values.forEach((value,i)=>text(value,x,top+i*STEP,width,options));
  function panel(x,top,width,height,fill=SOFT){doc.rect(x,top,width,height).fill(fill);trace('panel',x,top,width,height);}
  function rule(top){doc.moveTo(L,top).lineTo(R,top).lineWidth(.6).strokeColor(LINE).stroke();}
  function start(which,continued=false){
   if(page)doc.addPage();page++;section=which;
   panel(0,0,595.28,5,BLUE);drawCompanyLogo(doc,L,26,45);
   const company=wrap(model.company.name,300,11.5,true);
   const details=wrap([model.company.address,model.company.contact,model.company.gstin&&`GSTIN: ${model.company.gstin}`].filter(Boolean).join('\n'),300,7.8);
   const headerHeight=Math.max(72,company.length*14+details.length*STEP+10);
   if(headerHeight>235)throw new Error('Quotation letterhead is too long for the document header.');
   company.forEach((value,i)=>text(value,L+59,27+i*14,300,{size:11.5,bold:true}));
   lines(details,L+59,29+company.length*14,300,{size:7.8,color:MUTED});
   text('QUOTATION',R-105,29,105,{size:9,bold:true,color:BLUE,align:'right'});
   text(`VERSION ${model.version}`,R-105,46,105,{size:7.5,color:MUTED,align:'right'});
   y=25+headerHeight;rule(y);y+=15;
   if(model.notice){const notice=wrap(model.notice,W-18,7.5,true);panel(L,y,W,notice.length*STEP+12);lines(notice,L+9,y+6,W-18,{size:7.5,bold:true,color:BLUE});y+=notice.length*STEP+23;}
   text(`0${which} / ${['','COVER & SUMMARY','ITEMIZED PRICING & SCOPE','TERMS & SIGN-OFF'][which]}${continued?' - CONTINUED':''}`,L,y,W,{size:8,bold:true,color:BLUE});y+=27;
  }
  function ensure(height){if(y+height>BOTTOM)start(section,true);if(y+height>BOTTOM)throw new Error('Quotation content exceeds the supported page block height.');}
  function heading(title,subtitle){ensure(65);text(title,L,y,W,{size:25,bold:true,color:NAVY});y+=36;if(subtitle){const value=wrap(subtitle,W,9);lines(value,L,y,W,{size:9,color:MUTED});y+=value.length*STEP+14;}}
  function block(label,value){
   const values=wrap(value||'[Not supplied]',W-24);let offset=0;
   while(offset<values.length){ensure(56);const count=Math.min(values.length-offset,Math.floor((BOTTOM-y-35)/STEP)),height=count*STEP+32;
    panel(L,y,W,height);text(label+(offset?' (continued)':''),L+12,y+9,W-24,{size:8,bold:true,color:BLUE});lines(values.slice(offset,offset+count),L+12,y+24,W-24);y+=height+12;offset+=count;
   }
  }
  function cover(){
   start(1);heading('Supply quotation',model.number);
   const meta=[['Quotation date',model.date],['Valid until',model.validUntil],['Place of supply',model.placeOfSupply],['Customer reference',model.reference]];
   for(const [label,value]of meta){const values=wrap(value,W-150,9,true),h=Math.max(22,values.length*STEP+8);ensure(h);text(label,L,y,140,{color:MUTED});lines(values,L+150,y,W-150,{size:9,bold:true});y+=h;}
   y+=10;block('PREPARED FOR',[model.customer.name,model.customer.address,`GSTIN: ${model.customer.gstin}`,`Contact: ${model.customer.contact}`].join('\n'));
   ensure(185);panel(L,y,W,81,NAVY);text('QUOTATION TOTAL  /  INR',L+16,y+13,W-32,{size:8,bold:true,color:'#ffffff'});text(model.total,L+16,y+34,W-32,{size:25,bold:true,color:'#ffffff',fit:true});y+=97;
   text('Included in this quotation',L,y,W,{size:12,bold:true,color:NAVY});y+=23;
   const scope=model.items.slice(0,4).map(item=>item.code+' - '+item.description.split('\n')[0]);
   const scopeLines=scope.flatMap(value=>wrap(value,W-22));
   const available=Math.max(0,Math.floor((BOTTOM-y-60)/STEP));lines(scopeLines.slice(0,available),L+10,y,W-22,{size:8.4});y+=Math.min(scopeLines.length,available)*STEP+12;
   text('Full quantities, specifications and GST are shown in the pricing schedule.',L,y,W,{size:8,color:MUTED});y+=23;
   if(y+28<BOTTOM){rule(y);text('01  Summary     /     02  Pricing & taxes     /     03  Terms & acceptance',L,y+12,W,{size:8,bold:true,color:BLUE});}
  }
  const columns=[['number','#',20],['description','Item / description / HSN',220.28],['quantity','Qty / UoM',57],['rate','Net rate INR',78],['gst','GST',42],['amount','Amount INR',98]];
  function tableHeader(){ensure(29);let x=L;for(const [key,label,width]of columns){panel(x,y,width,27,NAVY);text(label,x+5,y+9,width-10,{size:7.1,bold:true,color:'#ffffff',align:key==='description'?'left':'right',fit:true});x+=width;}y+=27;}
  function pricing(){
   start(2);heading('Pricing schedule','Prices in INR. Unit rates are net of any applicable discount.');
   tableHeader();
   for(const [index,item]of model.items.entries()){
    const description=wrap([item.code,item.description,`HSN / SAC: ${item.hsn}`].join('\n'),columns[1][2]-12,8.1);
    let offset=0;
    while(offset<description.length){
     if(BOTTOM-y<40){start(2,true);tableHeader();}
     const take=Math.min(description.length-offset,Math.floor((BOTTOM-y-14)/STEP)),height=Math.max(36,take*STEP+14);
     if(y+height>BOTTOM){start(2,true);tableHeader();continue;}
     panel(L,y,W,height,index%2?SOFT:'#ffffff');
     const cells={number:offset?'...':String(index+1),quantity:offset?'':item.quantity,rate:offset?'':item.rate,gst:offset?'':item.gst,amount:offset?'':item.amount};
     let x=L;for(const [key,,width]of columns){
      if(key==='description')lines(description.slice(offset,offset+take),x+6,y+7,width-12,{size:8.1});
      else String(cells[key]).split('\n').forEach((value,i)=>text(value,x+5,y+8+i*STEP,width-10,{size:8,align:'right',fit:true}));x+=width;
     }y+=height;rule(y);offset+=take;
    }
   }
   y+=15;const words=wrap(model.words,230),height=Math.max(words.length*STEP+30,model.taxRows.length*20+55);ensure(height);
   text('AMOUNT IN WORDS',L,y+5,230,{size:7.5,bold:true,color:BLUE});lines(words,L,y+23,230,{size:8.6});
   const x=R-242;let top=y;for(const [label,value]of model.taxRows){text(label,x,top+5,132,{color:MUTED});text(value,R-106,top+5,106,{align:'right',fit:true});top+=20;}
   panel(x-9,top+5,251,33,BLUE);text('TOTAL INR',x,top+17,95,{size:8.5,bold:true,color:'#ffffff'});text(model.total,R-139,top+15,130,{size:12,bold:true,color:'#ffffff',align:'right',fit:true});y+=height+13;
   if(model.quantityInstructions)block(model.quantityConfirmed?'QUANTITY INSTRUCTIONS - REVIEWED':'QUANTITY INSTRUCTIONS - REVIEW PENDING',model.quantityInstructions);
  }
  function terms(){
   start(3);heading('Commercial terms','Terms and notes recorded for this quotation.');
   block('PAYMENT, DELIVERY, WARRANTY & EXCLUSIONS',model.terms||'[Commercial terms not supplied. Confirm payment, delivery, warranty and exclusions before issue.]');
   if(model.notes)block('ADDITIONAL NOTES',model.notes);
   if(model.supplierTermsLabel)block('SUPPLIER REFERENCE ATTACHMENT',model.supplierTermsLabel);
   ensure(171);rule(y);y+=18;
   const half=(W-24)/2;
   text('For '+model.company.name,L,y,half,{size:10,bold:true,fit:true});text('Client acceptance / PO reference',L+half+24,y,half,{size:10,bold:true,fit:true});
   doc.moveTo(L,y+58).lineTo(L+half,y+58).lineWidth(.6).strokeColor(LINE).stroke();
   text('Authorised signatory',L,y+65,half,{color:MUTED});
   for(const [i,label]of ['Name:','Signature:','Date:','PO reference:'].entries())text(label+' ___________________________',L+half+24,y+31+i*22,half,{size:8,color:MUTED,fit:true});
   y+=135;text('This is a quotation, not a tax invoice.',L,y,W,{size:8,color:MUTED});
  }
  try{
   cover();pricing();terms();
   const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){
    doc.switchToPage(i);rule(802);text(model.number,L,813,W-140,{size:7.3,color:MUTED,fit:true,kind:'footer'});text(`Page ${i+1} of ${pages.count}`,R-130,813,130,{size:7.3,color:MUTED,align:'right',kind:'footer'});
   }doc.end();
  }catch(error){doc.destroy();reject(error);}
 });
}
