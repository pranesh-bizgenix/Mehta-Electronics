export class DecisionRepository {
 constructor(db){this.db=db;}
 async owner(actorId){return this.db.prepare("SELECT id FROM users WHERE id=? AND role='OWNER' AND status='ACTIVE'").get(actorId);}
 async owners(){return (await this.db.prepare("SELECT count(*)::integer AS count FROM users WHERE role='OWNER' AND status='ACTIVE'").get()).count;}
 async lock(key){await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`rule:${key}`);await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`decision:${key}`);}
 async requestLock(key){await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`decision-request:${key}`);}
 async current(key){return this.db.prepare('SELECT d.*,u.name AS entered_by_name,c.name AS confirmed_by_name FROM decision_register d LEFT JOIN users u ON u.id=d.entered_by LEFT JOIN users c ON c.id=d.confirmed_by WHERE decision_key=? ORDER BY version DESC LIMIT 1').get(key);}
 async currentAll(){return this.db.prepare('SELECT DISTINCT ON (decision_key) d.*,u.name AS entered_by_name,c.name AS confirmed_by_name FROM decision_register d LEFT JOIN users u ON u.id=d.entered_by LEFT JOIN users c ON c.id=d.confirmed_by ORDER BY decision_key,version DESC').all();}
 async history(key){return this.db.prepare('SELECT d.*,u.name AS entered_by_name,c.name AS confirmed_by_name FROM decision_register d LEFT JOIN users u ON u.id=d.entered_by LEFT JOIN users c ON c.id=d.confirmed_by WHERE decision_key=? ORDER BY version DESC LIMIT 100').all(key);}
 async legacy(key){return this.db.prepare('SELECT version,value,is_cleared,created_by,created_at FROM business_rule_values WHERE rule_key=? ORDER BY version DESC LIMIT 1').get(key);}
 async external(){return this.db.prepare("SELECT revision AS version,floor_percent::text AS value,coalesce(updated_by,created_by) AS created_by,coalesce(updated_at,created_at) AS created_at FROM crm_quotation_policy WHERE singleton AND status='ACTIVE' AND NOT is_deleted").get();}
 async canonical(d){if(d.decisionOnly)return null;if(d.key==='margin.floor_percent')return this.external();return this.legacy(d.key);}
 async setLegacy(d,value,actor,reason){
  if(d.decisionOnly||d.key==='margin.floor_percent')return null;
  const old=await this.legacy(d.key),version=(old?.version??0)+1;
  await this.db.prepare('INSERT INTO business_rule_values(rule_key,version,value,is_cleared,reason,created_by) VALUES(?,?,?::text::jsonb,?,?,?)').run(d.key,version,value===null?null:JSON.stringify(value),value===null,reason,actor.id);
  return value===null?null:{version,value};
 }
 async knownPermission(key){return Boolean(await this.db.prepare('SELECT key FROM permissions WHERE key=?').get(key));}
 async insert(row){return this.db.prepare(`INSERT INTO decision_register(decision_key,version,area,plain_question,options_json,value_json,evidence_source,status,entered_by,confirmed_by,confirmed_at,reason,blocks_workflows,canonical_version,canonical_hash,request_key,created_by)
 VALUES(?,?,?,?,?::text::jsonb,?::text::jsonb,?,?,?,?,CASE WHEN ? THEN clock_timestamp() ELSE NULL END,?,?::text::jsonb,?,?,?,?) RETURNING *`).get(row.key,row.version,row.area,row.plainQuestion,JSON.stringify(row.options),row.value===null?null:JSON.stringify(row.value),row.evidenceSource,row.status,row.enteredBy,row.status==='CONFIRMED'?row.actor.id:null,row.status==='CONFIRMED',row.reason,JSON.stringify(row.blockedWorkflows),row.canonicalVersion,row.canonicalHash,row.requestKey,row.actor.id);}
 async request(key){return this.db.prepare('SELECT * FROM decision_register_requests WHERE request_key=?').get(key);}
 async saveRequest({key,actorId,hash,operation,response}){await this.db.prepare('INSERT INTO decision_register_requests(request_key,actor_id,request_hash,operation,response_body) VALUES(?,?,?,?,?::text::jsonb)').run(key,actorId,hash,operation,JSON.stringify(response));}
}
