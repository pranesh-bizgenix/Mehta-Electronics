import {validationFailed} from '../../core/errors.js';
import {normalizeIntake} from './contract.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateReviewCommand(body){
 if(!object(body)||!Number.isSafeInteger(body.version)||body.version<1)throw validationFailed('Reload the request and provide its current version.');
 for(const key of Object.keys(body))if(!['version','reason','resolutions'].includes(key))throw validationFailed('Unknown review field: '+key);
 if(body.resolutions!==undefined&&!object(body.resolutions))throw validationFailed('Provide review corrections as an object.');
}

// Corrections are separate from the immutable extraction. A partial second
// review must retain fields corrected during the first review.
export function mergeReviewResolutions(row,patch={}){
 if(!object(patch))throw validationFailed('Provide review corrections as an object.');
 for(const key of Object.keys(patch))if(!['customerId','assignedTo','header','items'].includes(key))throw validationFailed('Unknown resolution field: '+key);
 for(const key of ['customerId','assignedTo'])if(Object.hasOwn(patch,key)&&(!Number.isSafeInteger(patch[key])||patch[key]<1))throw validationFailed('Use a positive CRM ID for '+key+'.');
 if(Object.hasOwn(patch,'header')&&!object(patch.header))throw validationFailed('Provide reviewed header fields as an object.');
 if(Object.hasOwn(patch,'items')&&!Array.isArray(patch.items))throw validationFailed('Provide reviewed items as a list.');
 const previous=row.resolutions??{};
 const resolutions={...previous,...patch,...(patch.header?{header:{...previous.header,...patch.header}}:{})};
 const n=row.normalized;
 normalizeIntake({schemaVersion:n.schemaVersion,eventId:n.eventId,companyId:n.companyId,messageType:n.messageType,source:n.source,provenance:n.provenance,header:{...n.header,...resolutions.header},items:resolutions.items??n.items});
 return resolutions;
}
