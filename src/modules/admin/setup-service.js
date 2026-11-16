import { forbidden } from '../../core/errors.js';
import { UserAdminRepository } from './user-admin-service.js';
import { eligibleReviewers, provisioningWarnings } from './reviewer-eligibility.js';
import { connectorConnectionState } from '../../connector-store.js';
import {stableCustomerLinkExists} from '../../tally-customer-links.js';
import {stableItemLinkExists} from '../../tally-item-links.js';

export class SetupRepository {
  constructor(db) { this.db=db; }
  async mappings(kind) {
    // Same exact, ambiguity-aware mapping criteria as the CRM list APIs.
    const customer=kind==='customers';
    const linked=customer ? `${stableCustomerLinkExists} OR EXISTS(SELECT 1 FROM crm_customer_tally_facts f WHERE f.customer_id=r.id AND f.match_count=1)
      OR NOT EXISTS(SELECT 1 FROM crm_customer_profiles p WHERE p.customer_id=r.id) AND EXISTS(SELECT 1 FROM crm_parties p WHERE p.customer_id=r.id AND p.status='ACTIVE' AND NOT p.is_deleted AND (SELECT count(*) FROM tally_ledgers l WHERE l.company_id=p.company_id AND l.name=p.name)=1)` :
      `${stableItemLinkExists} OR EXISTS(SELECT 1 FROM crm_item_tally_facts f WHERE f.item_id=r.id AND f.match_count=1)
      OR NOT EXISTS(SELECT 1 FROM crm_item_profiles p WHERE p.item_id=r.id) AND EXISTS(SELECT 1 FROM crm_tally_item_links p WHERE p.item_id=r.id AND p.tally_record_key IS NULL AND p.status='ACTIVE' AND NOT p.is_deleted AND (SELECT count(*) FROM tally_stock_items t WHERE t.company_id=p.company_id AND t.name=p.tally_name)=1)`;
    return this.db.prepare(`SELECT count(*)::integer AS total,count(*) FILTER(WHERE ${linked})::integer AS linked FROM ${customer?'customers':'items'} r WHERE r.status='ACTIVE'`).get();
  }
  async costs() { return this.db.prepare(`SELECT count(*)::integer AS total,count(c.id)::integer AS configured FROM items i LEFT JOIN crm_quotation_costs c ON c.item_id=i.id AND c.status='ACTIVE' AND NOT c.is_deleted WHERE i.status='ACTIVE'`).get(); }
  async policy() { return this.db.prepare("SELECT revision FROM crm_quotation_policy WHERE singleton AND status='ACTIVE' AND NOT is_deleted").get(); }
  async connectors() { return this.db.prepare(`SELECT c.status,c.revoked_at,c.pairing_expires_at,c.last_seen_at,c.last_sync_at,c.expected_company_name,h.tally_available,h.selected_company,h.updated_at AS heartbeat_at FROM tally_connectors c LEFT JOIN tally_connector_heartbeats h ON h.connector_id=c.id WHERE c.revoked_at IS NULL AND c.status<>'revoked'`).all(); }
  async roles() { return this.db.prepare("SELECT key,requires_mfa FROM roles WHERE status='ACTIVE'").all(); }
  async backup() { return this.db.prepare("SELECT new_value,created_at FROM audit_logs WHERE entity='DATABASE_BACKUP' AND action='VERIFIED' ORDER BY id DESC LIMIT 1").get(); }
}

export class SetupService {
  constructor({repository,users,access,rules,clock}) { Object.assign(this,{repository,users,access,rules,clock}); }
  async read(actor) {
    // A grant to another role must never make this Owner-only surface available.
    if(actor?.role!=='OWNER')throw forbidden('Only the Owner can view setup readiness.');
    this.access.require(actor,'users.read');
    const [users,customers,items,costs,policy,connectors,roles,backup,rules]=await Promise.all([
      this.users.list(),this.repository.mappings('customers'),this.repository.mappings('items'),this.repository.costs(),
      this.repository.policy(),this.repository.connectors(),this.repository.roles(),this.repository.backup(),this.rules.list(actor)
    ]);
    const now=this.clock.now(),rows=[];
    const add=(key,label,ready,detail,href,action)=>rows.push({key,label,status:ready?'READY':'NEEDS_ATTENTION',detail,href,action});
    const active=users.filter(u=>u.status==='ACTIVE');
    const staffReady=active.filter(u=>eligibleReviewers([u],{requiresMfa:r=>this.access.requiresMfa(r),can:()=>true},'orders').length);
    add('staff','Staff accounts',active.length>1&&staffReady.length===active.length,`${active.length} active accounts; ${staffReady.length} have completed password setup and required MFA, and are available.`, '/users','Manage staff');
    const coverage=provisioningWarnings(users,this.access),gaps=coverage.workflows.filter(w=>w.makersWithoutReviewer.length);
    const reviewerReady=staffReady.length>1&&coverage.activeOwnerCount>0&&coverage.workflows.some(w=>w.readyReviewerCount>0)&&gaps.length===0;
    add('reviewers','Second reviewer',reviewerReady,gaps.length?`No independent ready reviewer for: ${gaps.map(w=>w.label).join(', ')}.`:reviewerReady?'Current makers have an independent ready reviewer. Record-specific approval checks still apply.':'At least two available, ready staff accounts and independent approval permissions are needed.','/users','Review staff coverage');
    for(const [key,label,value,href] of [['customers','CRM customers linked',customers,'/customers'],['items','CRM items linked',items,'/items']])add(key,label,value.total>0&&value.linked===value.total,`${value.linked} of ${value.total} active CRM records match exactly one imported Tally master.`,href,'Review CRM links');
    const marginConfirmed=rules.some(rule=>rule.key==='margin.floor_percent'&&rule.configured);
    add('policy','Quotation policy',Boolean(policy)&&marginConfirmed,policy?marginConfirmed?`Policy revision ${policy.revision} is configured and its margin decision is confirmed.`:`Policy revision ${policy.revision} is retained, but its current margin decision awaits Owner confirmation. Quotation saving and progression remain blocked.`:'Seller details, letterhead and margin policy are not configured.',policy&&!marginConfirmed?'/decisions?key=margin.floor_percent':'/quotations?tool=policy',policy&&!marginConfirmed?'Review margin decision':'Open quotation policy');
    add('costs','Item costs',costs.total>0&&costs.configured===costs.total,`${costs.configured} of ${costs.total} active CRM items have a recorded cost. Zero is a recorded value; no costs are inferred.`,'/quotations?tool=costs','Manage item costs');
    const missing=rules.filter(r=>!r.configured);
    add('rules','Business rules',rules.length>0&&missing.length===0,missing.length?`${missing.length} of ${rules.length} registered rules are unset: ${missing.map(r=>r.label).join(', ')}.`:`All ${rules.length} registered rules are configured.`,'/rules','Configure business rules');
    const states=connectors.map(c=>({state:connectorConnectionState(c,now.getTime()),companyMatches:Boolean(c.selected_company&&c.selected_company===c.expected_company_name),tallyAvailable:c.tally_available===true}));
    add('connector','Tally connector',states.length>0&&states.every(c=>c.state==='connected'&&c.companyMatches&&c.tallyAvailable),states.length?`${states.length} active connector profiles: ${states.map(c=>`${c.state}${!c.companyMatches?' (expected company not selected)':''}`).join(', ')}. Heartbeat freshness follows the existing 3-minute connection check.`:'No active connector profile is recorded.','/tally/connector','Open connector status');
    const required=active.filter(u=>roles.some(r=>r.key===u.role&&r.requires_mfa));
    const unenrolled=required.filter(u=>!u.mfa_enabled);
    const ownerProtected=roles.some(r=>r.key==='OWNER'&&r.requires_mfa);
    add('mfa','MFA enforcement',this.access.mfaEnabled&&ownerProtected&&required.length>0&&unenrolled.length===0,`Runtime enforcement is ${this.access.mfaEnabled?'ON':'OFF'}; Owner role requirement is ${ownerProtected?'ON':'OFF'}; ${required.length-unenrolled.length} of ${required.length} active accounts in required roles are enrolled.`,'/setup#mfa','Review MFA setup');
    let recorded=null;
    try {recorded=typeof backup?.new_value==='string'?JSON.parse(backup.new_value):backup?.new_value;}catch{/* Malformed metadata cannot establish readiness. */}
    const at=recorded?.database==='mehta_electronics_local'&&recorded?.size>0&&/^[a-f0-9]{64}$/.test(recorded?.sha256??'')?Date.parse(recorded.createdAt):NaN;
    const age=now.getTime()-at,known=Number.isFinite(age)&&age>=0;
    add('backup','Backup age',known&&age<=600000,known?`Last verified backup snapshot: ${new Date(at).toISOString()} (${Math.floor(age/60000)} minutes ago). Production migrations require a verified file within 10 minutes.`:'No valid verified backup receipt is recorded in the database. Older filesystem-only backups are not inferred.','/setup#backup','Open backup instructions');
    return {checkedAt:now.toISOString(),readyCount:rows.filter(r=>r.status==='READY').length,total:rows.length,rows};
  }
}

export class SetupController {
  constructor({setup}) {this.setup=setup;}
  routes() {return [{method:'GET',path:'/api/v1/setup',permission:'users.read',handler:async({user})=>({data:await this.setup.read(user)})}];}
}
