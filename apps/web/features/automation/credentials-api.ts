import type {ApiClient} from '@/lib/api/client';
// Owner-facing provisioning client; never caches or persists issued secrets.
export interface AutomationCredential {id:string;label:string;status:string;generation:number;scopes:string[];ownerId:number;backupOwnerId:number;expiresAt:string;ratePerMinute:number;ipAllowlist:string[];companyIds?:string[];token?:string|null;replayed?:boolean}
export interface CredentialInput {id:string;label:string;scopes:string[];companyIds:string[];ownerId:number;backupOwnerId:number;expiresAt:string;ratePerMinute:number;ipAllowlist:string[];reason:string}
export const automationCredentialsApi=(api:ApiClient)=>({
 list:(signal?:AbortSignal)=>api.data<AutomationCredential[]>('GET','/api/v1/automation-credentials',undefined,{signal}),
 create:(body:CredentialInput)=>api.data<AutomationCredential>('POST','/api/v1/automation-credentials',body),
 change:(id:string,action:'rotate'|'revoke',body:{requestKey:string;expectedGeneration:number;reason:string})=>api.data<AutomationCredential>('POST',`/api/v1/automation-credentials/${id}/${action}`,body)
});
