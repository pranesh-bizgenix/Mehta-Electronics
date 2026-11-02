// UI display only. Identity, exports, raw payloads and stored fields are untouched.
const win1252 = ['€','\u0081','‚','ƒ','„','…','†','‡','ˆ','‰','Š','‹','Œ','\u008d','Ž','\u008f','\u0090','‘','’','“','”','•','–','—','˜','™','š','›','œ','\u009d','ž','Ÿ'];
const codes = new Map(win1252.map((char,index)=>[char,index+128]));
const score = value => (value.match(/Ã.|Â.|â.|�/gu)||[]).length;
export function tallyDisplay(value) {
  if(typeof value!=='string')return value;
  let text=value;
  for(let pass=0;pass<2&&score(text);pass++) {
    const bytes=[];let valid=true;
    for(const char of text) {const code=codes.get(char)??(char.codePointAt(0)<=255?char.codePointAt(0):null);if(code==null){valid=false;break;}bytes.push(code);}
    if(!valid)break;
    try{const candidate=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes));if(score(candidate)>=score(text))break;text=candidate;}catch{break;}
  }
  return text;
}
