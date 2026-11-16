import {s,validate} from '../../core/schema.js';
import {validationFailed,notFound} from '../../core/errors.js';
import {RuleRegistry,F1_RULES} from '../rules/rule-definitions.js';
import {BUSINESS_RULES} from '../rules/business-rule-definitions.js';
import {OPERATIONS_RULES} from '../operations/operations-rules.js';
import {marginFloorDefinition} from '../rules/quotation-policy-source.js';

export const DECISION_STATUSES=Object.freeze(['EMPTY','PROPOSED','ENTERED','CONFIRMED','REJECTED']);
const exact=()=>s.string({pattern:/^\d{1,14}(?:\.\d{1,6})?$/});
const integer=()=>s.int({min:0,max:525600});
const extra=(key,group,label,dependents,schema,editor={})=>({key,group,label,description:label,dependents,schema,decisionOnly:true,...editor});
// These are questions and validation shapes, never business values or proposals.
export const ADDITIONAL_DECISIONS=[
 extra('customers.new_existing_threshold','Customers','How should new and existing customers be distinguished?',['Automatic customer classification'],s.object({metric:s.enum(['ORDER_COUNT','INVOICE_COUNT']),threshold:s.int({min:1,max:100000}),periodDays:s.int({min:1,max:3650})})),
 extra('quotation.cost_basis','Pricing','Which item cost should quotation margins use?',['Quotation margin policy'],s.object({basis:s.enum(['RECORDED_ITEM_COST','APPROVED_SUPPLIER_NET_COST']),instructions:s.reason()})),
 extra('quotation.default_validity_days','Pricing','How many days should a quotation remain valid?',['Default quotation validity'],s.int({min:1,max:3650}),{valueKind:'NUMBER',numberEncoding:'INTEGER'}),
 extra('invoice.authority','Accounts','Where must the invoice be created?',['Invoice link and document workflow'],s.enum(['TALLY_CREATES','CRM_CREATES']),{valueKind:'CHOICE',options:[{label:'Tally creates the invoice',value:'TALLY_CREATES'},{label:'CRM creates the invoice (adapter disabled)',value:'CRM_CREATES'}]}),
 extra('warranty.period','Support','What warranty period applies, and from which date?',['Warranty eligibility'],s.object({months:s.int({min:1,max:120}),startsFrom:s.enum(['BILLING_DATE','PURCHASE_DATE']),instructions:s.reason()})),
 extra('warranty.scope','Support','Which faults qualify for warranty?',['Warranty eligibility'],s.enum(['TECHNICAL_FAULTS_ONLY','OWNER_DEFINED']),{valueKind:'CHOICE',options:[{label:'Technical faults only',value:'TECHNICAL_FAULTS_ONLY'},{label:'Owner-defined coverage',value:'OWNER_DEFINED'}]}),
 extra('sla.first_response_hours','Support','How many hours are allowed for the first response?',['First-response reporting'],s.int({min:1,max:87600}),{valueKind:'NUMBER',numberEncoding:'INTEGER'}),
 extra('supplier.first_reminder_minutes','Purchasing','After how many minutes should a supplier follow-up task be due?',['Supplier in-app follow-up tasks'],integer(),{valueKind:'NUMBER',numberEncoding:'INTEGER'}),
 extra('reminder.before_date_days','Tasks and reminders','How many days before a due date should a reminder become due?',['Reminder due dates'],integer(),{valueKind:'NUMBER',numberEncoding:'INTEGER'}),
 extra('delivery.followup_days_after_dispatch','Logistics','How many days after dispatch should delivery follow-up be due?',['Delivery follow-up tasks'],integer(),{valueKind:'NUMBER',numberEncoding:'INTEGER'}),
 extra('sales.alert_hours','Sales','When should a sales alert become due, and should it repeat?',['Sales in-app alerts'],s.object({hours:s.int({min:1,max:87600}),repeat:s.bool()})),
 extra('extraction.total_tolerance_inr','Orders','What exact rupee difference may PO reconciliation tolerate?',['PO total reconciliation'],exact(),{valueKind:'NUMBER',numberEncoding:'DECIMAL_STRING'}),
 extra('credit.tier_labels','Credit','Which credit period labels should be available?',['Credit tier choices'],s.array(s.string({min:1,max:60}),{min:1,max:50}),{validate:value=>new Set(value.map(v=>v.toLowerCase())).size===value.length?null:'Each tier label must be unique'}),
 extra('credit.exception_authority','Credit','Who may approve credit exceptions?',['Credit exception review'],s.object({permission:s.string({min:3,max:80}),instructions:s.reason()})),
 extra('kpi.formulas','Reporting','Which confirmed events and calculations define each KPI?',['KPI calculation'],s.array(s.object({metric:s.string({min:1,max:80}),definition:s.reason()}),{min:1,max:50}),{validate:value=>new Set(value.map(v=>v.metric.toLowerCase())).size===value.length?null:'Each metric must be unique'}),
 extra('incentive.formula','Reporting','How should incentives be calculated?',['Incentive reporting'],s.object({instructions:s.reason()})),
 extra('admin.identity','Controls','Who is Admin and what authority should that role have?',['Admin-specific workflows'],s.object({instructions:s.reason()})),
 extra('gst.provider','Accounts','Which approved provider will supply GST, IRN and e-Way services?',['Statutory document adapter (disabled)'],s.object({name:s.string({min:1,max:120}),instructions:s.reason()})),
 extra('warehouse.application','Logistics','Should warehouse staff use the installable web app or a native app?',['Warehouse mobile release'],s.enum(['PWA','NATIVE']),{valueKind:'CHOICE',options:[{label:'Installable web app',value:'PWA'},{label:'Native app',value:'NATIVE'}]}),
 extra('tally.write.categories','Tally integration','Which Tally write categories may be considered for later approval?',['Tally write release review; actual switches remain OFF'],s.array(s.enum(['SALES_ORDER','PURCHASE_ORDER','PARTY_LEDGER']),{max:3}),{validate:value=>new Set(value).size===value.length?null:'Each category must be unique'}),
 extra('tally.write.items','Tally integration','Where must item masters be created?',['Item master authority review'],s.enum(['NONE']),{valueKind:'CHOICE',options:[{label:'Create items only in Tally; no CRM item writes',value:'NONE'}]}),
 extra('tally.conflict.winner','Tally integration','Which system is the source of truth when retained records conflict?',['Tally conflict policy review'],s.enum(['TALLY','CRM']),{valueKind:'CHOICE',options:[{label:'Tally wins',value:'TALLY'},{label:'CRM wins (requires separate release review)',value:'CRM'}]})
];

const suggestions={
 'warranty.period':{value:{months:12,startsFrom:'BILLING_DATE',instructions:'One year from billing date; Owner confirmation required'},source:'Master Prompt v2 D3; 27 Oct MoM draft / F13'},
 'warranty.scope':{value:'TECHNICAL_FAULTS_ONLY',source:'Master Prompt v2 D3; BR-16'},
 'sla.first_response_hours':{value:48,source:'Master Prompt v2 D3; 27 Oct MoM draft; conflicts with same-day build pack'},
 'supplier.first_reminder_minutes':{value:30,source:'Master Prompt v2 D3; 23 Oct action item 13'},
 'reminder.before_date_days':{value:7,source:'Master Prompt v2 D3; BR-11'},
 'delivery.followup_days_after_dispatch':{value:12,source:'Master Prompt v2 D3; 27 Oct draft, unconfirmed'},
 'extraction.total_tolerance_inr':{value:'1.00',source:'Master Prompt v2 D3; non-functional requirements'},
 'invoice.authority':{value:'TALLY_CREATES',source:'Master Prompt v2 D3; F10 / section 13'},
 'tally.write.categories':{value:['SALES_ORDER'],source:'Master Prompt v2 D3; 2 Nov: sales orders only; switches stay OFF'},
 'tally.write.items':{value:'NONE',source:'Master Prompt v2 D3; BR-17'},
 'tally.conflict.winner':{value:'TALLY',source:'Master Prompt v2 D3; BR-18'}
};

function href(d){if(d.group==='Pricing')return '/quotations?tool=policy';if(d.group==='Credit'||d.group==='Customers')return '/customers';if(d.group==='Purchasing')return '/purchasing';if(d.group==='Logistics')return '/logistics';if(d.group==='Support')return '/operations';if(d.group==='Reporting')return '/dashboard';if(d.group==='Accounts')return '/operations';if(d.group==='Stock')return '/items/stock-checks';if(d.group==='Tally integration')return '/tally/conflicts';return '/rules';}
const scalar={
 'margin.floor_percent':['NUMBER','DECIMAL_STRING'],
 'credit.default_limit_new_customer':['NUMBER','DECIMAL_STRING'],
 'audit.retention_days':['NUMBER','INTEGER'],
 'credit.grace_days':['NUMBER','INTEGER'],
 'tasks.reminder_interval_minutes':['NUMBER','INTEGER'],
 'email.poll_interval_minutes':['NUMBER','INTEGER']
};
export class DecisionCatalog {
 constructor(registry){this.registry=registry??new RuleRegistry([...F1_RULES,...OPERATIONS_RULES,...BUSINESS_RULES,marginFloorDefinition(null)]);this.definitions=new Map([...this.registry.all(),...ADDITIONAL_DECISIONS].map(d=>[d.key,d]));}
 all(){return [...this.definitions.values()];}
 get(key){return this.definitions.get(key);}
 require(key){const d=this.get(key);if(!d)throw notFound('Decision key not found.');return d;}
 metadata(d){const editor=scalar[d.key]??[d.valueKind??'JSON',d.numberEncoding??null],suggestion=suggestions[d.key];let hints=null;if(d.key==='sla.first_response_hours')hints='Source notes conflict between 48 hours and same day. Owner must decide.';if(d.key==='sales.alert_hours')hints='D3 cites five hours, but one-time versus repeating is unresolved. No complete value is proposed.';if(d.key==='tasks.reminder_interval_minutes')hints='F1 cites a two-to-three-hour range only; Owner must enter one confirmed interval.';if(d.key==='email.poll_interval_minutes')hints='23 Oct cites a two-to-five-minute range only; this does not enable mailbox intake.';return {key:d.key,area:d.group,label:d.label,description:d.description,plainQuestion:d.plainQuestion??d.label,workflow:d.dependents.join(', '),blockedWorkflows:d.dependents,shape:d.shape??null,fixHref:href(d),valueKind:editor[0],numberEncoding:editor[1],options:d.options??[],hints,recommendedValue:suggestion?.value??null,suggestedEvidence:suggestion?.source??null,suggestionStatus:suggestion?'PROPOSED':null,external:d.key==='margin.floor_percent',decisionOnly:Boolean(d.decisionOnly)};}
 validate(d,raw){
  if(['margin.floor_percent','credit.default_limit_new_customer','extraction.total_tolerance_inr'].includes(d.key)&&typeof raw!=='string')throw validationFailed(`${d.label}: enter money or percentages as exact decimal strings.`);
  if(d.key==='payments.authorisation'&&typeof raw?.maximumAmount!=='string')throw validationFailed('Payment authorisation maximumAmount must be an exact decimal string.');
  const value=validate(d.schema,raw,d.label),problem=d.validate?.(value);if(problem)throw validationFailed(`${d.label}: ${problem}.`,{rule:d.key});
  return value;
 }
}
