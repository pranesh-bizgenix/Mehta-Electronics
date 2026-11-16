import PDFDocument from 'pdfkit';
/** Synthetic-only PDF, returned in memory; no client material or database writes. */
export function pricePdfFixture(lines=['Part                Unit      Price               Minimum   Discount','ZZTEST_PDF          NOS       123.456789          1         0']){
 return new Promise((resolve,reject)=>{
  const chunks=[],doc=new PDFDocument({size:'A4',margin:24,compress:true});
  doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.font('Courier').fontSize(8);for(const line of lines)doc.text(line,{lineBreak:true});doc.end();
 });
}
