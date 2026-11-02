export interface TallyFieldDescriptor {key:string;label:string;type:string;formatter:string;section:string;permission:string;defaultVisible:boolean;balance:boolean;drCr:string}
export interface TallyEntityDescriptor {id:string;label:string;dataset:string|null;xmlTag:string|null;permission:string;defaultFields:string[];baseEntity:string;fields?:TallyFieldDescriptor[]}
export const TALLY_ENTITY_DESCRIPTORS:Record<string,TallyEntityDescriptor>;
export function describeTallyField(key:string,entity:string,nonfinancial?:boolean):TallyFieldDescriptor;
export function formatTallyField(value:unknown,field:TallyFieldDescriptor,fields?:Record<string,unknown>):string;
export function describeTallyEntity(kind:string,columns:string[],publicColumns?:string[]):TallyEntityDescriptor;
