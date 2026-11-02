import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {tallySalesDocumentKind,mapTallySalesDocument,sumDeliveredAmounts} from '../src/tally-sales-documents.js';
import {parseCollection,importTallySession} from '../src/tally-import.js';
import {temporaryDatabase} from '../test-support/postgres.js';
import {createDatabase} from '../src/postgres.js';
import {TallyVisibilityService} from '../src/tally-visibility-service.js';
const voucher=(extra='')=>`<VOUCHER VCHTYPE="Sales Quotation"><GUID>quote-guid</GUID><MASTERID>42</MASTERID><ALTERID>1</ALTERID><DATE>20260402</DATE><VOUCHERTYPENAME>Sales Quotation</VOUCHERTYPENAME><VOUCHERNUMBER>Q/1</VOUCHERNUMBER><PARTYLEDGERNAME>Fixture Customer</PARTYLEDGERNAME><PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN><ISOPTIONAL>Yes</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>SWITCH</STOCKITEMNAME><STOCKITEMGUID>item-guid</STOCKITEMGUID><BASICUSERDESCRIPTION.LIST><BASICUSERDESCRIPTION>Two pole switch</BASICUSERDESCRIPTION></BASICUSERDESCRIPTION.LIST><ACTUALQTY>2 NOS</ACTUALQTY><BILLEDQTY>2 NOS</BILLEDQTY><RATE>100.00/NOS</RATE><DISCOUNT>10</DISCOUNT><AMOUNT>180.00</AMOUNT><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST></ALLINVENTORYENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Fixture Customer</LEDGERNAME><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-212.40</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><AMOUNT>16.20</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><AMOUNT>16.20</AMOUNT></ALLLEDGERENTRIES.LIST>${extra}</VOUCHER>`;
const envelope=body=>`<ENVELOPE><BODY><DATA><COLLECTION>${body}</COLLECTION></DATA></BODY></ENVELOPE>`;
test('source identification uses voucher type and optional flag, never sales narration',()=>{
 for(const name of ['Sales Quotation','Quotation1','Quotation'])assert.equal(tallySalesDocumentKind({VOUCHERTYPENAME:name}),'quotations');
 assert.equal(tallySalesDocumentKind({VOUCHERTYPENAME:'Enquiry',ISOPTIONAL:'Yes'}),'enquiries');
 assert.equal(tallySalesDocumentKind({VOUCHERTYPENAME:'Sales Order',ISOPTIONAL:'Yes'}),'quotations');
 assert.equal(tallySalesDocumentKind({VOUCHERTYPENAME:'Sales Order',ISOPTIONAL:'No'}),null);
 assert.equal(tallySalesDocumentKind({VOUCHERTYPENAME:'Sales',NARRATION:'quotation enquiry'}),null);
});
test('maps original items, ledgers, tax/discount and exact signed amounts without inventing totals',()=>{
 const raw=parseCollection(envelope(voucher()),'VOUCHER')[0],doc=mapTallySalesDocument(raw);
 assert.equal(doc.master_id,'42');assert.equal(doc.lines[0].stockItemId,'item-guid');assert.equal(doc.lines[0].description,'Two pole switch');assert.equal(doc.lines[0].discountPercent,'10');assert.equal(doc.lines[0].discountAmount,null);assert.equal(doc.lines[0].taxDetails[0].rate,'9');assert.equal(doc.totals.lineAmountTotal,'180.00');assert.equal(doc.totals.grandTotal,'-212.40');assert.equal(doc.totals.totalTax,null);assert.equal(doc.ledgers[1].amount,'16.20');
 assert.equal(sumDeliveredAmounts(['9007199254740993.12','0.01']),'9007199254740993.13');assert.equal(sumDeliveredAmounts(['180.00','16.20','16.20']),'212.40');assert.equal(sumDeliveredAmounts([null,'1']),null);
 assert.throws(()=>parseCollection('<ENVELOPE><broken>','VOUCHER'));assert.throws(()=>parseCollection('<ENVELOPE><LINEERROR>Denied</LINEERROR></ENVELOPE>','VOUCHER'));
});
test('full import persists, retries, updates, cancellations, source filters, company isolation and empty enquiries',async()=>{
 const temporary=await temporaryDatabase('tallysales'),db=createDatabase({databaseUrl:temporary.databaseUrl});
 try{
  const connector=crypto.randomUUID();await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${connector},'test sales','test sales','unused')`;
  const load=async(content,company='test sales')=>{const session=crypto.randomUUID();await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(${session},${connector},${company},'2023-04-01','2026-11-02','receiving')`;await db.sql`INSERT INTO tally_upload_chunks(session_id,field_name,sequence,content) VALUES(${session},'salesDocumentsXml',0,${content})`;const result=await importTallySession(db,session,{requiredDatasets:['salesDocumentsXml']});return {session,result};};
  const first=await load(envelope(voucher()));assert.equal(first.result.status,'stored');assert.equal(first.result.salesDocuments.quotations,1);
  const company=first.result.companyId,service=new TallyVisibilityService(db),owner={id:1,role:'OWNER'},manager={id:1,role:'MANAGER'},url=new URL(`http://test/?companyId=${company}`);
  const opt=new URL(url);opt.searchParams.set('optional','Yes');assert.equal((await service.list('quotations',opt,owner)).pagination.total,1);opt.searchParams.set('optional','No');assert.equal((await service.list('quotations',opt,owner)).pagination.total,0);
  const list=await service.list('quotations',url,owner);assert.equal(list.pagination.total,1);assert.equal(list.data[0].fields['/stored/document_total'],'-212.40');
  const detail=await service.detail('quotations',list.data[0].record_key,url,owner);assert.equal(detail.document.lines[0].stockItemName,'SWITCH');assert.equal(detail.data.raw_record.GUID['#text'],'quote-guid');
  assert.equal((await service.list('enquiries',url,owner)).pagination.total,0);
  const safe=await service.list('quotations',url,manager);assert.equal(safe.data[0].fields['/stored/party_name'],'Fixture Customer');assert.equal(JSON.stringify(safe).includes('212.40'),false);assert.equal((await service.detail('quotations',safe.data[0].record_key,url,manager)).document,undefined);
  assert.deepEqual(await importTallySession(db,first.session,{requiredDatasets:['salesDocumentsXml']}),first.result);
  await load(envelope(voucher()));assert.equal((await service.list('quotations',url,owner)).pagination.total,1);
  const changed=voucher().replace('<ALTERID>1</ALTERID>','<ALTERID>2</ALTERID>').replace('<ISCANCELLED>No</ISCANCELLED>','<ISCANCELLED>Yes</ISCANCELLED>');await load(envelope(changed));
  const summary=await service.salesSummary('quotations',url,owner);assert.equal(summary.cancelled,1);assert.equal(summary.updated,1);assert.equal(summary.sourceCount,1);assert.equal(summary.pending,0);
  const filtered=new URL(url);filtered.searchParams.set('voucherStatus','CANCELLED');filtered.searchParams.set('customer','Fixture');filtered.searchParams.set('fromDate','2026-04-01');filtered.searchParams.set('toDate','2026-04-30');assert.equal((await service.list('quotations',filtered,owner)).pagination.total,1);filtered.searchParams.set('fromDate','2026-05-01');filtered.searchParams.delete('toDate');assert.equal((await service.list('quotations',filtered,owner)).pagination.total,0);
  const old=await service.detail('quotations',list.data[0].record_key,url,owner);assert.equal(old.history.length,3);
  await load(envelope(voucher()),'other company');assert.equal((await service.list('quotations',url,owner)).pagination.total,1);
  await load(envelope(''));const missing=await service.salesSummary('quotations',url,owner);assert.equal(missing.notSeenInLatest,1);assert.equal(missing.sourceCount,0);assert.equal((await service.list('quotations',url,owner)).pagination.total,1,'absent record history is retained');
  const noId=await load(envelope(voucher().replace('<GUID>quote-guid</GUID>','').replace('<MASTERID>42</MASTERID>','')));assert.equal(noId.result.status,'partial');assert.equal(noId.result.quarantined,1);
  const broken=await load('<ENVELOPE><broken>');assert.equal(broken.result.status,'failed');
 }finally{await db.close();await temporary.close();}
});
