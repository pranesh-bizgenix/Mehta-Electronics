import { getConfig } from '../src/config.js';
import { openDatabase, recordEnquiryRevision, recordQuotationRevision, writeAudit } from '../src/db.js';

const db=openDatabase(getConfig());
const marker=db.prepare("SELECT id FROM audit_logs WHERE entity='DEMO_DATA' AND record_id='v1'").get();
if(marker){console.log('Demo data v1 is already loaded.');db.close();process.exit(0)}

const day=(offset)=>{const date=new Date();date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10)};
const owner=db.prepare("SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();
if(!owner){db.close();throw new Error('An active owner account is required before loading demo data.')}

db.exec('BEGIN IMMEDIATE');
try{
  const addCustomer=db.prepare(`INSERT INTO customers(customer_code,name,normalized_name,gstin,pan,credit_limit,credit_days,owner_id,status,billing_address,shipping_address,city,state,pincode,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addContact=db.prepare(`INSERT INTO customer_contacts(customer_id,name,designation,phone,email,is_primary) VALUES(?,?,?,?,?,1)`);
  const customerRows=[
    ['DEMO-C001','Shree Ganesh Controls Pvt Ltd','SHREEGANESHCONTROLSPVTLTD','27AAECS1234F1Z5','AAECS1234F',750000,30,'14 MIDC Industrial Area, Andheri East','Unit 4, MIDC Industrial Area, Andheri East','Mumbai','Maharashtra','400093','Panel builder and OEM customer','Nilesh Patil','Purchase Manager','9876543210','purchase@shreeganesh.example'],
    ['DEMO-C002','Apex Automation Systems','APEXAUTOMATIONSYSTEMS','27AABCA4321G1Z2','AABCA4321G',500000,45,'Plot 18, Bhosari MIDC','Plot 18, Bhosari MIDC','Pune','Maharashtra','411026','Factory automation integrator','Sneha Kulkarni','Projects Lead','9820012345','projects@apexautomation.example'],
    ['DEMO-C003','Western Process Solutions','WESTERNPROCESSSOLUTIONS','24AACFW2468K1Z7','AACFW2468K',350000,30,'GIDC Makarpura','GIDC Makarpura','Vadodara','Gujarat','390010','Process industry maintenance customer','Rohan Shah','Maintenance Head','9898123456','maintenance@westernprocess.example']
  ];
  const customers=[];
  for(const row of customerRows){const [code,name,normalized,gstin,pan,limit,days,billing,shipping,city,state,pincode,notes,contactName,designation,phone,email]=row;const result=addCustomer.run(code,name,normalized,gstin,pan,limit,days,owner.id,'ACTIVE',billing,shipping,city,state,pincode,notes,owner.id,owner.id);const id=Number(result.lastInsertRowid);addContact.run(id,contactName,designation,phone,email);customers.push(id)}

  const addItem=db.prepare(`INSERT INTO items(part_code,description,brand,hsn,uom,pack_size,alternate_codes,superseded_codes,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const itemRows=[
    ['3RT2026-1AP00','SIRIUS power contactor, 25 A, 11 kW, 230 V AC coil','Siemens','85364900','NOS',1,'["3RT2026"]','[]'],
    ['3RV2021-1KA10','Motor protection circuit breaker, 9–12.5 A','Siemens','85362030','NOS',1,'["3RV2021"]','[]'],
    ['3UG4511-1AW30','Phase monitoring relay, 160–690 V AC','Siemens','85364900','NOS',1,'[]','[]'],
    ['6SL3210-1KE17-5UF1','SINAMICS G120C drive, 7.5 kW','Siemens','85044090','NOS',1,'["G120C-7.5KW"]','[]']
  ];
  const items=itemRows.map(row=>Number(addItem.run(...row,'ACTIVE',owner.id,owner.id).lastInsertRowid));

  const addEnquiry=db.prepare(`INSERT INTO enquiries(enquiry_number,customer_id,subject,source,expected_by,status,assigned_to,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const addEnquiryLine=db.prepare(`INSERT INTO enquiry_lines(enquiry_id,item_id,description,quantity,target_price,position) VALUES(?,?,?,?,?,?)`);
  const e1=Number(addEnquiry.run('DEMO-ENQ-001',customers[0],'MCC panel components','Email',day(10),'QUOTED',owner.id,'Required for a new packaging line.',owner.id,owner.id).lastInsertRowid);
  addEnquiryLine.run(e1,items[0],itemRows[0][1],12,3450,0);addEnquiryLine.run(e1,items[1],itemRows[1][1],12,2250,1);
  const e2=Number(addEnquiry.run('DEMO-ENQ-002',customers[1],'Conveyor drive upgrade','Referral',day(18),'QUALIFIED',owner.id,'Site shutdown planned next month.',owner.id,owner.id).lastInsertRowid);
  addEnquiryLine.run(e2,items[3],itemRows[3][1],3,28500,0);addEnquiryLine.run(e2,items[2],itemRows[2][1],6,4200,1);
  const e3=Number(addEnquiry.run('DEMO-ENQ-003',customers[2],'Pump panel spares','Phone',day(7),'QUOTED',owner.id,'Urgent maintenance requirement.',owner.id,owner.id).lastInsertRowid);
  addEnquiryLine.run(e3,items[0],itemRows[0][1],6,3500,0);addEnquiryLine.run(e3,items[2],itemRows[2][1],3,4400,1);

  const addQuote=db.prepare(`INSERT INTO quotations(quotation_number,enquiry_id,customer_id,valid_until,status,notes,terms,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?)`);
  const addQuoteLine=db.prepare(`INSERT INTO quotation_lines(quotation_id,item_id,description,uom,quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)`);
  const q1=Number(addQuote.run('DEMO-QTN-001',e1,customers[0],day(15),'SENT','Freight extra at actuals.','Delivery within 2–3 weeks. Payment: 30 days.',owner.id,owner.id).lastInsertRowid);
  addQuoteLine.run(q1,items[0],itemRows[0][1],'NOS',12,3650,5,18,0);addQuoteLine.run(q1,items[1],itemRows[1][1],'NOS',12,2450,5,18,1);
  const q2=Number(addQuote.run('DEMO-QTN-002',e3,customers[2],day(12),'ACCEPTED','Customer confirmed by email.','Delivery within 7 working days. Payment: 30 days.',owner.id,owner.id).lastInsertRowid);
  addQuoteLine.run(q2,items[0],itemRows[0][1],'NOS',6,3700,3,18,0);addQuoteLine.run(q2,items[2],itemRows[2][1],'NOS',3,4550,3,18,1);

  [e1,e2,e3].forEach(id=>recordEnquiryRevision(db,id,owner.id,'Initial demo version'));
  [q1,q2].forEach(id=>recordQuotationRevision(db,id,owner.id,'Initial demo version'));

  const order=Number(db.prepare(`INSERT INTO sales_orders(order_number,quotation_id,customer_id,customer_po_number,customer_po_date,promised_date,status,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)`).run('DEMO-SO-001',q2,customers[2],'WPS/PO/2026/184',day(-2),day(8),'PROCESSING','Material allocation in progress.',owner.id,owner.id).lastInsertRowid);
  const addOrderLine=db.prepare(`INSERT INTO sales_order_lines(sales_order_id,item_id,description,uom,ordered_quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)`);
  addOrderLine.run(order,items[0],itemRows[0][1],'NOS',6,3700,3,18,0);addOrderLine.run(order,items[2],itemRows[2][1],'NOS',3,4550,3,18,1);

  writeAudit(db,{userId:owner.id,entity:'DEMO_DATA',recordId:'v1',action:'IMPORT',newValue:{customers:3,items:4,enquiries:3,quotations:2,salesOrders:1}});
  db.exec('COMMIT');
  db.exec('PRAGMA optimize');
  console.log('Demo data loaded: 3 customers, 4 items, 3 enquiries, 2 quotations, 1 sales order.');
}catch(error){db.exec('ROLLBACK');throw error}finally{db.close()}
