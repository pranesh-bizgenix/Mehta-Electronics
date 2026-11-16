export interface QuotationRequest {reference:string;quantityInstructions:string;quantityConfirmed:boolean}
export interface QuotationLineRequest {sourceLine:string;tag:string;make:string;requestedSpecification:string;availability:string;availabilityAsOf:string;availabilitySource:string;leadTime:string}
export function quotationRequest(value?:unknown):QuotationRequest;
export function quotationLineRequest(value:unknown,today:string):QuotationLineRequest;
export function quotationRequestBlock(request?:Partial<QuotationRequest>):string|null;
