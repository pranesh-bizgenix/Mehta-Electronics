import {tallyFixture} from './tally-fixture.js';
import {transaction} from '../src/crm-modules.js';
import {fingerprint} from '../src/core/runtime.js';
export async function writeFixture(db){
  const f=await tallyFixture(db,'ZZTEST_Write Company');
  await db.sql`UPDATE tally_companies SET tally_guid='ZZTEST_write_company_guid' WHERE id=${f.company}`;
  const actors=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES
    ('ZZTEST_write_maker','ZZTEST_write_maker@example.test','OWNER','not-a-login',0),
    ('ZZTEST_write_checker','ZZTEST_write_checker@example.test','OWNER','not-a-login',0) RETURNING id,role`;
  const sourceId='ZZTEST_'+crypto.randomUUID(),unitFields={'/stored/tally_guid':'ZZTEST_unit_guid'};
  await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,raw_record,fields,content_hash,observed_at) VALUES(${sourceId},${f.company},'units','ZZTEST_unit',${f.session},'NOS','{}',${db.sql.json(unitFields)},${fingerprint(unitFields)},clock_timestamp())`;
  let mapping;
  await transaction(db,actors[0],'ZZTEST write mapping fixture',async()=>{
    [mapping]=await db.sql`INSERT INTO tw_mapping_versions(company_id,category,version,configuration,configuration_hash,status,created_by,reason)
      VALUES(${f.company},'SALES_ORDER',1,'{}',${fingerprint({})},'DRAFT',${actors[0].id},'ZZTEST empty mapping review') RETURNING id`;
  });
  return {...f,maker:actors[0],checker:actors[1],mapping:mapping.id};
}
export async function insertWriteJob(db,f,overrides={}){
  const values={category:'SALES_ORDER',entity_type:'SALES_ORDER',entity_id:'ZZTEST_1',entity_version_hash:'a'.repeat(64),company_id:f.company,
    mapping_id:f.mapping,config_revision:1,control_revision:1,snapshot:{},payload_xml:'<ENVELOPE/>',validation_report:{},
    idempotency_key:'b'.repeat(64),request_hash:'c'.repeat(64),created_by:f.maker.id,business_maker_id:f.maker.id,reason:'ZZTEST queued write fixture',...overrides};
  const keys=Object.keys(values),params=keys.map((key,i)=>`$${i+1}${typeof values[key]==='object'&&values[key]!==null?'::text::jsonb':''}`);
  return (await db.sql.unsafe(`INSERT INTO tw_outbox(${keys.join(',')}) VALUES(${params.join(',')}) RETURNING *`,Object.values(values).map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v)))[0];
}
