import {decimal,div,mul,format} from '../../../public/money.js';

export const QUALIFYING_ORDER_SQL="NOT o.is_deleted AND o.status<>'CANCELLED' AND (EXISTS(SELECT 1 FROM crm_order_workflows ow WHERE ow.sales_order_id=o.id AND ow.status IN ('APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED') AND ow.approved_version=ow.version) OR (NOT EXISTS(SELECT 1 FROM crm_order_workflows ow WHERE ow.sales_order_id=o.id) AND o.status IN ('CONFIRMED','PROCESSING','PARTIALLY_DISPATCHED','DISPATCHED','COMPLETED')))";

export const PERFORMANCE_NOTE='Operational measures, not incentive or payroll calculations. Existing configured intake scores are unchanged. Enquiry conversion = enquiries with a quotation recorded as sent divided by non-cancelled enquiries created in the period. Order conversion = quotations created in the period with an approved managed order or confirmed legacy order divided by quotations recorded as sent or ordered (including subsequently lost quotations). Each enquiry or quotation counts once. First response is measured from assignment, using automation requests with recorded response timestamps; unanswered requests are shown separately. Task timeliness = tasks completed by their due date divided by all tasks due in the period up to now, including overdue unfinished tasks. Response attribution follows the saved intake policy; other measures use the current enquiry/task owner or quotation creator, without reconstructing reassignment history. No targets, ranking or combined score are assumed.';
export function percentage(numerator,denominator){
 if(!/^\d+$/.test(String(numerator))||!/^\d+$/.test(String(denominator))||BigInt(numerator)>BigInt(denominator))throw new Error('Invalid performance counts.');
 return BigInt(denominator)===0n?'N/A':format(mul(div(decimal(String(numerator)),decimal(String(denominator))),decimal('100')),2)+'%';
}
export function performanceRow(row){return {...row,enquiry_conversion:percentage(row.quoted_enquiries,row.enquiries),order_conversion:percentage(row.ordered_quotes,row.issued_quotes),on_time_tasks:percentage(row.tasks_on_time,row.tasks_due)};}

/** Aggregate in PostgreSQL to avoid loading customer/message bodies or truncating staff metrics. */
export async function staffPerformance(db,actor,filters,all){
 const rows=await db.prepare(`WITH bounds AS (
 SELECT ?::date::timestamp AT TIME ZONE 'Asia/Kolkata' AS start_at,(?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS end_at
 ), e AS (
 SELECT e.assigned_to AS staff_id,count(*)::text AS enquiries,
 count(*) FILTER(WHERE EXISTS(SELECT 1 FROM quotations q WHERE q.enquiry_id=e.id AND NOT q.is_deleted AND (q.status IN ('SENT','ACCEPTED','REJECTED') OR EXISTS(SELECT 1 FROM crm_quotation_events qe WHERE qe.quotation_id=q.id AND qe.action IN ('SEND','EMAIL_SENT')))))::text AS quoted_enquiries
 FROM enquiries e,bounds b WHERE NOT e.is_deleted AND e.status<>'CANCELLED' AND e.created_at>=b.start_at AND e.created_at<b.end_at GROUP BY e.assigned_to
 ), q AS (
 SELECT q.created_by AS staff_id,count(*)::text AS issued_quotes,
 count(*) FILTER(WHERE EXISTS(SELECT 1 FROM sales_orders o WHERE o.quotation_id=q.id AND ${QUALIFYING_ORDER_SQL}))::text AS ordered_quotes
 FROM quotations q,bounds b WHERE NOT q.is_deleted AND q.created_at>=b.start_at AND q.created_at<b.end_at
 AND ((q.status IN ('SENT','ACCEPTED','REJECTED') OR EXISTS(SELECT 1 FROM crm_quotation_events qe WHERE qe.quotation_id=q.id AND qe.action IN ('SEND','EMAIL_SENT'))) OR EXISTS(SELECT 1 FROM sales_orders o WHERE o.quotation_id=q.id AND ${QUALIFYING_ORDER_SQL})) GROUP BY q.created_by
 ), t AS (
 SELECT t.owner_user_id AS staff_id,count(*)::text AS tasks_due,
 count(*) FILTER(WHERE t.status='DONE' AND t.completed_at<=t.due_at)::text AS tasks_on_time
 FROM tasks t,bounds b WHERE NOT t.is_deleted AND t.status<>'FORWARDED' AND t.due_at>=b.start_at AND t.due_at<b.end_at AND t.due_at<=now() GROUP BY t.owner_user_id
 ), r AS (
 SELECT CASE WHEN i.response_policy->'value'->>'reassignmentAttribution'='FIRST_ASSIGNEE' THEN (i.response_policy->>'firstAssigneeId')::integer ELSE coalesce((i.response_policy->>'firstResponderId')::integer,i.assigned_to) END AS staff_id,count(*) FILTER(WHERE i.first_response_at>=i.first_assigned_at)::text AS responded_requests,
 count(*) FILTER(WHERE i.first_response_at IS NULL)::text AS unanswered_requests,
 round(avg(extract(epoch FROM(i.first_response_at-i.first_assigned_at))/60) FILTER(WHERE i.first_response_at>=i.first_assigned_at),2)::text AS response_minutes
 FROM crm_sales_intakes i,bounds b WHERE i.status<>'CANCELLED' AND i.first_assigned_at>=b.start_at AND i.first_assigned_at<b.end_at GROUP BY 1
 ) SELECT u.id::text AS staff_id,u.name AS staff,
 COALESCE(e.enquiries,'0') AS enquiries,COALESCE(e.quoted_enquiries,'0') AS quoted_enquiries,
 COALESCE(q.issued_quotes,'0') AS issued_quotes,COALESCE(q.ordered_quotes,'0') AS ordered_quotes,
 COALESCE(t.tasks_due,'0') AS tasks_due,COALESCE(t.tasks_on_time,'0') AS tasks_on_time,
 COALESCE(r.responded_requests,'0') AS responded_requests,COALESCE(r.unanswered_requests,'0') AS unanswered_requests,
 COALESCE(r.response_minutes,'N/A') AS average_response_minutes
 FROM users u LEFT JOIN e ON e.staff_id=u.id LEFT JOIN q ON q.staff_id=u.id LEFT JOIN t ON t.staff_id=u.id LEFT JOIN r ON r.staff_id=u.id
 WHERE (?::boolean OR u.id=?) AND (e.staff_id IS NOT NULL OR q.staff_id IS NOT NULL OR t.staff_id IS NOT NULL OR r.staff_id IS NOT NULL)
 ORDER BY u.name,u.id LIMIT 1001`).all(filters.from,filters.to,all,actor.id);
 return rows.map(performanceRow);
}
