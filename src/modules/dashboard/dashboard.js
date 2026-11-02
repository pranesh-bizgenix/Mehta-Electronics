import { s } from '../../core/schema.js';
import { validationFailed } from '../../core/errors.js';

const OPEN_QUOTE = "('DRAFT','PENDING_APPROVAL','APPROVED','SENT')";
const LINE_TOTAL = 'l.ordered_quantity*l.unit_price*(1-l.discount_percent/100)*(1+l.tax_percent/100)';

/** @interface DashboardRepository — read-only aggregates for the owner dashboard. */
export class DashboardRepository {
  constructor(db) { this.db = db; }
  async openEnquiries() { return Number((await this.db.prepare("SELECT count(*) AS n FROM enquiries WHERE status IN ('NEW','QUALIFIED','QUOTED')").get()).n); }
  async quotesAwaitingApproval() { return Number((await this.db.prepare("SELECT count(*) AS n FROM crm_quotation_workflows WHERE status='PENDING_APPROVAL'").get()).n); }
  async pipelineValue() { return (await this.db.prepare(`SELECT COALESCE(sum((public_snapshot->>'total')::numeric),0)::text AS v, count(*) AS n FROM crm_quotation_workflows WHERE status IN ${OPEN_QUOTE}`).get()); }
  async orderBook() {
    return (await this.db.prepare(`SELECT COALESCE(round(sum(${LINE_TOTAL}),2),0)::text AS v, count(DISTINCT o.id) AS n FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id AND NOT l.is_deleted
      LEFT JOIN crm_order_workflows w ON w.sales_order_id=o.id WHERE COALESCE(w.status,o.status) NOT IN ('DELIVERED','COMPLETED','CANCELLED')`).get());
  }
  async slaBreaches(userId) {
    return Number((await this.db.prepare(`SELECT count(*) AS n FROM work_items WHERE sla_state='BREACHED' AND status IN ('OPEN','IN_PROGRESS','WAITING') AND NOT is_deleted AND (?::integer IS NULL OR owner_user_id=? OR escalated_to_user_id=?)`).get(userId, userId, userId)).n);
  }
  async openExceptions() { return Number((await this.db.prepare("SELECT count(*) AS n FROM exception_cases WHERE status='OPEN'").get()).n); }
  async operationCounts(kinds) {
    return this.db.prepare("SELECT kind,count(*) AS n FROM crm_operations WHERE kind=ANY(?::text[]) AND closed_at IS NULL GROUP BY kind").all(kinds);
  }
  async operationDecisions(kinds,actorId) {
    return this.db.prepare("SELECT id,kind,reference,title,updated_at FROM crm_operations WHERE kind=ANY(?::text[]) AND status='PENDING_APPROVAL' AND created_by<>? ORDER BY updated_at LIMIT 10").all(kinds,actorId);
  }

  async decisionExceptions(limit) {
    return this.db.prepare("SELECT c.id,c.summary,c.exception_type,c.created_at,u.name AS raised_by,c.raised_by AS raised_by_id FROM exception_cases c JOIN users u ON u.id=c.raised_by WHERE c.status='OPEN' ORDER BY c.created_at LIMIT ?").all(limit);
  }
  async decisionQuotes(limit) {
    return this.db.prepare(`SELECT w.quotation_id AS id,w.public_snapshot->>'quotation_number' AS number,w.public_snapshot->>'customer_name' AS customer,(w.public_snapshot->>'total') AS total,w.updated_at,w.created_by
      FROM crm_quotation_workflows w WHERE w.status='PENDING_APPROVAL' ORDER BY w.updated_at LIMIT ?`).all(limit);
  }
  async decisionOrders(limit) {
    return this.db.prepare(`SELECT w.sales_order_id AS id,w.public_snapshot->>'order_number' AS number,c.name AS customer,w.updated_at FROM crm_order_workflows w JOIN customers c ON c.id=w.customer_id WHERE w.status='HELD' ORDER BY w.updated_at LIMIT ?`).all(limit);
  }
  async decisionDrafts(limit) {
    return this.db.prepare("SELECT d.id,d.subject,c.name AS customer,d.created_at FROM email_drafts d LEFT JOIN customers c ON c.id=d.customer_id WHERE d.status='DRAFT' ORDER BY d.created_at LIMIT ?").all(limit);
  }

  async funnel(from, to) {
    return this.db.prepare(`SELECT
      (SELECT count(*) FROM enquiries WHERE created_at::date BETWEEN ?::date AND ?::date) AS enquiries,
      (SELECT count(*) FROM quotations WHERE created_at::date BETWEEN ?::date AND ?::date) AS quoted,
      (SELECT count(*) FROM crm_quotation_workflows w JOIN quotations q ON q.id=w.quotation_id WHERE q.created_at::date BETWEEN ?::date AND ?::date AND w.status IN ('APPROVED','SENT','WON')) AS approved,
      (SELECT count(*) FROM crm_quotation_workflows w JOIN quotations q ON q.id=w.quotation_id WHERE q.created_at::date BETWEEN ?::date AND ?::date AND w.status='WON') AS won`).get(from, to, from, to, from, to, from, to);
  }
  async monthlyQuotes(months) {
    return this.db.prepare(`WITH m AS (SELECT generate_series(date_trunc('month', now()) - (?::integer - 1) * interval '1 month', date_trunc('month', now()), interval '1 month') AS month)
      SELECT to_char(m.month,'Mon') AS label,
        (SELECT count(*) FROM quotations q WHERE date_trunc('month',q.created_at)=m.month) AS created,
        (SELECT count(*) FROM crm_quotation_events e WHERE e.action='WON' AND date_trunc('month',e.created_at)=m.month) AS won
      FROM m ORDER BY m.month`).all(months);
  }
  async sla(from, to) {
    return this.db.prepare(`SELECT count(*) FILTER (WHERE sla_state='MET') AS met, count(*) FILTER (WHERE sla_state='BREACHED') AS breached,
      count(*) FILTER (WHERE sla_state='RUNNING') AS running, count(*) FILTER (WHERE sla_state='NOT_CONFIGURED') AS not_configured
      FROM work_items WHERE NOT is_deleted AND started_at::date BETWEEN ?::date AND ?::date`).get(from, to);
  }
  async margin(from, to) {
    return this.db.prepare(`SELECT count(*) AS approvals, count(*) FILTER (WHERE (private_detail->>'overrideFloor')::boolean) AS below_floor
      FROM crm_quotation_events WHERE action='APPROVE' AND created_at::date BETWEEN ?::date AND ?::date`).get(from, to);
  }
  async activity(limit) {
    return this.db.prepare('SELECT a.id,a.entity,a.record_id,a.action,a.reason,a.created_at,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC,a.id DESC LIMIT ?').all(limit);
  }
}

/**
 * Owner dashboard. Each section is included only when the user may see the
 * underlying records; money and margin follow the same rules as the lists.
 */
export class DashboardService {
  constructor({ repository, access }) { this.repository = repository; this.access = access; }

  async summary(user, { from, to }) {
    this.access.require(user, 'dashboard.read');
    if (from > to) throw validationFailed('The period start must be before its end.');
    const can = (p) => this.access.can(user, p);
    const r = this.repository;
    const kpis = {};
    if (can('enquiries.read')) kpis.openEnquiries = await r.openEnquiries();
    if (can('quotations.read')) { kpis.quotesAwaitingApproval = await r.quotesAwaitingApproval(); const p = await r.pipelineValue(); kpis.pipeline = { value: p.v, count: Number(p.n) }; }
    if (can('orders.read')) { const o = await r.orderBook(); kpis.orderBook = { value: o.v, count: Number(o.n) }; }
    if (can('work.read')) kpis.slaBreaches = await r.slaBreaches(can('work.reassign') ? null : user.id);
    if (can('exceptions.read')) kpis.openExceptions = await r.openExceptions();
    const financial=['OWNER','ACCOUNTS'].includes(user.role);
    const readableKinds=[...(can('operations.read')?['SUPPORT','WARRANTY','RETURN','INTAKE']:[]),...(financial&&can('collections.read')?['COLLECTION','RECEIPT','PAYMENT']:[])];
    if(readableKinds.length)kpis.operations=Object.fromEntries((await r.operationCounts(readableKinds)).map(row=>[row.kind,Number(row.n)]));

    const decisions = [];
    const reviewKinds=[...(can('operations.approve')?['WARRANTY','RETURN']:[]),...(financial&&can('collections.approve')?['RECEIPT','PAYMENT']:[])];
    if(reviewKinds.length)for(const item of await r.operationDecisions(reviewKinds,user.id))decisions.push({kind:'operation',id:item.id,title:`Review ${item.reference}`,subtitle:item.title,at:item.updated_at,href:`/operations?kind=${item.kind}&open=${item.id}`});
    if (can('exceptions.decide')) for (const e of await r.decisionExceptions(5)) if (e.raised_by_id !== user.id) decisions.push({ kind: 'exception', id: e.id, title: e.summary, subtitle: `${e.exception_type.replace(/_/g, ' ').toLowerCase()} · raised by ${e.raised_by}`, at: e.created_at, href: '/exceptions' });
    if (can('quotations.approve')) for (const q of await r.decisionQuotes(5)) if (q.created_by !== user.id) decisions.push({ kind: 'quotation', id: String(q.id), title: `Approve ${q.number ?? 'quotation'}`, subtitle: q.customer, amount: q.total, at: q.updated_at, href: `/quotations/${q.id}` });
    if (can('orders.review')) for (const o of await r.decisionOrders(5)) decisions.push({ kind: 'order', id: String(o.id), title: `Review held order ${o.number ?? ''}`.trim(), subtitle: o.customer, at: o.updated_at, href: `/orders?open=${o.id}` });
    if (can('outbound.approve')) for (const d of await r.decisionDrafts(5)) decisions.push({ kind: 'draft', id: d.id, title: `Approve email: ${d.subject}`, subtitle: d.customer, at: d.created_at, href: '/messages' });
    decisions.sort((a, b) => new Date(a.at) - new Date(b.at));

    const out = { period: { from, to }, kpis, decisions };
    if (can('enquiries.read') && can('quotations.read')) {
      const f = await r.funnel(from, to);
      out.funnel = [{ label: 'Enquiries', value: Number(f.enquiries) }, { label: 'Quoted', value: Number(f.quoted) }, { label: 'Approved / sent', value: Number(f.approved) }, { label: 'Won', value: Number(f.won) }];
      out.quoteTrend = (await r.monthlyQuotes(6)).map((m) => ({ label: m.label, created: Number(m.created), won: Number(m.won) }));
    }
    if (can('work.read')) { const s = await r.sla(from, to); out.sla = { met: Number(s.met), breached: Number(s.breached), running: Number(s.running), notConfigured: Number(s.not_configured) }; }
    if (can('quotations.cost.read')) { const m = await r.margin(from, to); out.margin = { approvals: Number(m.approvals), belowFloor: Number(m.below_floor) }; }
    if (can('audit.read')) out.activity = (await r.activity(8)).map((a) => ({ id: Number(a.id), module: a.entity, recordId: a.record_id, action: a.action, reason: a.reason, at: a.created_at, user: a.user_name }));
    return out;
  }
}

export class DashboardController {
  constructor({ dashboard }) { this.dashboard = dashboard; }
  routes() {
    return [{
      method: 'GET', path: '/api/v1/dashboard/summary', permission: 'dashboard.read',
      query: s.object({ from: s.date(), to: s.date() }),
      handler: async ({ user, query }) => ({ data: await this.dashboard.summary(user, query) })
    }];
  }
}
