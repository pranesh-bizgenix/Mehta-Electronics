import type {Pagination} from '@/lib/api/client';
export interface RecordLink {kind:'customers'|'enquiries'|'quotations'|'orders';id:number}
export interface Email {id:string;subject:string;sender:string|null;receivedAt:string;status:string;attachmentCount:number;body:string|null;links:RecordLink[]}
export interface Attachment {id:string;emailId:string;name:string;mimeType:string;bytes:number|string;s3Bucket:string|null;s3Key:string|null;status:string}
export interface ProcessingRun {id:string;emailId:string|null;stage:string;status:string;startedAt:string|null;finishedAt:string|null;errorCode:string|null;source?:string}
export interface Integration {provider:string;status:string;checkedAt:string|null}
export interface Counts {emails:number;attachments:number;processed:number;pending:number;failed:number}
export interface Envelope<T> {data:T;sample:boolean;mode:string;truncated?:boolean}
export interface Collection<T> extends Envelope<T[]> {pagination:Pagination}
export interface EmailDetail extends Email {attachments:Attachment[];runs:ProcessingRun[]}
