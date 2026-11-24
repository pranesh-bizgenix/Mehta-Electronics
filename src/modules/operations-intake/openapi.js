const text=(maxLength=250)=>({type:'string',maxLength});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:true});
const list=(items,maxItems)=>({type:'array',items,maxItems});
export const operationsRequestSchema=obj({
 schema_version:{type:'string',enum:['meheta-operations-v1']},email_message_id:{type:'string',format:'uuid'},provider_message_id:{...text(),minLength:1},department:{type:'string',enum:['OPERATIONS']},
 operations_type:{type:'string',enum:['ORDER_STATUS','STOCK_PROCUREMENT','STOCK','PROCUREMENT','OTHER']},order_action:{type:'string',enum:['ENQUIRY','UPDATE_REQUEST','CANCEL_REQUEST','NOT_APPLICABLE']},
 original_email:obj({sender:{type:'string',format:'email',maxLength:254},subject:text(500),body:text(20000)},['sender']),
 request:obj({operations_type:text(30),order_action:text(30),po_numbers:list(text(120),20),stock_items:list(obj({product_code:{...text(200),nullable:true},product_name:{...text(1000),nullable:true},requested_quantity:{nullable:true,oneOf:[{type:'number',exclusiveMinimum:true,minimum:0},{type:'string',pattern:'^\\d{1,18}(?:\\.\\d{1,6})?$'}]},unit:{...text(40),nullable:true}},[]),10),requested_changes:list(obj({field:text(100),requested_value:text(2000),source_quote:text(2000)}),100),question_summary:text(2000)},['operations_type','order_action','po_numbers','stock_items','requested_changes','question_summary']),
 review_reasons:list(text(1000),100),requires_review:{type:'boolean'},source_archive:obj({s3_bucket:text(63),s3_key:text(2000),sha256:{type:'string',pattern:'^[a-f0-9]{64}$',nullable:true}},['s3_bucket','s3_key'])
},['schema_version','email_message_id','provider_message_id','department','operations_type','order_action','original_email','request']);
export const operationsReceiptSchema=obj({id:{type:'string',format:'uuid'},companyId:{type:'string',format:'uuid'},kind:{type:'string',enum:['ORDER_STATUS','STOCK','PROCUREMENT','OTHER']},status:{type:'string',enum:['NEEDS_REVIEW','REVIEWED','APPROVED','REJECTED','COMPLETED']},requiresReview:{type:'boolean'},duplicate:{type:'boolean'},version:{type:'integer',minimum:1}});
