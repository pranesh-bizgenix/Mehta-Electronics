import PDFDocument from 'pdfkit';

const clean=(value)=>String(value??'').replace(/[–—−]/g,'-').replace(/₹/g,'INR ').replace(/[^\x0A\x20-\x7E]/g,'');
const money=(value)=>`INR ${Number(value||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export function createQuotationPdf(config,quote){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`Quotation ${quote.quotation_number}`,Author:config.companyName,Subject:`Quotation for ${quote.customer_name}`}});
    const chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const left=42;const right=553;const widths=[78,191,48,72,50,72];
    const header=()=>{doc.rect(0,0,595,82).fill('#174c36');doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(clean(config.companyName),left,24);doc.font('Helvetica').fontSize(9).text(clean(config.companyAddress),left,52,{width:340});doc.font('Helvetica-Bold').fontSize(10).text('QUOTATION',430,25,{width:123,align:'right'});doc.font('Helvetica').fontSize(9).text(`${clean(quote.quotation_number)}  |  Rev ${quote.revision_number||1}`,395,46,{width:158,align:'right'});doc.fillColor('#17211c')};
    const tableHeader=(y)=>{doc.rect(left,y,right-left,24).fill('#e6efe9');doc.fillColor('#174c36').font('Helvetica-Bold').fontSize(8);['Item','Description','Qty','Unit price','Disc.','Amount'].forEach((label,index)=>doc.text(label,left+widths.slice(0,index).reduce((a,b)=>a+b,0)+5,y+8,{width:widths[index]-10,align:index>1?'right':'left'}));doc.fillColor('#17211c');return y+24};
    const newPage=()=>{doc.addPage();header();return tableHeader(105)};
    header();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#68736d').text('BILL TO',left,104);doc.fillColor('#17211c').fontSize(12).text(clean(quote.customer_name),left,120,{width:260});doc.font('Helvetica').fontSize(9).text(clean(quote.contact_email||''),left,139,{width:260});
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#68736d').text('VALID UNTIL',350,104);doc.fillColor('#17211c').font('Helvetica').fontSize(10).text(clean(quote.valid_until),350,120);doc.font('Helvetica-Bold').fontSize(9).fillColor('#68736d').text('ENQUIRY',450,104);doc.fillColor('#17211c').font('Helvetica').fontSize(10).text(clean(quote.enquiry_number||'-'),450,120);
    if(config.companyGstin)doc.fontSize(8).fillColor('#68736d').text(`GSTIN: ${clean(config.companyGstin)}`,350,145,{width:203,align:'right'});
    let y=tableHeader(178);
    quote.lines.forEach(line=>{const description=clean(line.description);const height=Math.max(30,doc.heightOfString(description,{width:widths[1]-10})+12);if(y+height>700)y=newPage();const values=[clean(line.part_code||'Custom'),description,`${line.quantity} ${clean(line.uom)}`,money(line.unit_price),`${line.discount_percent}%`,money(line.quantity*line.unit_price*(1-line.discount_percent/100))];doc.font('Helvetica').fontSize(8).fillColor('#17211c');let x=left;values.forEach((value,index)=>{doc.text(value,x+5,y+7,{width:widths[index]-10,align:index>1?'right':'left'});x+=widths[index]});doc.moveTo(left,y+height).lineTo(right,y+height).strokeColor('#dce3de').lineWidth(.6).stroke();y+=height});
    if(y>610){doc.addPage();header();y=110}
    const totalsX=350;doc.font('Helvetica').fontSize(9).fillColor('#68736d').text('Subtotal',totalsX,y+18,{width:90});doc.fillColor('#17211c').text(money(quote.subtotal),440,y+18,{width:113,align:'right'});doc.fillColor('#68736d').text('Tax',totalsX,y+36,{width:90});doc.fillColor('#17211c').text(money(quote.tax_total),440,y+36,{width:113,align:'right'});doc.rect(totalsX,y+56,203,34).fill('#174c36');doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('Total',totalsX+10,y+68,{width:65});doc.text(money(quote.total),421,y+68,{width:122,align:'right'});
    y+=112;doc.fillColor('#17211c').font('Helvetica-Bold').fontSize(9).text('Terms and notes',left,y);doc.font('Helvetica').fontSize(8.5).fillColor('#4f5d55').text(clean([quote.terms,quote.notes].filter(Boolean).join('\n\n')||'Standard terms apply.'),left,y+16,{width:511,lineGap:3});
    const footer=[config.companyName,config.companyEmail,config.companyPhone].filter(Boolean).map(clean).join('  |  ');const range=doc.bufferedPageRange();for(let index=0;index<range.count;index++){doc.switchToPage(index);doc.font('Helvetica').fontSize(7.5).fillColor('#68736d').text(footer,42,784,{width:420,lineBreak:false});doc.text(`Page ${index+1} of ${range.count}`,470,784,{width:83,align:'right',lineBreak:false})}
    doc.end();
  })
}
