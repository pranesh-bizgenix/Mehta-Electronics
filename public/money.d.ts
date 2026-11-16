export interface ExactDecimal {n:bigint;d:bigint}
export function decimal(value:string|number):ExactDecimal;
export function add(a:ExactDecimal,b:ExactDecimal):ExactDecimal;
export function sub(a:ExactDecimal,b:ExactDecimal):ExactDecimal;
export function mul(a:ExactDecimal,b:ExactDecimal):ExactDecimal;
export function div(a:ExactDecimal,b:ExactDecimal):ExactDecimal;
export function compare(a:ExactDecimal,b:ExactDecimal):-1|0|1;
export function format(value:ExactDecimal,places?:number):string;
export function formatIndian(value:string|number,places?:number):string;
export function minorMoney(value:bigint):string;
export function sumMoney(values:string[]):string;
export function lineNet(line:Record<string,string>,quantityKey?:string):ExactDecimal;
export function legacyTotals(lines:Record<string,string>[],quantityKey?:string):{subtotal:string;tax_total:string;total:string};
