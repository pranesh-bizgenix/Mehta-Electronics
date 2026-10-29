// Keeps work items in step with existing business records without changing
// their modules: open enquiries, quotations and orders get an owned work item,
// and items whose record has closed are closed. Runs as a scheduler job.

const SOURCES = [
  {
    entityType: 'ENQUIRY', department: 'SALES',
    open: `SELECT e.id::text AS entity_id,e.enquiry_number||' · '||e.subject AS title,COALESCE(e.assigned_to,e.created_by) AS owner_id,e.created_at
      FROM enquiries e WHERE e.status IN ('NEW','QUALIFIED','QUOTED') AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.entity_type='ENQUIRY' AND w.entity_id=e.id::text) LIMIT 500`,
    closed: `SELECT w.id FROM work_items w JOIN enquiries e ON w.entity_type='ENQUIRY' AND w.entity_id=e.id::text
      WHERE w.status IN ('OPEN','IN_PROGRESS','WAITING') AND e.status IN ('WON','LOST','CANCELLED') LIMIT 500`
  },
  {
    entityType: 'QUOTATION', department: 'SALES',
    open: `SELECT q.id::text AS entity_id,q.quotation_number AS title,q.created_by AS owner_id,q.created_at
      FROM quotations q LEFT JOIN crm_quotation_workflows w2 ON w2.quotation_id=q.id
      WHERE COALESCE(w2.status,q.status) IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT')
        AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.entity_type='QUOTATION' AND w.entity_id=q.id::text) LIMIT 500`,
    closed: `SELECT w.id FROM work_items w JOIN quotations q ON w.entity_type='QUOTATION' AND w.entity_id=q.id::text LEFT JOIN crm_quotation_workflows w2 ON w2.quotation_id=q.id
      WHERE w.status IN ('OPEN','IN_PROGRESS','WAITING') AND COALESCE(w2.status,q.status) IN ('WON','LOST','EXPIRED','CANCELLED','ACCEPTED','REJECTED') LIMIT 500`
  },
  {
    entityType: 'SALES_ORDER', department: 'OPERATIONS',
    open: `SELECT o.id::text AS entity_id,o.order_number AS title,o.created_by AS owner_id,o.created_at
      FROM sales_orders o LEFT JOIN crm_order_workflows ow ON ow.sales_order_id=o.id WHERE COALESCE(ow.status,o.status) NOT IN ('DELIVERED','COMPLETED','CANCELLED')
        AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.entity_type='SALES_ORDER' AND w.entity_id=o.id::text) LIMIT 500`,
    closed: `SELECT w.id FROM work_items w JOIN sales_orders o ON w.entity_type='SALES_ORDER' AND w.entity_id=o.id::text LEFT JOIN crm_order_workflows ow ON ow.sales_order_id=o.id
      WHERE w.status IN ('OPEN','IN_PROGRESS','WAITING') AND COALESCE(ow.status,o.status) IN ('DELIVERED','COMPLETED','CANCELLED') LIMIT 500`
  }
];

export class RecordSyncRepository {
  constructor(db) { this.db = db; }
  async unregistered(source) { return this.db.prepare(source.open).all(); }
  async closedButOpen(source) { return this.db.prepare(source.closed).all(); }
}

export class RecordSyncJob {
  constructor({ repository, work, intervalMs = 60_000 }) {
    this.repository = repository; this.work = work; this.intervalMs = intervalMs;
    this.name = 'work_record_sync';
  }
  async run() {
    let opened = 0, closed = 0;
    for (const source of SOURCES) {
      for (const row of await this.repository.unregistered(source)) {
        await this.work.open(null, { entityType: source.entityType, entityId: row.entity_id, title: row.title, department: source.department, ownerUserId: row.owner_id, assignmentReason: 'Registered from existing record', startedAt: row.created_at });
        opened++;
      }
      for (const row of await this.repository.closedButOpen(source)) {
        await this.work.setStatus({ id: null, __system: true }, row.id, 'DONE', 'Record closed');
        closed++;
      }
    }
    return { opened, closed };
  }
}
