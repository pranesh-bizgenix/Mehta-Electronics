export const isPartnerRole=(role:string)=>role==='CUSTOMER_PORTAL'||role==='VENDOR_PORTAL';
export function partnerDestination(role:string,next:string|null){
 if(!isPartnerRole(role))return null;
 // Never follow an internal-CRM or protocol-relative return URL for a partner.
 return next==='/settings'?'/settings':'/portal';
}
