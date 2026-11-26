import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {sendQuotationEmail} from '../src/mailer.js';
import {quotationSupplierTerms} from '../src/quotation-supplier-terms.js';

test('Quotation email keeps the Mehta quote and original supplier terms as two distinct attachments',async()=>{
 const original=nodemailer.createTransport;let captured;
 nodemailer.createTransport=()=>({sendMail:async value=>{captured=value;return {messageId:'SAMPLE-NO-NETWORK'};}});
 try{
  const pdf=Buffer.from('%PDF-SAMPLE-QUOTE'),supplierTerms=await quotationSupplierTerms();
  await sendQuotationEmail({smtpHost:'smtp.example.test',smtpFrom:'sample@example.test'},{quote:{quotation_number:'SAMPLE-QTN'},to:'customer@example.test',subject:'SAMPLE',message:'SAMPLE review',pdf,supplierTerms});
  assert.equal(captured.attachments.length,2);assert.equal(captured.attachments[0].filename,'SAMPLE-QTN.pdf');assert.deepEqual(captured.attachments[0].content,pdf);
  assert.ok(captured.attachments[1].filename.startsWith('KGEP-supplier'));assert.deepEqual(captured.attachments[1].content,supplierTerms.bytes);
 }finally{nodemailer.createTransport=original;}
});
test('Adding supplier attachment support does not bypass missing SMTP configuration',async()=>{
 await assert.rejects(sendQuotationEmail({},{quote:{quotation_number:'SAMPLE'},supplierTerms:await quotationSupplierTerms()}),{code:'SMTP_NOT_CONFIGURED'});
});
