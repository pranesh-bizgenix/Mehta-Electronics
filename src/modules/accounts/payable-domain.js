import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {validationFailed,conflict} from '../../core/errors.js';

export function payableMoney(value){
 if(typeof value!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(value))throw validationFailed('Use a positive exact INR amount.');
 const exact=decimal(value),rounded=format(exact,2);
 if(compare(exact,decimal('0'))<=0||compare(exact,decimal(rounded))!==0)throw validationFailed('Supplier payment amounts must be positive exact paise.');
 return rounded;
}
export function payableBalance(amount,{notes=[],payments=[],excludePaymentId=null}={}){
 const gross=decimal(amount),deductions=notes.filter(n=>n.status==='APPROVED').reduce((sum,n)=>add(sum,decimal(n.amount)),decimal('0'));
 const confirmed=payments.filter(p=>p.status==='CONFIRMED').reduce((sum,p)=>add(sum,decimal(p.amount)),decimal('0'));
 const reserved=payments.filter(p=>['PENDING_APPROVAL','APPROVED'].includes(p.status)&&p.id!==excludePaymentId).reduce((sum,p)=>add(sum,decimal(p.amount)),decimal('0'));
 const net=sub(gross,deductions),outstanding=sub(net,confirmed),available=sub(outstanding,reserved);
 return {gross:format(gross,6),adjustments:format(deductions,6),net:format(net,6),paid:format(confirmed,6),outstanding:format(outstanding,6),reserved:format(reserved,6),available:format(available,6)};
}
export function assertPaymentCapacity(amount,balance){
 const value=payableMoney(amount);
 if(compare(decimal(value),decimal(balance.available))>0)throw conflict('The payment exceeds the supplier balance after approved notes, confirmed payments and pending approvals.');
 return value;
}
