import { notFound, ruleNotConfigured, validationFailed } from '../../core/errors.js';
import { validate } from '../../core/schema.js';

/**
 * Versioned, audited business rules. Every change appends a new version;
 * clearing a rule appends an empty version so it blocks again.
 */
export class RuleService {
  constructor({ registry, repository, transactions, audit, access }) {
    Object.assign(this, { registry, repository, transactions, audit, access });
  }

  async list(user) {
    this.access.require(user, 'rules.read');
    const current = new Map((await this.repository.currentAll()).map((r) => [r.rule_key, r]));
    const out = [];
    for (const d of this.registry.all()) {
      const base = { key: d.key, label: d.label, group: d.group, description: d.description, dependents: d.dependents, external: Boolean(d.source) };
      if (d.source) {
        const ext = await d.source.read();
        out.push({ ...base, configured: Boolean(ext), value: ext?.value ?? null, version: ext?.version ?? 0, updatedAt: ext?.updatedAt ?? null, updatedBy: null, reason: null });
        continue;
      }
      const row = current.get(d.key);
      const configured = Boolean(row && !row.is_cleared);
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
  async get(key) {
    const definition = this.registry.get(key);
    if (!definition) throw new Error(`Unknown rule ${key}.`);
    if (definition.source) return definition.source.read();
    const row = await this.repository.current(key);
    return row && !row.is_cleared ? { value: row.value, version: row.version } : null;
  }

  /** Current value or a RULE_NOT_CONFIGURED error that blocks the caller's workflow. */
  async require(key) {
    const rule = await this.get(key);
    if (!rule) throw ruleNotConfigured(key, this.registry.get(key).label);
    return rule;
  }

  async set(actor, key, rawValue, reason) {
    this.access.require(actor, 'rules.manage');
    const definition = this.registry.get(key);
    if (!definition) throw notFound('Rule not found.');
    const value = validate(definition.schema, rawValue, definition.label);
    const problem = definition.validate?.(value);
    if (problem) throw validationFailed(`${definition.label}: ${problem}.`, { rule: key });
    if (definition.source) {
      const saved = await definition.source.write(actor, value, reason);
      return { key, version: saved.version, configured: true, value: saved.value };
    }
    return this.#append(actor, key, { value, cleared: false }, reason);
  }

  async clear(actor, key, reason) {
    this.access.require(actor, 'rules.manage');
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
      await this.audit.record({ actorId: actor.id, entity: 'RULE', recordId: key, action: cleared ? 'CLEAR' : 'SET', oldValue: before && !before.is_cleared ? { version: before.version, value: before.value } : null, newValue: cleared ? { version } : { version, value }, reason });
      return { key, version, configured: !cleared, value: cleared ? null : value };
    });
  }
}
