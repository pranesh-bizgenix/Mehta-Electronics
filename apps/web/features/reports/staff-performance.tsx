'use client';
import {DataTable} from '@/components/ds';

type StaffRow=Record<string,string>;
function ratio(row:StaffRow,value:string,numerator:string,denominator:string,empty:string){
 return row[value]==='N/A'?empty:`${row[value]} (${row[numerator]} of ${row[denominator]})`;
}
export function StaffPerformanceTable({rows,note}:{rows:StaffRow[];note:string}){
 return <div className="stack">
  <p>Compare recorded work for the selected period. Missing activity is shown clearly and does not earn a score.</p>
  <DataTable<StaffRow> id="staff-performance" caption="Staff performance measures" rows={rows} rowKey={r=>r.staff_id??r.staff} columns={[
   {key:'staff',header:'Staff',width:'20%',render:r=>r.staff},
   {key:'enquiries',header:'Enquiries quoted',render:r=>ratio(r,'enquiry_conversion','quoted_enquiries','enquiries','No enquiries')},
   {key:'orders',header:'Quotes converted to orders',render:r=>ratio(r,'order_conversion','ordered_quotes','issued_quotes','No issued quotes')},
   {key:'response',header:'Average first response',render:r=>r.average_response_minutes==='N/A'?'Not recorded':`${r.average_response_minutes} minutes (${r.responded_requests} responses)`},
   {key:'tasks',header:'Tasks finished on time',render:r=>ratio(r,'on_time_tasks','tasks_on_time','tasks_due','No tasks due')},
   {key:'waiting',header:'Awaiting first response',numeric:true,render:r=>r.unanswered_requests}
  ]}/>
  <details><summary>How these measures are calculated</summary><p>{note}</p><p>These measures do not calculate salary, bonuses or deductions.</p></details>
 </div>;
}
