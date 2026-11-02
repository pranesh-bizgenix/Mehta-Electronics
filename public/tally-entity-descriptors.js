// Shared API/UI contract: entity metadata and field presentation live here.
const defaultFields=['/stored/name','/stored/parent_name','/stored/gstin','/stored/base_unit','/stored/closing_quantity_text','/stored/closing_balance','/stored/closing_value'];
const configs=[
 ['companies','Companies','companiesXml','COMPANY','tally.read'],['groups','Groups','groupsXml','GROUP','tally.read'],
 ['ledgers','All ledgers','ledgersXml','LEDGER','customers.read'],['customers','Customers / Sundry Debtors','ledgersXml','LEDGER','customers.read'],
 ['vendors','Vendors / Sundry Creditors','ledgersXml','LEDGER','tally.read'],['banks','Banks & cash','ledgersXml','LEDGER','tally.read'],['expenses','Expenses','ledgersXml','LEDGER','tally.read'],['other','Other ledgers','ledgersXml','LEDGER','tally.read'],
 ['items','Stock items','stockXml','STOCKITEM','items.read'],['stock_groups','Stock groups','stockGroupsXml','STOCKGROUP','items.read'],
 ['categories','Stock categories','stockCategoriesXml','STOCKCATEGORY','items.read'],['units','Units','unitsXml','UNIT','items.read'],['godowns','Godowns','godownsXml','GODOWN','items.read'],
 ['price_levels','Price levels','priceLevelsXml','PRICELEVEL','items.read'],['cost_centres','Cost centres','costCentresXml','COSTCENTRE','tally.read'],
 ['vouchers','Vouchers','vouchersXml','VOUCHER','tally.read'],['reports','Retained reports',null,null,'tally.read'],
 ['quotations','Tally quotations','vouchersXml','VOUCHER','quotations.read'],['enquiries','Tally enquiries','vouchersXml','VOUCHER','enquiries.read'],
 ['voucher_types','Voucher types','voucherTypesXml','VOUCHERTYPE','tally.read']
];
export const TALLY_ENTITY_DESCRIPTORS=Object.fromEntries(configs.map(([id,label,dataset,xmlTag,permission])=>[id,{id,label,dataset,xmlTag,permission,defaultFields,baseEntity:['customers','vendors','banks','expenses','other'].includes(id)?'ledgers':id}]));
export function describeTallyField(key,entity,nonfinancial=false) {
 const label=key.replace(/^\/stored\//,'').replace(/^\/meta\//,'Source / ').replace(/^\/xml\//,'XML / ').replaceAll('~1','/').replaceAll('~0','~').replace(/\/#text$/,'').replaceAll('_',' ').replaceAll('/',' / ');
 const leaf=key.split('/').reverse().find(part=>part&&part!=='#text'&&!part.startsWith('@')&&!/^\d+$/.test(part))||key;
 const balance=/balance/i.test(leaf)&&!(entity==='items'&&/CLOSINGBALANCE|OPENINGBALANCE/i.test(leaf));
 const type=/observed_at|fetched_at|created_at|DATE|ALTEREDON|MODIFYDATE|BOOKSFROM|STARTINGFROM|APPLICABLEFROM|EFFECTIVEFROM|ENDINGAT/i.test(leaf)?'date':/GST.*RATE|TAX.*RATE/i.test(leaf)?'percent':balance||/closing_value|opening_value|CLOSINGVALUE|OPENINGVALUE|AMOUNT|CREDITLIMIT|MRP|COST|PRICE/i.test(leaf)?'money':/RATE/i.test(leaf)?'rate':/quantity|base_unit|BASEUNITS/i.test(leaf)?'quantity':'text';
 return {key,label,type,formatter:type,section:key.startsWith('/xml/')?'xml':key.startsWith('/meta/')?'source':'stored',permission:nonfinancial?'entity.read':'tally.financial',defaultVisible:defaultFields.includes(key),balance,drCr:'delivered_only'};
}
export function formatTallyField(value,field,fields={}) {
 if(value==null)return 'Not delivered';
 if(typeof value==='object')return JSON.stringify(value);
 const text=String(value);
 if(field.type==='date') {
  const iso=/^\d{8}$/.test(text)?`${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}T00:00:00Z`:text;
  const date=new Date(iso);return Number.isNaN(date.valueOf())?text:/^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(text)?date.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'}):date.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
 }
 if(field.type==='rate'){const match=text.match(/^([+-]?\d[\d,]*(?:\.\d+)?)(.*)$/);if(match)return formatTallyField(match[1],{...field,type:'money',balance:false},fields)+match[2];}
 if(['money','percent'].includes(field.type)) {
  const match=text.replaceAll(',','').match(/^([+-]?)(\d+)(?:\.(\d+))?(?:\s+(Dr|Cr))?$/i);
  if(match){const formatted=`${match[1]}${BigInt(match[2]).toLocaleString('en-IN')}.${(match[3]||'').padEnd(2,'0')}`;
   const flag=match[4]||(field.key==='/stored/closing_balance'?fields['/stored/dr_cr']:null);
   return formatted+(field.type==='percent'?'%':field.balance?` · ${flag||'Dr/Cr not supplied'}`:'');}
 }
 return text;
}
export function describeTallyEntity(kind,columns,publicColumns=[]) {
 const config=TALLY_ENTITY_DESCRIPTORS[kind];if(!config)throw new Error('Unknown Tally entity.');
 const permitted=new Set(publicColumns),ordered=[...config.defaultFields.filter(key=>columns.includes(key)),...columns.filter(key=>!config.defaultFields.includes(key))];
 return {...config,fields:ordered.map(key=>describeTallyField(key,config.baseEntity,permitted.has(key)))};
}
