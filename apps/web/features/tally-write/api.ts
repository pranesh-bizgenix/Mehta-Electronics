export type Category = 'SALES_ORDER'|'PURCHASE_ORDER'|'PARTY_LEDGER';
export interface WriteCategory {
 category:Category; enabled:boolean; dry_run_only:boolean; company_id:string|null; mapping_id:string|null;
 approval_mode:string|null; conflict_winner:Record<string,string>|null; tally_version:string|null; xml_import_verified:boolean|null;
 max_attempts:number|null; backoff_seconds:number|null; failure_threshold:number|null; min_gap_seconds:number|null; per_day_cap:number|null; lease_seconds:number|null;
 paused:boolean; consecutive_failures:number;
}
export interface Settings {control:{master_enabled:boolean;approval_mode:string|null};categories:WriteCategory[];blockedPrem:string}
export interface Mapping {id:string;version:number;status:string;configuration:Record<string,unknown>;reason:string;created_by?:number}
export interface Source {record_key:string;record_id:string;name:string;tally_guid:string|null;master_id:string|null}
export interface Job {id:string;category:Category;entity_id:string;status:string;dry_run:boolean;attempts:number;last_error:string|null;payload_xml?:string;response_xml?:string;validation_report?:unknown;events?:unknown[];snapshot?:unknown}
export interface Monitor {counts:{status:string;count:number;oldest:string}[];jobs:Job[];alerts:{id:string;code:string;message:string}[];categories:WriteCategory[]}
