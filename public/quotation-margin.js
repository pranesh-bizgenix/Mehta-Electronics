import {decimal,compare} from './money.js';

/** Existing BR-02 display states; an unconfirmed floor cannot imply a green flag. */
export function marginFlag(marginPercent,floor){
 if(marginPercent==null)return null;
 try{
  const margin=decimal(marginPercent),zero=compare(margin,decimal('0'));
  if(zero<0)return 'red';if(zero===0)return 'blue';
  if(floor===undefined||floor===null||floor==='')return null;
  return compare(margin,decimal(floor))<0?'red':'green';
 }catch{return null;}
}
