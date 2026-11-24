import {randomUUID} from 'node:crypto';
export function operationsFixture(type='ORDER_STATUS',action='ENQUIRY',email=randomUUID()){
 return {schema_version:'meheta-operations-v1',email_message_id:email,provider_message_id:'TEST_OPS_'+email,department:'OPERATIONS',operations_type:type,order_action:action,
 original_email:{sender:'fictional@example.test',subject:'ZZTEST_ Operations request',body:'Fictional request. No external delivery.'},request:{operations_type:type,order_action:action,po_numbers:['ZZTEST_PO'],stock_items:[],requested_changes:[],question_summary:'ZZTEST_ check order',needs_review:false,review_reasons:[]},requires_review:false,review_reasons:[]};
}
