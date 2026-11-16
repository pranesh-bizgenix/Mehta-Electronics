import {XMLBuilder,XMLParser,XMLValidator} from 'fast-xml-parser';
import {decimal,format,compare,sumMoney} from '../../../public/money.js';
import {calculateQuotation} from '../../../public/quotation-math.js';
import {category,required,fail} from './contracts.js';

const builder=new XMLBuilder({ignoreAttributes:false,format:false,processEntities:true});
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:true});
const tag=value=>{required(value,'field_mapping.tag');if(!/^[A-Z][A-Z0-9_.]{0,79}$/.test(value)||/ACTION|DELETE|ALTER|ENVELOPE|IMPORTDATA|TALLYMESSAGE|^(?:GUID|MASTERID|REMOTEID|VCHKEY|ID)$|VOUCHER$|LEDGER$/.test(value))fail(422,'Unsupported mapped XML field.');return value;};
const safe=value=>{const text=String(value??'');if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||text.length>10000)fail(422,'Invalid or excessive XML field text.');return text;};
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value??'')||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail(422,'Invalid document date.');return value.replaceAll('-','');};
function signed(value,sign){if(!['POSITIVE','NEGATIVE'].includes(sign))fail(409,'Not set: field_mapping.amount_sign');if(compare(decimal(value),decimal('0'))<0)fail(422,'A normalized create amount cannot be negative.');return sign==='NEGATIVE'?'-'+format(decimal(value),6):format(decimal(value),6);}
export function validateXml(xml){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)fail(422,'Invalid or excessive Tally XML.');
  return xml;
}
function envelope(companyName,record,report){return validateXml(builder.build({ENVELOPE:{HEADER:{TALLYREQUEST:'Import Data'},BODY:{IMPORTDATA:{REQUESTDESC:{REPORTNAME:safe(report),STATICVARIABLES:{SVCURRENTCOMPANY:safe(companyName)}},REQUESTDATA:{TALLYMESSAGE:record}}}}}));}

/** Template v1. Every Tally field name, posting sign and accounting name is mapped explicitly. */
export function buildCreate({category:kind,document,mapping,company,idempotencyKey:key}){
  category(kind);required(company?.name,'company.name');required(company?.guid,'company.guid');required(key,'idempotency_key');
  if(mapping?.templateVersion!==1)fail(409,'Not set: field_mapping.template_version');
  const reference=required(mapping.idempotencyField,'field_mapping.idempotency_reference');
  if(!['REFERENCE','NARRATION'].includes(reference))fail(422,'Choose a supported idempotency reference field.');
  const report=required(mapping.reportName,'field_mapping.report_name');
  const record={'@_ACTION':'Create',[tag(reference)]:safe(key)};
  if(kind==='PARTY_LEDGER'){
    required(document.name,'party.name');record['@_NAME']=safe(document.name);
    record[tag(required(mapping.parentField,'field_mapping.parent_field'))]=safe(required(mapping.parentName,'field_mapping.parent_name'));
    for(const [source,target]of Object.entries(mapping.partyFields??{})){
      if(['NAME',reference,mapping.parentField].includes(target))fail(422,'Mapped party fields cannot replace the CREATE identity, parent or idempotency key.');
      record[tag(target)]=safe(required(document[source],`party.${source}`));
    }
  }else{
    const header=required(mapping.header,'field_mapping.header'),inventory=required(mapping.inventory,'field_mapping.inventory');
    record['@_VCHTYPE']=safe(required(mapping.voucherType,'field_mapping.voucher_type'));
    record[tag(header.voucherType)]=safe(mapping.voucherType);record[tag(header.date)]=date(document.date);
    record[tag(header.party)]=safe(required(document.partyLedgerName,'party.stable_tally_link'));
    if(!['TALLY','CRM'].includes(mapping.numbering))fail(409,'Not set: field_mapping.numbering');
    if(mapping.numbering==='CRM')record[tag(required(header.number,'field_mapping.number'))]=safe(required(document.number,'document.number'));
    if(!Array.isArray(document.lines)||!document.lines.length)fail(422,'No document lines.');
    const totals=calculateQuotation(document.lines,required(document.sellerState,'seller_state'),required(document.placeOfSupply,'place_of_supply'));
    if(compare(decimal(totals.total),decimal(required(document.total,'document.total')))!==0)fail(422,'CRM document total does not reconcile with its lines.');
    if(!mapping.units||!mapping.godown)fail(409,'Not set: field_mapping.units_and_godown');
    record[tag(inventory.container)]=totals.lines.map(line=>{
      const item=required(line.tallyItemName,'item.stable_tally_link'),unit=required(mapping.units[String(line.itemId)],`field_mapping.units.${line.itemId}`);
      if(unit!==line.uom)fail(422,'Mapped unit differs from the approved document.');
      const value={[tag(inventory.item)]:safe(item),[tag(inventory.quantity)]:`${safe(line.quantity)} ${safe(unit)}`,[tag(inventory.rate)]:`${safe(line.unitPrice)}/${safe(unit)}`,[tag(inventory.amount)]:signed(line.net,inventory.amountSign)};
      // A discounted net amount must never be emitted with an unexplained gross rate.
      if(compare(decimal(line.discountPercent),decimal('0'))!==0) value[tag(required(inventory.discount,'field_mapping.inventory.discount'))]=safe(line.discountPercent);
      const batch=required(mapping.batch,'field_mapping.batch');
      value[tag(batch.container)]={[tag(batch.godown)]:safe(mapping.godown),[tag(batch.quantity)]:`${safe(line.quantity)} ${safe(unit)}`,[tag(batch.amount)]:signed(line.net,inventory.amountSign)};
      return value;
    });
    const entries=required(mapping.ledgerEntries,'field_mapping.tax_handling');
    if(!Array.isArray(entries)||entries.length<2)fail(409,'Not set: field_mapping.tax_handling');
    const ledgerValues=entries.map(entry=>{
      if(!['subtotal','cgst','sgst','igst','total'].includes(entry.source))fail(422,'Unknown mapped accounting component.');
      const ledger=entry.party===true?document.partyLedgerName:required(entry.name,'field_mapping.ledger_name');
      return {[tag(required(mapping.ledgerNameField,'field_mapping.ledger_name_field'))]:safe(ledger),[tag(required(mapping.ledgerAmountField,'field_mapping.ledger_amount_field'))]:signed(totals[entry.source],entry.sign)};
    });
    const balance=sumMoney(entries.map(entry=>signed(totals[entry.source],entry.sign)));
    if(compare(decimal(balance),decimal('0'))!==0)fail(422,'Mapped accounting entries do not balance.');
    record[tag(required(mapping.ledgerContainer,'field_mapping.ledger_container'))]=ledgerValues;
  }
  const xml=envelope(company.name,{[kind==='PARTY_LEDGER'?'LEDGER':'VOUCHER']:record},report);
  return {xml,validation:{templateVersion:1,createOnly:true,companyVerified:true,idempotencyKey:key,totalsVerified:kind!=='PARTY_LEDGER'}};
}
export function parseImportResponse(xml){
  validateXml(xml);const root=parser.parse(xml);let result=null;
  function walk(value){if(!value||typeof value!=='object')return;if(Object.hasOwn(value,'CREATED'))result=value;for(const nested of Object.values(value))if(typeof nested==='object')walk(nested);}
  walk(root);if(!result)return {success:false,error:'MISSING_IMPORT_RESULT'};
  const counts={};for(const key of ['CREATED','ALTERED','DELETED','ERRORS','EXCEPTIONS','CANCELLED','IGNORED']){
    const raw=result[key];if(raw===undefined){counts[key]=null;continue;}if(!/^\d+$/.test(String(raw)))return {success:false,error:'INVALID_IMPORT_COUNTS'};counts[key]=String(raw);
  }
  const errors=[];function findError(value){if(!value||typeof value!=='object')return;for(const [key,nested]of Object.entries(value)){if(/LINEERROR|LASTERROR/i.test(key)&&String(nested).trim())errors.push(String(nested).slice(0,1000));else if(typeof nested==='object')findError(nested);}}findError(root);
  const success=counts.CREATED==='1'&&counts.ALTERED==='0'&&counts.DELETED==='0'&&counts.ERRORS==='0'&&!errors.length&&['EXCEPTIONS','CANCELLED','IGNORED'].every(k=>counts[k]===null||counts[k]==='0');
  return {success,counts,error:success?null:errors[0]||'IMPORT_NOT_EXACTLY_ONE_CREATE'};
}
