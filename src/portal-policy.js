// Partner roles have a hard ceiling even if an access-matrix import grants an
// internal CRM key. Existing staff roles retain their current permission list.
export const portalRolePermissions=Object.freeze({
 CUSTOMER_PORTAL:Object.freeze(['portal.customer.read','portal.customer.submit']),
 VENDOR_PORTAL:Object.freeze(['portal.vendor.read','portal.vendor.submit'])
});
export const isPortalRole=role=>Object.hasOwn(portalRolePermissions,role);
export function restrictPortalPermissions(role,permissions){return isPortalRole(role)?permissions.filter(key=>portalRolePermissions[role].includes(key)):permissions;}
const personalRoutes=new Set([
 'GET /api/auth/me','POST /api/auth/login','POST /api/auth/logout','POST /api/auth/change-password',
 'GET /api/v1/auth/mfa','POST /api/v1/auth/mfa/enroll','POST /api/v1/auth/mfa/confirm','POST /api/v1/auth/verify-otp','POST /api/v1/auth/mfa/recovery-codes',
 'GET /api/v1/me/preferences','PUT /api/v1/me/preferences','PATCH /api/v1/me/preferences',
 'GET /api/crm/portal/me','GET /api/crm/portal/records','GET /api/crm/portal/requests','POST /api/crm/portal/requests',
 'GET /api/crm/portal/acknowledgements','POST /api/crm/portal/acknowledgements'
]);
// A route registered as merely "authenticated" must not accidentally expose
// internal CRM data to a newly introduced external account.
export function portalPathAllowed(role,method,pathname){
 if(!isPortalRole(role))return true;
 if(personalRoutes.has(method+' '+pathname))return true;
 if(method==='GET'&&/^\/api\/crm\/portal\/records\/(?:QUOTATIONS|ORDERS|INVOICES|SHIPMENTS|RFQS|PURCHASE_ORDERS)\/[0-9a-f-]+$/i.test(pathname))return true;
 return method==='POST'&&/^\/api\/crm\/portal\/documents\/(?:QUOTATION|INVOICE|SUPPLIER_TERMS)\/[0-9a-f-]+$/i.test(pathname);
}
