import PDFDocument from 'pdfkit';
import {drawCompanyLogo} from '../../document-branding.js';
import {formatIndian} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';
import {invoiceLayoutModel} from './invoice-layout-model.js';

// One A4, reference-based invoice format for every CRM preview and download.
// Reports and retained source PDFs use their own existing paths.
const PAGE={width:595.28,height:841.89,left:24,right:571.28,bottom:790};
const WIDTH=PAGE.right-PAGE.left,INK='#172033',BORDER='#9299a3',FILL='#f1f2f4',MUTED='#535b67';
const BODY=7.8,LEADING=9.7,PAD=5;

export function createInvoicePdf(record,{onLayout}={}){
 const model=invoiceLayoutModel(record);
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true,info:{Title:model.title+' - '+model.number,Author:model.company.name,Subject:'Mehta ControlDesk invoice'}}),chunks=[];
  doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  let y=0,page=0;
  const trace=(kind,x,top,width,height)=>onLayout?.({kind,page,x,y:top,width,height});
  function text(value,x,top,width,{size=BODY,bold=false,align='left',color=INK,fit=false,kind='text'}={}){
   const content=String(value??'');doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
   if(fit){const measured=doc.widthOfString(content);if(measured>width)size*=width/measured;}
   doc.fillColor(color).fontSize(size).text(content,x,top,{width,align,lineBreak:false});trace(kind,x,top,width,size*1.15);
  }
  function wrap(value,width,{size=BODY,bold=false}={}){
   doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
   const result=[];
   for(const paragraph of String(value??'').split(/\r?\n/)){
    let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
     const candidate=line?line+' '+word:word;
     if(doc.widthOfString(candidate)<=width){line=candidate;continue;}
     if(line){result.push(line);line='';}
     for(const character of word){if(line&&doc.widthOfString(line+character)>width){result.push(line);line='';}line+=character;}
    }
    result.push(line);
   }
   return result;
  }
  const lines=(values,x,top,width,options={})=>{for(const [i,line]of values.entries())text(line,x,top+i*LEADING,width,options);};
  function box(x,top,width,height,fill=null){if(fill)doc.rect(x,top,width,height).fill(fill);doc.lineWidth(.45).strokeColor(BORDER).rect(x,top,width,height).stroke();trace('box',x,top,width,height);}
  function startPage(continued=false){
   if(page)doc.addPage();page++;
   box(PAGE.left,24,WIDTH,784);
   const company=model.company,name=wrap(company.name,320,{size:continued?11:13,bold:true});
   const details=continued?[`GSTIN: ${company.gstin}`]:[...wrap(company.address,320),...(company.contact?wrap(company.contact,320):[]),`GSTIN: ${company.gstin}`,...(company.cin?[`CIN: ${company.cin}`]:[]),...(company.msme?[`MSME: ${company.msme}`]:[])];
   const height=Math.max(80,name.length*15+details.length*LEADING+16);
   if(height>300)throw validationFailed('Company letterhead is too long for the invoice format. Shorten the configured contact/address presentation.');
   drawCompanyLogo(doc,PAGE.left+8,32,49);trace('logo',PAGE.left+8,32,49,49);
   for(const [i,line]of name.entries())text(line,PAGE.left+68,33+i*15,320,{size:continued?11:13,bold:true});
   lines(details,PAGE.left+68,35+name.length*15,320,{size:7.7});
   text(model.title,PAGE.right-145,24+height-27,135,{size:model.draft?17:20,align:'right',fit:true});
   doc.moveTo(PAGE.left,24+height).lineTo(PAGE.right,24+height).stroke();
   y=24+height;
   if(continued){text(model.number+' | continued',PAGE.left+PAD,y+5,WIDTH-PAD*2,{size:8,bold:true});y+=23;}
  }
  function ensure(height){if(y+height>PAGE.bottom)startPage(true);if(y+height>PAGE.bottom)throw validationFailed('Invoice details exceed the supported page block height.');}
  function metadata(){
   const half=WIDTH/2,labelWidth=115,valueWidth=half-labelWidth-12;
   const count=Math.max(model.metadataLeft.length,model.metadataRight.length);
   const rows=Array.from({length:count},(_,i)=>{const pair=[model.metadataLeft[i],model.metadataRight[i]],wrapped=pair.map(field=>field?wrap(field.value,valueWidth,{bold:true}):[]);return {pair,wrapped,height:Math.max(14,...wrapped.map(v=>v.length*LEADING+5))};});
   let index=0;
   while(index<rows.length){
    ensure(rows[index].height);const start=index;let height=0;
    while(index<rows.length&&y+height+rows[index].height<=PAGE.bottom){height+=rows[index].height;index++;}
    box(PAGE.left,y,half,height);box(PAGE.left+half,y,half,height);
    for(const row of rows.slice(start,index)){
     for(let col=0;col<2;col++){
      const x=PAGE.left+col*half,field=row.pair[col];if(field){text(field.label,x+PAD,y+3,labelWidth-5,{size:7.5});text(':',x+labelWidth,y+3,6);lines(row.wrapped[col],x+labelWidth+7,y+3,valueWidth,{size:7.5,bold:true});}
     }
     y+=row.height;
    }
   }
  }
  function parties(){
   const half=WIDTH/2,values=[model.billTo,model.shipTo],blocks=values.map(party=>({name:wrap(party.name,half-14,{bold:true,size:8.5}),body:[...wrap(party.address,half-14),...wrap('GSTIN: '+party.gstin,half-14)]}));
   const height=Math.max(...blocks.map(b=>b.name.length*LEADING+b.body.length*LEADING+15));ensure(height+17);
   for(let col=0;col<2;col++){
    const x=PAGE.left+col*half;box(x,y,half,15,FILL);text(col?'Ship To':'Bill To',x+PAD,y+3,half-10,{bold:true});box(x,y+15,half,height);
    const b=blocks[col];lines(b.name,x+7,y+21,half-14,{bold:true,size:8.5});lines(b.body,x+7,y+21+b.name.length*LEADING,half-14);
   }
   y+=height+23;
  }
  const widths=[18,172.28,38,52,54,32,62,47,72];
  function itemHeader(){
   ensure(31);let x=PAGE.left;
   for(const [i,label]of ['#','Description of Goods & Services','Qty\n(UoM)','Rate\nINR','Amount\nINR','Disc\n%','Taxable\namount','GST','Total\nINR'].entries()){
    box(x,y,widths[i],29,FILL);lines(label.split('\n'),x+3,y+5,widths[i]-6,{size:7,bold:true,align:i>1?'right':'left'});x+=widths[i];
   }
   y+=29;
  }
  function items(){
   itemHeader();
   for(const line of model.lines){
    const description=[...wrap(line.code,widths[1]-10,{bold:true}),...wrap('HSN/SAC: '+line.hsn,widths[1]-10),...wrap(line.description,widths[1]-10)];
    let remaining=description,first=true;
    while(remaining.length){
     if(y+40>PAGE.bottom){startPage(true);itemHeader();}
     const capacity=Math.max(1,Math.floor((PAGE.bottom-y-10)/LEADING)),part=remaining.slice(0,capacity);remaining=remaining.slice(part.length);
     const height=Math.max(40,part.length*LEADING+10);let x=PAGE.left;
     for(const width of widths){box(x,y,width,height);x+=width;}
     text(first?line.index:'',PAGE.left+3,y+5,12,{size:7});
     let cursor=PAGE.left+widths[0]+5;
     for(const [i,value]of part.entries())text(value,cursor,y+5+i*LEADING,widths[1]-10,{bold:first&&i===0,size:7.7});
     if(first){
      cursor=PAGE.left+widths[0]+widths[1];
      const values=[[line.quantity,line.uom],[formatIndian(line.rate)],[formatIndian(line.gross)],[line.discount],[formatIndian(line.net)],line.taxLabel.split('\n'),[formatIndian(line.total)]];
      for(const [i,value]of values.entries()){
       for(const [j,entry]of value.entries())text(entry,cursor+3,y+5+j*LEADING,widths[i+2]-6,{size:7.3,align:'right',fit:true,bold:i===6});cursor+=widths[i+2];
      }
     }
     y+=height;first=false;
    }
   }
   ensure(22);let x=PAGE.left;
   const values=['','Gross total','','',formatIndian(model.totals.gross),formatIndian(model.totals.discount),formatIndian(model.totals.subtotal),formatIndian(model.totals.tax),formatIndian(model.totals.beforeRound)];
   for(const [i,value]of values.entries()){box(x,y,widths[i],22,FILL);text(value,x+3,y+7,widths[i]-6,{bold:true,size:7.3,align:i>1?'right':'left',fit:true});x+=widths[i];}y+=22;
  }
  function financialSummary(){
   const leftWidth=308,rightWidth=WIDTH-leftWidth,pairs=[['Taxable amount',model.totals.subtotal],...(model.local?[['CGST',model.totals.cgst],[model.localTaxLabel,model.totals.sgst]]:[['IGST',model.totals.igst]]),['Rounding',model.totals.roundOff],['Invoice total',model.totals.total]];
   const sign=wrap('for '+model.company.name,rightWidth-14,{bold:true,size:8}),signatory=wrap(model.company.signatory,rightWidth-14);
   const height=Math.max(198,(pairs.length-1)*19+23+(sign.length+signatory.length)*LEADING+57);ensure(height+10);
   const top=y,x=PAGE.left+leftWidth;
   text('Items in total: '+model.itemsTotal,PAGE.left+7,top+7,leftWidth-14,{size:7.5,fit:true});
   let rightY=top;
   for(const [i,[label,value]]of pairs.entries()){
    const last=i===pairs.length-1,h=last?23:19;box(x,rightY,rightWidth,h,last?FILL:null);text(label,x+6,rightY+6,rightWidth*.55,{bold:last,size:last?9:8});text(formatIndian(value),x+rightWidth*.54,rightY+6,rightWidth*.46-7,{bold:last,size:last?10:8.3,align:'right',fit:true});rightY+=h;
   }
   box(x,rightY,rightWidth,height-(rightY-top));
   lines(sign,x+7,rightY+8,rightWidth-14,{bold:true,size:8,align:'center'});
   lines(signatory,x+7,top+height-42-signatory.length*LEADING,rightWidth-14,{align:'center'});
   text('Prepared by ____ | Verified by ____',x+7,top+height-30,rightWidth-14,{size:7,align:'center'});text('Authorised signatory',x+7,top+height-15,rightWidth-14,{size:7,bold:true,align:'center'});
   const segments=[{label:'Total in words',value:model.amountInWords,bold:true},{label:'Bank details for remittance',value:model.bank.join('\n')},{label:'Terms (as supplied)',value:model.terms}];
   const overflow=[];let leftY=top+24;
   for(const segment of segments){
    const content=wrap(segment.value,leftWidth-16,{bold:segment.bold}),capacity=Math.max(0,Math.floor((top+height-leftY-18)/LEADING));
    if(capacity){text(segment.label,PAGE.left+7,leftY,leftWidth-14,{bold:true});leftY+=13;const shown=content.slice(0,capacity);lines(shown,PAGE.left+7,leftY,leftWidth-16,{bold:segment.bold});leftY+=shown.length*LEADING+8;if(shown.length<content.length)overflow.push({...segment,value:content.slice(shown.length).join('\n')});}
    else overflow.push(segment);
   }
   y=top+height+10;return overflow;
  }
  function hsnSummary(){
   const columns=model.local?[{label:'HSN/SAC',width:90},{label:'Taxable amount',width:100},{label:'CGST %',width:45},{label:'CGST amount',width:75},{label:model.localTaxLabel+' %',width:45},{label:model.localTaxLabel+' amount',width:75},{label:'Total tax',width:117.28}]:[{label:'HSN/SAC',width:150},{label:'Taxable amount',width:135},{label:'IGST %',width:60},{label:'IGST amount',width:100},{label:'Total tax',width:102.28}];
   function heading(){ensure(53);text('HSN/SAC Summary',PAGE.left+7,y+3,WIDTH-14,{bold:true});y+=20;let x=PAGE.left;for(const col of columns){box(x,y,col.width,28,FILL);lines(wrap(col.label,col.width-10,{bold:true,size:7.2}),x+5,y+5,col.width-10,{size:7.2,bold:true,align:x===PAGE.left?'left':'right'});x+=col.width;}y+=28;}
   ensure(48+Math.min(model.hsnRows.length+1,2)*22);heading();
   for(const row of [...model.hsnRows,{hsn:'Total',rate:'',halfRate:'',net:model.totals.subtotal,cgst:model.totals.cgst,sgst:model.totals.sgst,igst:model.totals.igst,tax:model.totals.tax}]){
    if(y+22>PAGE.bottom){startPage(true);heading();}
    const total=row.hsn==='Total',values=model.local?[row.hsn,formatIndian(row.net),row.halfRate,formatIndian(row.cgst),row.halfRate,formatIndian(row.sgst),formatIndian(row.tax)]:[row.hsn,formatIndian(row.net),row.rate,formatIndian(row.igst),formatIndian(row.tax)];
    let x=PAGE.left;for(const [i,value]of values.entries()){box(x,y,columns[i].width,22,total?FILL:null);text(value,x+5,y+7,columns[i].width-10,{size:7.4,bold:total,align:i?'right':'left',fit:true});x+=columns[i].width;}y+=22;
   }
   y+=10;
  }
  function continuation(segment){
   const pending=wrap(segment.value,WIDTH-16,{bold:segment.bold});let offset=0;
   while(offset<pending.length){ensure(36);text(segment.label+' (continued)',PAGE.left+7,y+3,WIDTH-14,{bold:true});y+=19;const take=Math.max(1,Math.floor((PAGE.bottom-y-8)/LEADING));const part=pending.slice(offset,offset+take);lines(part,PAGE.left+7,y,WIDTH-16,{bold:segment.bold});y+=part.length*LEADING+10;offset+=part.length;if(offset<pending.length)startPage(true);}
  }
  try{
   startPage();metadata();parties();items();const overflow=financialSummary();hsnSummary();overflow.forEach(continuation);
   const range=doc.bufferedPageRange();
   for(let i=0;i<range.count;i++){
    doc.switchToPage(i);page=i+1;
    text((model.draft?'DRAFT | ':'')+model.number,PAGE.left+4,820,WIDTH-110,{size:7,color:MUTED,fit:true,kind:'footer'});
    text(`Page ${i+1} of ${range.count}`,PAGE.right-100,820,96,{size:7,color:MUTED,align:'right',kind:'footer'});
   }
   doc.end();
  }catch(error){doc.removeAllListeners('end');doc.end();reject(error);}
 });
}
