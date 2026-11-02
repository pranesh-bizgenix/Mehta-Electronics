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
