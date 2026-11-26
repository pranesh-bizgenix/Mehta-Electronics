import PDFDocument from 'pdfkit';
import {drawCompanyLogo} from '../../document-branding.js';
export {createInvoicePdf as invoicePdf} from './invoice-pdf.js';

// One bounded, wrapping renderer for billing and reports. No HTML, network assets,
// internal costs, margins, credentials or arbitrary payload fields enter PDFs.
export function renderPdf({title,subtitle,sections,afterSections=[],rows,columns,draft=false}){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:title,Author:'Mehta ControlDesk'}}),chunks=[];
  doc.on('data',b=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const width=doc.page.width-84,bottom=doc.page.height-65;
  const header=()=>{drawCompanyLogo(doc,42,35,48);doc.fillColor('#132742').font('Helvetica-Bold').fontSize(16).text(title,102,40,{width:width-60});doc.font('Helvetica').fontSize(9).text(subtitle,102,65,{width:width-60});doc.y=105;};
  const ensure=h=>{if(doc.y+h>bottom){doc.addPage();header();}};
  header();
  const sectionBlocks=list=>{for(const section of list){const value=String(section.value||'Not supplied');const chunks=value.match(/[\s\S]{1,500}/g)||['Not supplied'];for(const [i,chunk]of chunks.entries()){doc.x=42;doc.font('Helvetica').fontSize(9);const h=doc.heightOfString(chunk,{width})+28;ensure(h);doc.font('Helvetica-Bold').text(section.label+(i?' (continued)':''),42,doc.y,{width});doc.font('Helvetica').text(chunk,42,doc.y,{width});doc.moveDown(.6);}}};
  sectionBlocks(sections);
  const sizes=columns.map(c=>c.fraction*width);
  const row=(values,heading=false)=>{doc.font(heading?'Helvetica-Bold':'Helvetica').fontSize(8);const h=Math.max(20,...values.map((v,i)=>doc.heightOfString(String(v??''),{width:sizes[i]-8})+12));if(doc.y+h>bottom){doc.addPage();header();if(!heading)row(columns.map(c=>c.label),true);}doc.font(heading?'Helvetica-Bold':'Helvetica').fontSize(8);const y=doc.y;let x=42;values.forEach((v,i)=>{doc.fillColor('#132742').text(String(v??''),x+4,y+5,{width:sizes[i]-8});x+=sizes[i];});doc.moveTo(42,y+h).lineTo(42+width,y+h).strokeColor('#dbe2eb').stroke();doc.y=y+h;};
  row(columns.map(c=>c.label),true);for(const values of rows)row(values);
  doc.moveDown();sectionBlocks(afterSections);
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);const footerMargin=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.fillColor('#566476').font('Helvetica').fontSize(8).text(`${draft?'DRAFT | ':''}Mehta ControlDesk | Page ${i+1} of ${range.count}`,42,doc.page.height-42,{width,align:'center',lineBreak:false});doc.page.margins.bottom=footerMargin;}
  doc.end();
 });
}
