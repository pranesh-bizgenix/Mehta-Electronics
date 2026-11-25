import {supportPayloadSchema} from './payload-schema.js';
function openApiSchema(value){
 if(Array.isArray(value))return value.map(openApiSchema);
 if(!value||typeof value!=='object')return value;
 const result=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$schema'&&key!=='const').map(([key,v])=>[key,openApiSchema(v)]));
 if(Object.hasOwn(value,'const'))result.enum=[value.const];
 if(Array.isArray(value.type)){const types=value.type.filter(t=>t!=='null');delete result.type;if(types.length===1)result.type=types[0];else result.anyOf=types.map(type=>({type}));if(value.type.includes('null'))result.nullable=true;}
 return result;
}
export const supportRequestSchema=openApiSchema(supportPayloadSchema);
export const supportReceiptSchema={type:'object',additionalProperties:false,required:['id','companyId','status','requestKey','revision','duplicate','requiresReview','version'],properties:{id:{type:'string',format:'uuid'},companyId:{type:'string',format:'uuid'},status:{type:'string',enum:['NEEDS_REVIEW','REVIEWED','LINKED','CLOSED','REJECTED']},requestKey:{type:'string'},revision:{type:'integer',minimum:1},duplicate:{type:'boolean'},requiresReview:{type:'boolean'},version:{type:'integer',minimum:1}}};
