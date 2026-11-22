import {transaction,id,decimal} from './crm-modules.js';
import {enquiryView,recordEnquiryRevision,writeAudit} from './db.js';
import {requireCustomerHandler} from './modules/operations/customer-gates.js';
import {hasPermission} from './rbac.js';
import {forbidden,validationFailed} from './core/errors.js';

/** Shared canonical creation; callers supply reviewed data, never another enquiry table. */
export async function createEnquiry(db,b,user){
 if(!hasPermission(user,'enquiries.create'))throw forbidden();
 await requireCustomerHandler(db,b.customerId,user);
 if(!await db.prepare("SELECT id FROM customers WHERE id=? AND status='ACTIVE'").get(id(b.customerId)))throw validationFailed('Choose an active customer.');
 if(typeof b.subject!=='string'||!b.subject.trim()||b.subject.length>500||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw validationFailed('Provide a subject and 1 to 100 enquiry lines.');
 if(b.assignedTo&&!await db.prepare("SELECT id FROM users WHERE id=? AND status='ACTIVE'").get(id(b.assignedTo)))throw validationFailed('Assigned salesperson is unavailable.');
 for(const line of b.lines){decimal(line.quantity,'Quantity',{positive:true});if(!line.description||line.description.length>2000)throw validationFailed('Every enquiry line requires a description.');if(line.targetPrice!=null)decimal(line.targetPrice,'Target price');if(line.itemId&&!await db.prepare("SELECT id FROM items WHERE id=? AND status='ACTIVE'").get(id(line.itemId)))throw validationFailed('Choose an active item.');}
 return transaction(db,user,b.reason||'Enquiry created',async()=>{
  const {n}=await db.prepare("SELECT nextval('enquiry_document_numbers') AS n").get();
  const number=`ENQ-${new Date().getUTCFullYear()}-${String(n).padStart(5,'0')}`;
  const row=await db.prepare('INSERT INTO enquiries(enquiry_number,customer_id,subject,source,expected_by,assigned_to,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id').get(number,b.customerId,b.subject,b.source??null,b.expectedBy??null,b.assignedTo??null,b.notes??null,user.id,user.id);
  for(const [position,line]of b.lines.entries())await db.prepare('INSERT INTO enquiry_lines(enquiry_id,item_id,description,quantity,target_price,position) VALUES(?,?,?,?,?,?)').run(row.id,line.itemId??null,line.description,line.quantity,line.targetPrice??null,position);
  await recordEnquiryRevision(db,row.id,user.id,b.reason||'Initial version');
  await writeAudit(db,{userId:user.id,entity:'ENQUIRY',recordId:row.id,action:'CREATE',reason:b.reason||'Enquiry created',newValue:{enquiryId:row.id,source:b.source??null,assignedTo:b.assignedTo??null}});
  return enquiryView(db,row.id);
 });
}
