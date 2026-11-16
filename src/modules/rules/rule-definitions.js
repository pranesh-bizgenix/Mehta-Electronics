import { s } from '../../core/schema.js';

// Rule definitions describe WHAT can be configured; values are entered by the
// owner in the Rules screen and start empty. No business value is hard-coded.
// Later slices register more definitions with registry.register(...).

const minutes = (max = 60 * 24 * 60) => s.int({ min: 1, max });
const percent = () => s.string({pattern:/^(?:\d{1,2}(?:\.\d{1,6})?|100(?:\.0{1,6})?)$/});
const weekday = s.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const hhmm = s.string({ pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });

export const F1_RULES = [
  {
    key: 'sla.policy', group: 'SLA and escalation', label: 'SLA policy (TAT, timezone, business hours)',
    description: 'Turnaround time per record type, measured in business minutes. Records created while this is empty show "SLA not configured" and are never escalated.',
    dependents: ['SLA clock on every owned record', 'Escalation'],
    schema: s.object({
      timezone: s.string({ min: 3, max: 60, pattern: /^[A-Za-z_]+\/[A-Za-z_]+$/ }),
      businessDays: s.array(weekday, { min: 1, max: 7 }),
      businessHours: s.object({ start: hhmm, end: hhmm }),
      holidays: s.array(s.date(), { max: 400 }).default(() => []),
      turnaroundMinutes: s.object({}, { strict: false })
    }),
    validate(value) {
      const tat = value.turnaroundMinutes;
      for (const [entity, mins] of Object.entries(tat)) {
        if (!/^[A-Z][A-Z_]+$/.test(entity) || !Number.isSafeInteger(mins) || mins < 1 || mins > 525600) return `turnaroundMinutes.${entity} must be whole minutes between 1 and 525600`;
      }
      if (!Object.keys(tat).length) return 'turnaroundMinutes needs at least one record type';
      if (value.businessHours.start >= value.businessHours.end) return 'businessHours.start must be before businessHours.end';
      try { new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }); } catch { return 'timezone is not a recognised IANA zone'; }
      return null;
    }
  },
  {
    key: 'escalation.policy', group: 'SLA and escalation', label: 'Escalation timing',
    description: 'Minutes after the due time before an overdue record escalates from the owner to the backup, and from the backup to the manager.',
    dependents: ['Escalation job'],
    schema: s.object({ toBackupAfterMinutes: minutes(), toManagerAfterMinutes: minutes() }),
    validate: (v) => v.toManagerAfterMinutes <= v.toBackupAfterMinutes ? 'toManagerAfterMinutes must be later than toBackupAfterMinutes' : null
  },
  {
    key: 'tasks.reminder_interval_minutes', group: 'Tasks and reminders', label: 'Task reminder interval',
    description: 'How often an open task reminds its owner until it is done.',
    dependents: ['Task reminders'], schema: minutes(7 * 24 * 60)
  },
  {
    key: 'discount.levels', group: 'Pricing', label: 'Discount levels 1 to 3',
    description: 'Discount ranges (percent). Level 3 always needs approval. Quotations cannot be sent while this is empty.',
    dependents: ['Quotation discount check', 'Quotation send'],
    schema: s.object({
      level1: s.object({ min: percent(), max: percent() }),
      level2: s.object({ min: percent(), max: percent() }),
      level3: s.object({ min: percent(), max: percent() })
    }),
    validate(v) {
      const n = (x) => {const [a,b='']=x.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
      for (const level of ['level1', 'level2', 'level3']) if (n(v[level].min) > n(v[level].max)) return `${level}.min must not exceed ${level}.max`;
      if (n(v.level1.max) >= n(v.level2.min) || n(v.level2.max) >= n(v.level3.min)) return 'Inclusive discount bands must not overlap, including their endpoints, and must increase from level 1 to level 3';
      return null;
    }
  },
  {
    key: 'quotation.approval_levels', group: 'Pricing', label: 'Quotation approval levels',
    description: 'Who must approve which quotations. The client has two conflicting statements (Level 2 manager / Level 3 director vs only Level 3); this stays empty until decided.',
    dependents: ['Quotation submission and approval'],
    schema: s.array(s.object({ name: s.string({ min: 1, max: 60 }), permission: s.string({ min: 3, max: 80 }), appliesTo: s.enum(['DISCOUNT_LEVEL_2', 'DISCOUNT_LEVEL_3', 'BELOW_MARGIN_FLOOR', 'ALL']), sequence:s.int({min:1,max:1000}).optional() }), { min: 1, max: 5 }),
    validate(value) {
      if(new Set(value.map(row=>row.name.normalize('NFKC').toLowerCase())).size!==value.length)return 'Approval stage names must be unique';
      const sequence=value.filter(row=>row.sequence!==undefined).map(row=>row.sequence);
      return new Set(sequence).size===sequence.length?null:'Explicit approval sequence numbers must be unique';
    }
  },
  {
    key:'quotation.approval_reviewer_policy',group:'Pricing',label:'Reviewer reuse for staged quotation approval',
    description:'Confirm whether the same eligible independent employee may complete more than one stage. Multiple matching stages require this decision and explicit sequence numbers; no role hierarchy or reviewer reuse is assumed.',
    dependents:['Quotations requiring multiple approval stages'],
    shape:'{ "reuse": "DISTINCT_REVIEWERS" | "ALLOW_REUSE", "instructions": confirmed text }',
    schema:s.object({reuse:s.enum(['DISTINCT_REVIEWERS','ALLOW_REUSE']),instructions:s.reason()})
  },
  {
    key: 'credit.default_limit_new_customer', group: 'Credit', label: 'Default credit limit for new customers (INR)',
    description: 'Credit limit applied when a new customer is onboarded without an explicit limit. While empty, onboarding requires an explicit limit.',
    dependents: ['Customer onboarding'], schema: s.decimal({ min: 0 })
  },
  {
    key: 'customers.potential_threshold', group: 'Customers', label: 'Potential-customer threshold',
    description: 'Classifies a customer as potential from purchase history. What is counted and over what period is pending with the client (A-06).',
    dependents: ['Customer routing state'],
    schema: s.object({ metric: s.enum(['ORDER_COUNT', 'INVOICE_COUNT']), threshold: s.int({ min: 1, max: 100000 }), periodDays: s.int({ min: 1, max: 3650 }) })
  },
  {
    key: 'audit.retention_days', group: 'Controls', label: 'Audit retention period (days)',
    description: 'How long audit records must be kept. Audit records are never deleted by the system; this records the client decision (A-23).',
    dependents: ['Audit archival (not automated)'], schema: s.int({ min: 1, max: 36500 })
  }
];

export class RuleRegistry {
  constructor(definitions = []) { this.definitions = new Map(); for (const d of definitions) this.register(d); }
  register(definition) {
    if (this.definitions.has(definition.key)) throw new Error(`Rule ${definition.key} is already registered.`);
    this.definitions.set(definition.key, definition);
    return this;
  }
  get(key) { return this.definitions.get(key); }
  all() { return [...this.definitions.values()]; }
}
