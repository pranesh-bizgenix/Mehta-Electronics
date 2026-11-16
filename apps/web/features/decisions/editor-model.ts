import type {BusinessDecision} from './api.ts';

export interface Field {key:string;label:string;kind?:'INTEGER'|'DECIMAL'|'BOOLEAN'|'LINES';choices?:{value:string;label:string}[];optional?:boolean}
export interface Editor {rows?:boolean;scalarRows?:boolean;allowEmpty?:boolean;fields:Field[]}
const choice=(value:string,label:string)=>({value,label});
// Form shapes and allowed choices describe the existing server schemas. No answer is preselected.
export const EDITORS:Record<string,Editor>={
 'discount.role_limits':{rows:true,fields:[{key:'role',label:'Staff role',choices:['OWNER','MANAGER','EXECUTIVE','ACCOUNTS','LOGISTICS_LEAD','STORE_STAFF'].map(value=>choice(value,value.replace(/_/g,' ')))},{key:'maximumPercent',label:'Maximum discount (%)',kind:'DECIMAL'}]},
 'discount.levels':{fields:[1,2,3].flatMap(level=>[{key:`level${level}.min`,label:`Level ${level}: lowest discount (%)`,kind:'DECIMAL' as const},{key:`level${level}.max`,label:`Level ${level}: highest discount (%)`,kind:'DECIMAL' as const}])},
 'quotation.approval_levels':{rows:true,fields:[{key:'name',label:'Approval level name'},{key:'permission',label:'Existing approval permission from Users & roles'},{key:'sequence',label:'Approval order (required when multiple stages match)',kind:'INTEGER',optional:true},{key:'appliesTo',label:'When is this approval required?',choices:[choice('DISCOUNT_LEVEL_2','Level 2 discount'),choice('DISCOUNT_LEVEL_3','Level 3 discount'),choice('BELOW_MARGIN_FLOOR','Below the margin floor'),choice('ALL','Every quotation')]}]},
 'quotation.approval_reviewer_policy':{fields:[{key:'reuse',label:'May the same eligible independent employee complete several stages?',choices:[choice('DISTINCT_REVIEWERS','A different reviewer for each stage'),choice('ALLOW_REUSE','The same eligible reviewer may complete several stages')]},{key:'instructions',label:'Agreed reviewer instructions'}]},
 'credit.tiers':{rows:true,fields:[{key:'name',label:'Credit tier name'},{key:'criteria',label:'Who qualifies for this tier?'},{key:'limit',label:'Credit limit (INR)',kind:'DECIMAL'}]},
 'credit.tier_labels':{rows:true,scalarRows:true,fields:[{key:'value',label:'Credit period label'}]},
 'tally.write.categories':{rows:true,scalarRows:true,allowEmpty:true,fields:[{key:'value',label:'Category for later release review',choices:[choice('SALES_ORDER','Sales orders'),choice('PURCHASE_ORDER','Purchase orders'),choice('PARTY_LEDGER','Party ledgers')]}]},
 'sla.policy':{fields:[{key:'timezone',label:'Agreed timezone'},{key:'businessHours.start',label:'Working day starts at (HH:MM)'},{key:'businessHours.end',label:'Working day ends at (HH:MM)'},{key:'holidays',label:'Holidays, one YYYY-MM-DD date per line',kind:'LINES',optional:true}]},
 'credit.validation':{fields:[{key:'exposureBasis',label:'What counts towards credit exposure?',choices:[choice('DEBIT_BALANCE_ONLY','Outstanding debit balance'),choice('DEBIT_BALANCE_PLUS_OPEN_ORDERS','Outstanding debit balance plus open orders')]},{key:'maximumSourceAgeMinutes',label:'Maximum source age (minutes)',kind:'INTEGER'},{key:'allowUnavailableOwnerReview',label:'May Owner review if a balance is unavailable?',kind:'BOOLEAN'}]},
 'credit.exception_authority':{fields:[{key:'permission',label:'Existing permission needed to approve an exception'},{key:'instructions',label:'Credit exception instructions'}]},
 'customers.potential_threshold':{fields:[{key:'metric',label:'Which records count?',choices:[choice('ORDER_COUNT','Orders'),choice('INVOICE_COUNT','Invoices')]},{key:'threshold',label:'Number required',kind:'INTEGER'},{key:'periodDays',label:'Over how many days?',kind:'INTEGER'}]},
 'customers.new_existing_threshold':{fields:[{key:'metric',label:'Which records count?',choices:[choice('ORDER_COUNT','Orders'),choice('INVOICE_COUNT','Invoices')]},{key:'threshold',label:'Number required',kind:'INTEGER'},{key:'periodDays',label:'Over how many days?',kind:'INTEGER'}]},
 'quotation.cost_basis':{fields:[{key:'basis',label:'Cost to use for margin checks',choices:[choice('RECORDED_ITEM_COST','Recorded item cost'),choice('APPROVED_SUPPLIER_NET_COST','Approved supplier net cost')]},{key:'instructions',label:'Instructions for choosing the cost'}]},
 'payments.authorisation':{fields:[{key:'maximumAmount',label:'Maximum authorised amount (INR)',kind:'DECIMAL'},{key:'checks',label:'Mandatory checks, one per line',kind:'LINES'}]},
 'warranty.period':{fields:[{key:'months',label:'Warranty period (months)',kind:'INTEGER'},{key:'startsFrom',label:'When does the warranty start?',choices:[choice('BILLING_DATE','Billing date'),choice('PURCHASE_DATE','Purchase date')]},{key:'instructions',label:'Warranty period instructions'}]},
 'warranty.policy':{fields:[{key:'periodMonths',label:'Warranty period (months)',kind:'INTEGER'},{key:'firstResponseHours',label:'First response target (hours)',kind:'INTEGER'},{key:'technicalFaultsOnly',label:'Only technical faults qualify?',kind:'BOOLEAN'}]},
 'complaints.bands':{rows:true,fields:[{key:'name',label:'Complaint band name'},{key:'criteria',label:'What qualifies for this band?'},{key:'firstResponseHours',label:'First response target (hours)',kind:'INTEGER'}]},
 'sales.alert_hours':{fields:[{key:'hours',label:'Hours until a sales alert is due',kind:'INTEGER'},{key:'repeat',label:'Should the alert repeat?',kind:'BOOLEAN'}]},
 'reminders.limits':{fields:[{key:'maximumCount',label:'Maximum number of reminders',kind:'INTEGER'},{key:'minimumIntervalMinutes',label:'Minimum interval (minutes)',kind:'INTEGER'},{key:'stopConditions',label:'When must reminders stop?'}]},
 'escalation.policy':{fields:[{key:'toBackupAfterMinutes',label:'Minutes overdue before backup escalation',kind:'INTEGER'},{key:'toManagerAfterMinutes',label:'Minutes overdue before manager escalation',kind:'INTEGER'}]},
 'kpi.weights':{rows:true,fields:[{key:'metric',label:'Metric name'},{key:'definition',label:'How is it measured?'},{key:'weightPercent',label:'Weight (%)',kind:'DECIMAL'}]},
 'kpi.formulas':{rows:true,fields:[{key:'metric',label:'Metric name'},{key:'definition',label:'Confirmed event and calculation'}]},
 'incentive.formula':{fields:[{key:'instructions',label:'Agreed incentive calculation'}]},
 'admin.identity':{fields:[{key:'instructions',label:'Who is Admin and what may they approve?'}]},
 'gst.provider':{fields:[{key:'name',label:'Approved provider name'},{key:'instructions',label:'Provider and activation instructions'}]},
 'procurement.principal_ordering':{fields:[{key:'instructions',label:'When and how should principal orders be placed?'}]},
 'price_lists.approval_policy':{fields:[{key:'reviewerPermission',label:'Existing reviewer permission',choices:[choice('items.update','Manage items'),choice('quotations.approve','Approve quotations'),choice('purchasing.approve','Approve purchasing')]},{key:'instructions',label:'Price-list review instructions'}]},
 'price_lists.retirement_policy':{fields:[{key:'reviewerPermission',label:'Existing reviewer permission',choices:[choice('items.update','Manage items'),choice('quotations.approve','Approve quotations'),choice('purchasing.approve','Approve purchasing')]},{key:'instructions',label:'Retirement and replacement instructions'}]},
 'stock.availability':{fields:[{key:'maximumSourceAgeMinutes',label:'Maximum stock source age (minutes)',kind:'INTEGER'},{key:'reservedQuantityPointer',label:'Verified source path for the reserved quantity'},{key:'reservationsPointer',label:'Verified source path for reservation details'},{key:'reservationShape',label:'Source collection format',choices:[choice('ARRAY','A list of reservation records'),choice('SINGLETON','One reservation record')]},{key:'reservationQuantityPointer',label:'Verified quantity path inside each reservation'},{key:'reservationKeyPointer',label:'Verified stable identity path inside each reservation'},{key:'reservationReferencePointer',label:'Optional order reference path',optional:true},{key:'reservationPartyPointer',label:'Optional party path',optional:true},{key:'instructions',label:'Tally expert’s source mapping instructions'}]},
 'tally.conflict_winners':{rows:true,fields:[{key:'category',label:'Record category',choices:[choice('customers','Customers'),choice('vendors','Vendors'),choice('items','Items')]},{key:'winner',label:'Which source wins?',choices:[choice('TALLY','Tally'),choice('CRM','CRM')] }]}
};

const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function valueAt(value:unknown,key:string):unknown {return key.split('.').reduce<unknown>((current,part)=>isObject(current)?current[part]:undefined,value);}
function textAt(value:unknown,field:Field):string {const entry=valueAt(value,field.key);return entry==null?'':Array.isArray(entry)?entry.join('\n'):String(entry);}
function setAt(value:Record<string,unknown>,key:string,entry:unknown):void {const parts=key.split('.');let current=value;for(const part of parts.slice(0,-1)){const child=current[part];current[part]=isObject(child)?child:{};current=current[part] as Record<string,unknown>;}current[parts[parts.length-1]]=entry;}
function fieldValue(field:Field,text:string):unknown {
 if(!text.trim()){if(field.optional)return undefined;throw new Error(`${field.label}: enter an answer.`);}
 if(field.kind==='INTEGER'){if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error(`${field.label}: enter a whole number.`);return Number(text);}
 if(field.kind==='DECIMAL'){if(!/^\d+(?:\.\d{1,6})?$/.test(text))throw new Error(`${field.label}: enter an exact number without commas or currency symbols (up to six decimal places).`);return text;}
 if(field.kind==='BOOLEAN'){if(!['true','false'].includes(text))throw new Error(`${field.label}: choose Yes or No.`);return text==='true';}
 if(field.kind==='LINES')return text.split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
 return text.trim();
}

export function structuredDecisionEditor(key:string):boolean {return Boolean(EDITORS[key]);}

export function initialStructuredDrafts(decision:BusinessDecision):Record<string,string>[] {
 const spec=EDITORS[decision.key];if(!spec)return [];
 if(decision.key==='sla.policy'){
  const policy=isObject(decision.value)?decision.value:{},minutes=isObject(policy.turnaroundMinutes)?policy.turnaroundMinutes:{};
  return [{...Object.fromEntries(spec.fields.map(field=>[field.key,textAt(policy,field)])),businessDays:Array.isArray(policy.businessDays)?policy.businessDays.join(','):''},...Object.entries(minutes).map(([entity,value])=>({entity,minutes:String(value)}))];
 }
 const source=spec.rows?(Array.isArray(decision.value)?decision.value:[]):[decision.value];
 return source.map(value=>Object.fromEntries(spec.fields.map(field=>[field.key,textAt(spec.scalarRows?{value}:value,field)])));
}

export function structuredDecisionValue(key:string,drafts:Record<string,string>[]):unknown {
 const spec=EDITORS[key];if(!spec)throw new Error('No structured editor is available for this answer.');
 if(key==='sla.policy'){
  const header=drafts[0]??{},businessDays=(header.businessDays??'').split(',').filter(Boolean),turnaroundMinutes:Record<string,number>={};
  if(!businessDays.length)throw new Error('Choose at least one agreed working day.');
  if(drafts.length<2)throw new Error('Add at least one record type and its agreed deadline.');
  for(const row of drafts.slice(1)){
   const entity=(row.entity??'').trim();if(!/^[A-Z][A-Z_]+$/.test(entity))throw new Error('Choose a supported record type for each deadline.');
   if(Object.hasOwn(turnaroundMinutes,entity))throw new Error('Each record type may have only one deadline.');
   turnaroundMinutes[entity]=fieldValue({key:'minutes',label:'Deadline in business minutes',kind:'INTEGER'},(row.minutes??'').trim()) as number;
  }
  const value:Record<string,unknown>={businessDays,turnaroundMinutes};
  for(const field of spec.fields){const entry=fieldValue(field,(header[field.key]??'').trim());if(entry!==undefined)setAt(value,field.key,entry);}
  return value;
 }
 if(spec.rows&&!spec.allowEmpty&&!drafts.length)throw new Error('Add at least one explicit entry before saving.');
 const result=drafts.map(row=>{const value:Record<string,unknown>={};for(const field of spec.fields){const entry=fieldValue(field,(row[field.key]??'').trim());if(entry!==undefined)setAt(value,field.key,entry);}return spec.scalarRows?value.value:value;});
 return spec.rows?result:result[0];
}
