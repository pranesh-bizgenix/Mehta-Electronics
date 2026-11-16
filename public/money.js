// Exact rational arithmetic. Round only for display; never use binary floats for money.
export function decimal(value) {
  const text=String(value ?? '').trim();
  if(!/^[+-]?\d{1,24}(?:\.\d{1,12})?$/.test(text))throw new Error('A plain decimal with at most 12 decimal places is required.');
  const [whole,fraction='']=text.replace(/^[+-]/,'').split('.');
  return {n:(text.startsWith('-')?-1n:1n)*BigInt(whole+fraction),d:10n**BigInt(fraction.length)};
}
export const add=(a,b)=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
export const sub=(a,b)=>({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
export const mul=(a,b)=>({n:a.n*b.n,d:a.d*b.d});
export function div(a,b){if(b.n===0n)throw new Error('Cannot divide by zero.');return {n:a.n*b.d*(b.n<0n?-1n:1n),d:a.d*b.n*(b.n<0n?-1n:1n)};}
export const compare=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
export function format(a,places=2){
  const scale=10n**BigInt(places),negative=a.n<0n,n=negative?-a.n:a.n;
  let rounded=n*scale/a.d;if((n*scale)%a.d*2n>=a.d)rounded++;
  const digits=rounded.toString().padStart(places+1,'0');
  return `${negative&&rounded?'-':''}${places?digits.slice(0,-places)+'.'+digits.slice(-places):digits}`;
}

// Legacy documents retain aggregate-before-display rounding; managed quotations
// keep their existing per-line/component policy in quotation-math.js.
export function lineNet(line,quantityKey='quantity') {
  return mul(mul(decimal(line[quantityKey]),decimal(line.unit_price)),div(sub(decimal('100'),decimal(line.discount_percent)),decimal('100')));
}
export function legacyTotals(lines,quantityKey='quantity') {
  let subtotal=decimal('0'),tax=decimal('0');
  for(const line of lines){
    const net=lineNet(line,quantityKey);
    subtotal=add(subtotal,net);
    tax=add(tax,div(mul(net,decimal(line.tax_percent)),decimal('100')));
  }
  return {subtotal:format(subtotal),tax_total:format(tax),total:format(add(subtotal,tax))};
}
export function sumMoney(values){return format(values.reduce((sum,value)=>add(sum,decimal(value)),decimal('0')));}
export function formatIndian(value,places=2){
  const rounded=format(decimal(value),places),negative=rounded.startsWith('-');
  const [whole,fraction]=rounded.replace(/^-/,'').split('.');
  const tail=whole.slice(-3),head=whole.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,',');
  return `${negative?'-':''}${head?head+',':''}${tail}${places?'.'+fraction:''}`;
}

export const minorMoney=value=>format({n:value,d:100n});
