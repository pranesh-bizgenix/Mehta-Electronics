import { s } from '../../core/schema.js';
import { conflict } from '../../core/errors.js';
import { quotePolicy, saveQuotePolicy } from '../../quotation-workflow.js';

/**
 * Adapter: the margin floor already lives in the owner's quotation policy
 * (crm_quotation_policy, versioned by `revision` with its own event history).
 * The Rules screen reads and writes it through this source instead of keeping
 * a second copy.
 *
 * @implements {ExternalRuleSource} { read(): {value,version,updatedAt}|null; write(actor,value,reason) }
 */
export class QuotationPolicyFloorSource {
  constructor({ db }) { this.db = db; }
  async read() {
    const policy = await quotePolicy(this.db);
    return policy ? { value: policy.floor_percent, version: policy.revision, updatedAt: policy.updated_at ?? policy.created_at } : null;
  }
  async write(actor, value, reason) {
    const policy = await quotePolicy(this.db);
    if (!policy) throw conflict('Set the quotation policy (seller state and letterhead) in Quotations first; the margin floor is part of it.', 'POLICY_NOT_CONFIGURED');
    const saved = await saveQuotePolicy(this.db, { floorPercent: value, marginBasis: policy.margin_basis, sellerState: policy.seller_state, letterhead: policy.letterhead, reason }, actor);
    return { value: saved.floor_percent, version: saved.revision };
  }
}

export const marginFloorDefinition = (source) => ({
  key: 'margin.floor_percent', group: 'Pricing', label: 'Margin floor (gross margin %)',
  description: 'Quotations and orders below this margin need an approved exception. Stored in the quotation policy.',
  dependents: ['Quotation creation', 'Quotation approval', 'Order verification'],
  schema: s.decimal({ min: 0, max: 100 }),
  source
});
