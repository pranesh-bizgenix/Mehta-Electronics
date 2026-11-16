import {XMLBuilder,XMLParser} from 'fast-xml-parser';
import {required,fail} from './contracts.js';
import {validateXml,buildCreate} from './xml.js';
import {compare,decimal as parseDecimal} from '../../../public/money.js';
const decimal=value=>{try{return parseDecimal(value);}catch{fail(409,'Read-back contains an invalid exact decimal.');}};

const builder=new XMLBuilder({ignoreAttributes:false,format:false}),parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false});
const method=value=>{if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(value))fail(409,'Not set or invalid: field_mapping.readback_method');return value;};
export function queries({company,mapping,key,category,document}){
  const reference=required(mapping.idempotencyField,'field_mapping.idempotency_reference');
  const referenceMethod=required(mapping.idempotencyMethod,'field_mapping.idempotency_method');
  if(!((reference==='REFERENCE'&&referenceMethod==='Reference')||(reference==='NARRATION'&&referenceMethod==='Narration')))fail(422,'Idempotency field and read-back method do not match.');
  if(!/^[a-f0-9]{64}$/.test(key))fail(422,'Invalid idempotency key.');
  const probe=required(mapping.companyProbe,'field_mapping.company_probe');
  // This supported formula must still be confirmed in the Owner-approved mapping.
  if(probe.currentCompanyFilter!=='$Name = ##SVCurrentCompany')fail(409,'Not set or unsupported: field_mapping.current_company_filter');
  const make=(id,type,fetch,formula,companyName)=>validateXml(builder.build({ENVELOPE:{HEADER:{VERSION:'1',TALLYREQUEST:'Export Data',TYPE:'Collection',ID:id},BODY:{DESC:{STATICVARIABLES:{SVEXPORTFORMAT:'$$SysName:XML',...(companyName?{SVCURRENTCOMPANY:companyName}:{})},TDL:{TDLMESSAGE:{COLLECTION:{'@_NAME':id,TYPE:type,FETCH:fetch,FILTER:id+'Filter'},SYSTEM:{'@_TYPE':'Formulae','@_NAME':id+'Filter','#text':formula}}}}}}}));
  const fetch=['GUID','MASTERID','NAME','VOUCHERNUMBER',reference,...(mapping.readback?.fields??[]).map(f=>method(f.tally)),...(category==='PARTY_LEDGER'?[method(required(mapping.parentField,'field_mapping.parent_field')),...Object.values(mapping.partyFields??{}).map(method)]:[])].join(',');
  const identity=required(mapping.identityProbe,'field_mapping.identity_probe');
  const identityField=method(required(identity.method,'field_mapping.identity_method'));
  if(identityField!==(category==='PARTY_LEDGER'?'Name':'VoucherNumber')||category!=='PARTY_LEDGER'&&identity.voucherTypeMethod!=='VoucherTypeName')fail(409,'Identity probe must check the exact new ledger name or voucher number/type.');
  const identityValue=category==='PARTY_LEDGER'?document?.name:document?.number;
  if(document)required(identityValue,'document.identity');
  // Block every numbering mode unless its collision scope is explicitly mapped.
  if(category!=='PARTY_LEDGER'&&!['CRM','TALLY'].includes(mapping.numbering))fail(409,'Not set: field_mapping.numbering');
  if(category!=='PARTY_LEDGER'&&!mapping.readback?.inventory)fail(409,'Not set: field_mapping.readback.inventory');
  if(category!=='PARTY_LEDGER')for(const field of ['partyLedgerName','date',...(mapping.numbering==='CRM'?['number']:[])])if(!mapping.readback.fields?.some(f=>f.crm===field))fail(409,`Not set: field_mapping.readback.${field}`);
  const identityFormula=`$${identityField} = ${JSON.stringify(identityValue??'')}`+(category==='PARTY_LEDGER'?'':` AND $${method(required(identity.voucherTypeMethod,'field_mapping.identity_voucher_type_method'))} = ${JSON.stringify(required(mapping.voucherType,'field_mapping.voucher_type'))}`);
  return {companyProbeXml:make('ControlDeskWriteCompany',required(probe.collectionType,'field_mapping.company_collection_type'),'NAME,GUID',probe.currentCompanyFilter),
    readbackXml:make('ControlDeskWriteKey',required(mapping.readback?.collectionType,'field_mapping.readback_collection_type'),fetch+','+(mapping.readback.inventory?.container??'')+','+(mapping.ledgerContainer??''),`$${referenceMethod} = "${key}"`,company.name),
    identityProbeXml:make('ControlDeskWriteIdentity',required(identity.collectionType,'field_mapping.identity_collection_type'),'NAME,GUID,VOUCHERNUMBER',identityFormula,company.name)};
}
function records(xml,tag){
  validateXml(xml);const root=parser.parse(xml),rows=[];let collectionEvidence=false;
  const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){
    if(/LINEERROR|LASTERROR/i.test(key)&&String(child).trim())fail(409,'Tally read-back returned an error; absence is not established.');
    if(key==='COLLECTION')collectionEvidence=true;
    if(key===tag){for(const row of Array.isArray(child)?child:[child])if(row&&typeof row==='object')rows.push(row);}
    else if(typeof child==='object')walk(child);
  }};
  walk(root);if(!collectionEvidence)fail(409,'Read-back lacks collection evidence; absence is not established.');return rows;
}
export function verifyCompany(xml,expected){
  const rows=records(xml,'COMPANY');
  if(rows.length!==1||String(rows[0].NAME??rows[0]['@_NAME'])!==expected.name||String(rows[0].GUID??'')!==expected.guid)fail(409,'Tally current company name/GUID mismatch; no create is authorized.');
  return true;
}
export function verifyIdentityAbsent(xml,category){
  if(records(xml,category==='PARTY_LEDGER'?'LEDGER':'VOUCHER').length)fail(409,'An existing Tally identity conflicts with this CREATE. Review and link it; no overwrite is authorized.');
  return true;
}
export function readback(xml,{key,mapping,document,category}){
  const rows=records(xml,category==='PARTY_LEDGER'?'LEDGER':'VOUCHER').filter(row=>String(row[mapping.idempotencyField]??'')===key);
  if(rows.length===0)return {found:false};
  if(rows.length!==1)fail(409,'Multiple Tally records carry this idempotency key; human review required.');
  const row=rows[0],guid=row.GUID,masterId=row.MASTERID;
  if(!guid&&!masterId)fail(409,'Tally read-back did not return a stable record ID.');
  const fields=required(mapping.readback?.fields,'field_mapping.readback_fields');
  if(!Array.isArray(fields)||!fields.length||category!=='PARTY_LEDGER'&&!fields.some(f=>f.crm==='total'))fail(409,'Not set: field_mapping.readback_total_check');
  for(const field of fields){
    const actual=required(row[method(field.tally)],`readback.${field.tally}`),expected=required(document[field.crm],`document.${field.crm}`);
    if(field.kind==='DECIMAL'){
      if(!['POSITIVE','NEGATIVE'].includes(field.sign))fail(409,'Not set: field_mapping.readback_amount_sign');
      if(compare(decimal(actual),decimal((field.sign==='NEGATIVE'?'-':'')+expected))!==0)fail(409,'Read-back mapped financial value differs from the approved CRM snapshot.');
    }else if(field.kind==='TEXT'){
      const transformed=field.transform==='ISO_DATE_TO_TALLY'?String(expected).replaceAll('-',''):expected;
      if(field.transform&&field.transform!=='ISO_DATE_TO_TALLY')fail(409,'Unsupported read-back field transformation.');
      if(String(actual)!==String(transformed))fail(409,'Read-back mapped field differs from the approved CRM snapshot.');
    }else fail(409,'Not set: field_mapping.readback_value_kind');
  }
  if(category==='PARTY_LEDGER'){
    if(String(row.NAME??row['@_NAME'])!==document.name||String(row[mapping.parentField])!==mapping.parentName)fail(409,'Read-back party name or parent group differs.');
    for(const [source,target]of Object.entries(mapping.partyFields??{}))if(String(row[target]??'')!==String(document[source]??''))fail(409,'Read-back mapped party field differs.');
  }
  if(category!=='PARTY_LEDGER'){
    const expectedXml=parser.parse(buildCreate({category,document,mapping,company:{name:'comparison',guid:'comparison'},idempotencyKey:key}).xml);
    const expectedRecord=expectedXml.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER;
    const inventory=required(mapping.readback.inventory,'field_mapping.readback.inventory');
    const raw=row[method(inventory.container)],lines=Array.isArray(raw)?raw:raw?[raw]:[];
    if(lines.length!==document.lines.length)fail(409,'Read-back item count differs from the approved snapshot.');
    const used=new Set();
    for(const expected of document.lines){
      const index=lines.findIndex((line,i)=>!used.has(i)&&String(line[method(inventory.item)]??'')===expected.tallyItemName);if(index<0)fail(409,'Read-back stock item differs.');used.add(index);
      const line=lines[index],unit=expected.uom;
      const qty=String(line[method(inventory.quantity)]??'').trim(),rate=String(line[method(inventory.rate)]??'').trim();
      if(!qty.endsWith(' '+unit)||compare(decimal(qty.slice(0,-unit.length-1).trim()),decimal(expected.quantity))!==0)fail(409,'Read-back quantity or unit differs.');
      if(!rate.endsWith('/'+unit)||compare(decimal(rate.slice(0,-unit.length-1).trim()),decimal(expected.unitPrice))!==0)fail(409,'Read-back rate or unit differs.');
      const discount=line[inventory.discount]??'0';
      if(compare(decimal(String(discount).replace(/%$/,'')),decimal(expected.discountPercent))!==0)fail(409,'Read-back discount differs.');
      const expectedLines=expectedRecord[mapping.inventory.container],expectedLine=(Array.isArray(expectedLines)?expectedLines:[expectedLines])[document.lines.indexOf(expected)];
      if(compare(decimal(String(required(line[mapping.inventory.amount],'readback.line.amount'))),decimal(expectedLine[mapping.inventory.amount]))!==0)fail(409,'Read-back line amount differs.');
      const batches=line[mapping.batch.container],expectedBatch=expectedLine[mapping.batch.container];
      if(!batches||Array.isArray(batches)||String(batches[mapping.batch.godown])!==String(expectedBatch[mapping.batch.godown])||String(batches[mapping.batch.quantity])!==String(expectedBatch[mapping.batch.quantity])||compare(decimal(String(required(batches[mapping.batch.amount],'readback.batch.amount'))),decimal(expectedBatch[mapping.batch.amount]))!==0)fail(409,'Read-back godown allocation differs.');
    }
    const actualLedgers=row[mapping.ledgerContainer],expectedLedgers=expectedRecord[mapping.ledgerContainer];
    const actual=Array.isArray(actualLedgers)?actualLedgers:actualLedgers?[actualLedgers]:[],expected=Array.isArray(expectedLedgers)?expectedLedgers:[expectedLedgers];
    if(actual.length!==expected.length)fail(409,'Read-back accounting entry count differs.');
    const matched=new Set();
    for(const ledger of expected){const i=actual.findIndex((r,j)=>!matched.has(j)&&r[mapping.ledgerNameField]===ledger[mapping.ledgerNameField]&&compare(decimal(String(r[mapping.ledgerAmountField])),decimal(ledger[mapping.ledgerAmountField]))===0);if(i<0)fail(409,'Read-back mapped accounting entry differs.');matched.add(i);}
  }
  return {found:true,reference:{guid:guid??null,masterId:masterId??null,voucherNumber:row.VOUCHERNUMBER??null}};
}
