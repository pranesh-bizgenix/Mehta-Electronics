import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {fingerprint} from '../../core/runtime.js';
import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
const pointer=s.string({min:1,max:300,pattern:/^\/(?:[A-Za-z0-9_.~-]+\/?)+$/});
export const stockPolicySchema=s.object({maximumSourceAgeMinutes:s.int({min:1,max:525600}),reservedQuantityPointer:pointer,reservationsPointer:pointer,reservationShape:s.enum(['ARRAY','SINGLETON']),reservationQuantityPointer:pointer,reservationKeyPointer:pointer,reservationReferencePointer:pointer.optional(),reservationPartyPointer:pointer.optional(),instructions:s.string({min:3,max:2000})});
function leaf(path){return path?.split('/').at(-1).toUpperCase();}
export function stockPolicyProblem(value){
 if(!/(QTY|QUANTITY)$/.test(leaf(value.reservedQuantityPointer)??''))return 'The reserved total must map an explicitly named quantity field.';
 if(!/(ORDER|RESERV|ALLOC)/i.test(value.reservationsPointer))return 'Select an operational order/reservation/allocation collection.';
 if(!/(QTY|QUANTITY)$/.test(leaf(value.reservationQuantityPointer)??''))return 'Each reservation must map an explicitly named quantity field.';
 if(!['GUID','ORDERGUID','ORDERID','MASTERID','ALLOCATIONID'].includes(leaf(value.reservationKeyPointer)))return 'Reservation identity must use a stable source ID, not a display name.';
 if(value.reservationReferencePointer&&!['ORDERNO','ORDERNUMBER','VOUCHERNUMBER','REFERENCE','REFNO'].includes(leaf(value.reservationReferencePointer)))return 'Select an operational order reference field.';
 if(value.reservationPartyPointer&&!['PARTYNAME','PARTYLEDGERNAME','CUSTOMERNAME'].includes(leaf(value.reservationPartyPointer)))return 'Select an operational party-name field.';
 for(const path of Object.values(value).filter(v=>typeof v==='string'&&v.startsWith('/')))if(/(?:^|\/)(?:__proto__|prototype|constructor|.*(?:AMOUNT|RATE|VALUE|COST|MARGIN|PRICE|DISCOUNT|BANK|TAX).*)(?:\/|$)/i.test(path))return 'Financial or unsafe fields cannot be exposed through stock checks.';
 return null;
}
/** No evaluation, prototype traversal, financial projection or inferred paths. */
export function stockPointer(raw,path){
 let node=raw;for(const part of path.split('/').slice(1).map(v=>v.replaceAll('~1','/').replaceAll('~0','~'))){if(node==null||typeof node!=='object'||!Object.hasOwn(node,part))return undefined;node=node[part];}return node;
}
const scalar=value=>value&&typeof value==='object'&&!Array.isArray(value)?value['#text']:value;
function label(value){value=scalar(value);return typeof value==='string'&&value.length<=250?value.trim():null;}
/** Quantity must state its source unit; a bare amount never becomes stock. */
export function stockQuantity(value,uom){
 value=scalar(value);if(typeof value!=='string'||typeof uom!=='string'||!uom.trim())return null;
 const match=/^([+-]?\d{1,24}(?:\.\d{1,6})?)\s+(.+)$/.exec(value.trim());
 if(!match||match[2].normalize('NFKC').trim().toUpperCase()!==uom.normalize('NFKC').trim().toUpperCase())return null;
 try{return format(decimal(match[1]),6);}catch{return null;}
}
/** Pure operational evidence only. Missing evidence remains null, never zero. */
export function evaluateStock({source,policy,requestedQuantity,basis,reservationKey=null,now=new Date(),latestAttempt=null}){
 requestedQuantity=validate(s.string({pattern:/^\d{1,24}(?:\.\d{1,6})?$/}),requestedQuantity,'requestedQuantity');
 basis=validate(s.enum(['FREE_STOCK','RESERVED_STOCK']),basis,'basis');
 if(compare(decimal(requestedQuantity),decimal('0'))<=0)throw validationFailed('Requested quantity must be positive.');
 const issues=[],uom=source?.uom??null,stockInHand=stockQuantity(source?.closing_quantity_text,uom),reservations=[];
 if(!source?.stable)issues.push('A single stable item link in the selected company is required.');
 if(stockInHand===null)issues.push('On-hand quantity or its exact source unit is unavailable.');
 let config=null;if(policy)try{config=validate(stockPolicySchema,policy.value);if(stockPolicyProblem(config))config=null;}catch{config=null;}
 if(!config)issues.push('Not set: stock.availability — blocks verified free/reserved stock checks.');
 let reservedQuantity=null,freeQuantity=null,selectedReservedQuantity=null;
 if(config&&source?.raw_record){
  reservedQuantity=stockQuantity(stockPointer(source.raw_record,config.reservedQuantityPointer),uom);
  if(reservedQuantity===null||compare(decimal(reservedQuantity),decimal('0'))<0){reservedQuantity=null;issues.push('Reserved total is missing, negative or has a different unit.');}
  const collection=stockPointer(source.raw_record,config.reservationsPointer),rows=config.reservationShape==='SINGLETON'&&collection&&typeof collection==='object'&&!Array.isArray(collection)?[collection]:config.reservationShape==='ARRAY'&&Array.isArray(collection)?collection:null;
  if(!rows||rows.length>2000)issues.push('The configured reservation collection is absent, has the wrong shape or exceeds 2,000 rows.');
  else{
   let sum=decimal('0');
   for(const [index,row]of rows.entries()){
    const key=label(stockPointer(row,config.reservationKeyPointer)),quantity=stockQuantity(stockPointer(row,config.reservationQuantityPointer),uom);
    if(!key||quantity===null||compare(decimal(quantity),decimal('0'))<0){issues.push(`Reservation row ${index+1} needs a stable ID and non-negative quantity in the source unit.`);continue;}
    sum=add(sum,decimal(quantity));reservations.push({position:index+1,key,quantity,reference:config.reservationReferencePointer?label(stockPointer(row,config.reservationReferencePointer)):null,party:config.reservationPartyPointer?label(stockPointer(row,config.reservationPartyPointer)):null});
   }
   if(reservedQuantity!==null&&compare(sum,decimal(reservedQuantity))!==0)issues.push('Reservation details do not reconcile to the source reserved total.');
  }
  if(reservedQuantity!==null&&stockInHand!==null)freeQuantity=format(sub(decimal(stockInHand),decimal(reservedQuantity)),6);
 }else if(config)issues.push('Original reservation source evidence is unavailable.');
 const sourceAt=source?.sourceTimestamp?new Date(source.sourceTimestamp):null,ageSeconds=sourceAt&&Number.isFinite(sourceAt.getTime())?Math.floor((now-sourceAt)/1000):null;
 if(ageSeconds===null||ageSeconds<0)issues.push('A valid non-future source timestamp is required; import time is not a substitute.');
 if(!source?.session_id)issues.push('The source upload receipt is missing.');
 if(!latestAttempt||!['imported','received_empty','retained'].includes(latestAttempt.status)||latestAttempt.quarantined_count>0)issues.push('The latest item sync attempt is missing, incomplete or quarantined.');
 if(basis==='RESERVED_STOCK'){
  const matching=reservationKey?reservations.filter(row=>row.key===reservationKey):[];
  if(!matching.length)issues.push('Select an exact stable reservation ID from this company/item source.');
  else selectedReservedQuantity=format(matching.reduce((sum,row)=>add(sum,decimal(row.quantity)),decimal('0')),6);
 }
 // The generated log column is numeric(30,6); subtraction/summing can exceed
 // the source operands' precision. Refuse instead of clamping or rounding.
 for(const quantity of [freeQuantity,selectedReservedQuantity])if(quantity!==null&&!/^-?\d{1,24}\.\d{6}$/.test(quantity))throw validationFailed('Computed stock quantity exceeds the supported 24 whole digits. Review the source quantities.');
 const stale=Boolean(config&&ageSeconds!==null&&ageSeconds>=0&&ageSeconds>config.maximumSourceAgeMinutes*60);
 const status=!config?'UNVERIFIED':stale?'STALE':issues.length?'REVIEW_REQUIRED':'VERIFIED';
 const usableQuantity=basis==='FREE_STOCK'?freeQuantity:selectedReservedQuantity;
 const result={stockInHand,reservedQuantity,freeQuantity,selectedReservedQuantity,uom,requestedQuantity,basis,reservationKey,sourceTimestamp:ageSeconds!==null&&ageSeconds>=0?sourceAt.toISOString():null,sourceSessionId:source?.session_id??null,sourceRecordKey:source?.record_key??null,policyVersion:policy?.version??null,reservations,issues,status,available:status==='VERIFIED'&&usableQuantity!==null?compare(decimal(usableQuantity),decimal(requestedQuantity))>=0:null};
 return {...result,ageSeconds,previewFingerprint:fingerprint({...result,itemId:source?.item_id??null,companyId:source?.company_id??null})};
}
