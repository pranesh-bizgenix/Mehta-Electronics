export interface OperationField {key:string;label:string;type:string;required:boolean}
export interface OperationDescriptor {label:string;department:string;financial:boolean;fields:OperationField[];actions:Record<string,string>}
export const OPERATION_DESCRIPTORS:Record<string,OperationDescriptor>;
export const CLOSED_OPERATION_STATUSES:string[];
