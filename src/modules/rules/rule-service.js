import { forbidden,notFound, ruleNotConfigured, validationFailed } from '../../core/errors.js';
import { s,validate } from '../../core/schema.js';
import {DecisionService} from '../decisions/service.js';

/**
 * Versioned, audited business rules. Every change appends a new version;
 * clearing a rule appends an empty version so it blocks again.
 */
export class RuleService {
  constructor({ registry, repository, transactions, audit, access }) {
    Object.assign(this, { registry, repository, transactions, audit, access });
    this.decisions=new DecisionService({db:repository.db,registry,transactions,audit,access});
  }

  async list(user) {
    this.access.require(user, 'rules.read');
    const current = new Map((await this.repository.currentAll()).map((r) => [r.rule_key, r]));
    const out = [];
    for (const d of this.registry.all()) {
      const base = { key: d.key, label: d.label, group: d.group, description: d.description, dependents: d.dependents, shape:d.shape??null,external: Boolean(d.source) };
      if (d.source) {
        const ext = await d.source.read();
        const usable=await this.decisions.getSetting(d.key);
        out.push({ ...base, configured: Boolean(usable), value: usable?.value ?? null, version: ext?.version ?? 0, updatedAt: ext?.updatedAt ?? null, updatedBy: null, reason: null });
        continue;
      }
      const row = current.get(d.key);
      const usable=await this.decisions.getSetting(d.key);
      const configured = Boolean(usable && row && !row.is_cleared && this.valid(d,row.value));
      out.push({
        ...base, configured, value: configured ? row.value : null, version: row?.version ?? 0,
        updatedAt: row?.created_at ?? null, updatedBy: row?.created_by_name ?? null, reason: row?.reason ?? null
      });
    }
    return out;
  }

  async history(user, key) {
    this.access.require(user, 'rules.read');
    if (!this.registry.get(key)) throw notFound('Rule not found.');
    return (await this.repository.history(key)).map((r) => ({ version: r.version, value: r.is_cleared ? null : r.value, cleared: r.is_cleared, reason: r.reason, at: r.created_at, by: r.created_by_name }));
  }

  /** Current value (with version) or null when unset. */
  valid(definition,value){try{const parsed=validate(definition.schema,value);return !definition.validate?.(parsed);}catch{return false;}}
  async get(key) {
    const definition = this.registry.get(key);
    if (!definition) throw new Error(`Unknown rule ${key}.`);
    const row=await this.decisions.getSetting(key);
    return row&&this.valid(definition,row.value)?{value:row.value,version:row.version}:null;
  }

  /** Current value or a RULE_NOT_CONFIGURED error that blocks the caller's workflow. */
  async require(key) {
    const rule = await this.get(key);
    if (!rule) {const d=this.registry.get(key);throw ruleNotConfigured(key,`${d.label} — blocks: ${d.dependents.join(', ')}`);}
    return rule;
  }

  async set(actor, key, rawValue, reason) {
    if(actor?.role!=='OWNER')throw forbidden('Only the Owner may confirm business rules.');
    this.access.require(actor, 'rules.manage');
    reason=validate(s.reason(),reason,'reason');
    const definition = this.registry.get(key);
    if (!definition) throw notFound('Rule not found.');
    const value = this.decisions.catalog.validate(definition,rawValue);
    const problem = definition.validate?.(value);
    if (problem) throw validationFailed(`${definition.label}: ${problem}.`, { rule: key });
    if(key==='quotation.approval_levels')for(const level of value)if(!await this.repository.knownPermission(level.permission))throw validationFailed('Approval levels must use existing permission keys.',{rule:key});
    if (definition.source) {
      const saved = await definition.source.write(actor, value, reason);
      return { key, version: saved.version, configured: true, value: saved.value };
    }
    return this.#append(actor, key, { value, cleared: false }, reason);
  }

  async clear(actor, key, reason) {
    if(actor?.role!=='OWNER')throw forbidden('Only the Owner may clear business rules.');
    this.access.require(actor, 'rules.manage');
    reason=validate(s.reason(),reason,'reason');
    const definition = this.registry.get(key);
    if (!definition) throw notFound('Rule not found.');
    if (definition.source) throw validationFailed(`${definition.label} is part of another policy and cannot be cleared here.`);
    return this.#append(actor, key, { value: null, cleared: true }, reason);
  }

  async #append(actor, key, { value, cleared }, reason) {
    return this.transactions.run(actor, reason, async () => {
      await this.repository.lock(key);
      const before = await this.repository.current(key);
      const version = (before?.version ?? 0) + 1;
      await this.repository.insert({ key, version, value, cleared, reason, actorId: actor.id });
      if(cleared)await this.decisions.clearLegacy(actor,key,reason);
      else await this.decisions.confirmLegacy(actor,key,value,reason);
      await this.audit.record({ actorId: actor.id, entity: 'RULE', recordId: key, action: cleared ? 'CLEAR' : 'SET', oldValue: before && !before.is_cleared ? { version: before.version, value: before.value } : null, newValue: cleared ? { version } : { version, value }, reason });
      return { key, version, configured: !cleared, value: cleared ? null : value };
    });
  }
}
