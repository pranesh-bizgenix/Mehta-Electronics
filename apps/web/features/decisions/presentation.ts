import type {BusinessDecision} from './api.ts';

/** Input parsing never converts monetary values or percentages to floating point. */
export function parseDecisionInput(decision:Pick<BusinessDecision,'valueKind'|'numberEncoding'|'options'>,text:string):unknown {
 const value=text.trim();
 if(!value)throw new Error('Enter an answer before saving. Leave the decision empty if it is not agreed.');
 if(decision.valueKind==='CHOICE'){
  const option=decision.options.find((_,index)=>String(index)===value);
  if(!option)throw new Error('Choose an answer from the listed options.');
  return option.value;
 }
 if(decision.valueKind==='NUMBER'){
  if(decision.numberEncoding==='DECIMAL_STRING'){
   if(!/^\d+(?:\.\d{1,6})?$/.test(value))throw new Error('Enter an exact amount without currency symbols, commas or more than six decimal places.');
   return value;
  }
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('Enter a whole number within the supported range.');
  return Number(value);
 }
 if(decision.valueKind==='TEXT')return value;
 let parsed:unknown;
 try{parsed=JSON.parse(value);}catch{throw new Error('The structured answer is incomplete. Check the field names, quotation marks and brackets.');}
 const inspect=(entry:unknown):boolean=>typeof entry==='number'?Number.isSafeInteger(entry):Array.isArray(entry)?entry.every(inspect):entry!==null&&typeof entry==='object'?Object.values(entry).every(inspect):true;
 if(!inspect(parsed))throw new Error('Use quoted decimal strings for amounts and percentages; only safe whole numbers may be unquoted.');
 return parsed;
}

export function decisionInputText(decision:Pick<BusinessDecision,'valueKind'|'options'|'value'>):string {
 if(decision.value==null)return '';
 if(decision.valueKind==='CHOICE'){
  const index=decision.options.findIndex(option=>JSON.stringify(option.value)===JSON.stringify(decision.value));
  return index<0?'':String(index);
 }
 return decision.valueKind==='JSON'?JSON.stringify(decision.value,null,2):String(decision.value);
}

export function describeDecisionValue(value:unknown):string {
 if(value==null)return 'Not set';
 if(Array.isArray(value))return value.length?value.map(describeDecisionValue).join('; '):'Empty list';
 if(typeof value==='object')return Object.entries(value).map(([key,entry])=>`${key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')}: ${describeDecisionValue(entry)}`).join('; ');
 return String(value);
}

/** Server-provided fix links must stay inside this CRM origin. */
export function decisionFixHref(href:string|undefined):string {
 return href?.startsWith('/')&&!href.startsWith('//')&&!/[\\\r\n]/.test(href)?href:'/rules';
}
