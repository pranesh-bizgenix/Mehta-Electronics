// Canonical emails and source documents are read-only. No body/file dereferencing.
export function createStoredAdapter(db) {
  return {sample:false, async read(){
    const emails=await db.prepare(`SELECT m.id,t.subject,m.sender_address AS sender,COALESCE(m.received_at,m.sent_at,m.created_at) AS "receivedAt",
      COALESCE(a.processing_status,'Unknown') AS status,t.customer_id,t.enquiry_id,t.quotation_id,t.sales_order_id
      FROM email_messages m LEFT JOIN email_threads t ON t.id=m.thread_id
      LEFT JOIN automation_email_metadata a ON a.email_id=m.id ORDER BY COALESCE(m.received_at,m.sent_at,m.created_at) DESC,m.id LIMIT 1001`).all();
    const attachments=await db.prepare(`SELECT a.id,a.email_id AS "emailId",s.original_name AS name,s.mime_type AS "mimeType",s.byte_count::text AS bytes,
      a.s3_bucket AS "s3Bucket",a.s3_key AS "s3Key",a.status FROM automation_attachments a JOIN source_documents s ON s.id=a.source_document_id
      WHERE a.email_id IN (SELECT id FROM email_messages ORDER BY COALESCE(received_at,sent_at,created_at) DESC,id LIMIT 1000) ORDER BY a.created_at DESC,a.id LIMIT 1001`).all();
    const runs=await db.prepare(`SELECT id,email_id AS "emailId",stage,status,started_at AS "startedAt",finished_at AS "finishedAt",error_code AS "errorCode"
      FROM automation_processing_runs WHERE email_id IN (SELECT id FROM email_messages ORDER BY COALESCE(received_at,sent_at,created_at) DESC,id LIMIT 1000)
      ORDER BY created_at DESC,id LIMIT 1001`).all();
    return {truncated:emails.length>1000||attachments.length>1000||runs.length>1000,
      emails:emails.slice(0,1000).map(({customer_id,enquiry_id,quotation_id,sales_order_id,...row})=>({...row,subject:row.subject||'(No subject)',body:null,
        links:[['customers',customer_id],['enquiries',enquiry_id],['quotations',quotation_id],['orders',sales_order_id]].filter(([,id])=>id).map(([kind,id])=>({kind,id}))})),
      attachments:attachments.slice(0,1000),runs:runs.slice(0,1000)};
  }};
}
