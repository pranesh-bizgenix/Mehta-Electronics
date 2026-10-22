-- Append-only CRM audit events also serve as durable dispatch retry receipts.
CREATE UNIQUE INDEX crm_dispatch_retry_key
 ON crm_order_events(sales_order_id,(public_detail->>'requestKey'))
 WHERE action='DISPATCHED' AND public_detail ? 'requestKey';
