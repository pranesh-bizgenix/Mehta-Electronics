import {conflict} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
export async function requireNoSplitWinner(db,rfqId){
 const plan=await db.prepare("SELECT id FROM sourcing_awards WHERE rfq_id=? AND status IN ('PENDING_APPROVAL','APPROVED','ORDERED')").get(rfqId);
 if(plan)throw conflict('Resolve the active split award before selecting an ordinary RFQ winner.');
}
export async function requireEditableSplitReply(db,rfqId){
 const plan=await db.prepare("SELECT id FROM sourcing_awards WHERE rfq_id=? AND status IN ('APPROVED','ORDERED')").get(rfqId);
 if(plan)throw conflict('Approved split offer sources are frozen. Cancel the affected orders and award before replacing an offer.');
}
export async function splitPoSource(db,po){
 if(!po.split_award_id)return null;
 const plan=await db.prepare('SELECT a.id,a.status,a.version,a.snapshot,u.role,u.status AS reviewer_status,r.status AS role_status FROM sourcing_awards a LEFT JOIN users u ON u.id=a.approved_by LEFT JOIN roles r ON r.key=u.role WHERE a.id=?').get(po.split_award_id);
 const group=plan?.snapshot.preview.groups.find(g=>g.vendorId===po.vendor_id);
 return {version:plan?.version??null,lines:group?.totals.lines||[],flags:!plan||plan.status!=='ORDERED'||plan.reviewer_status!=='ACTIVE'||plan.role_status!=='ACTIVE'||!hasPermission(plan,'purchasing.approve')||!group||group.replyId!==po.payload.sourceReply?.id?['SPLIT_AWARD_SOURCE_CHANGED']:[]};
}
