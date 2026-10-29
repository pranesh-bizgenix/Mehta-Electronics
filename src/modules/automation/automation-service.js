import { forbidden, notFound } from '../../core/errors.js';
import { s } from '../../core/schema.js';

export class AutomationRepository {
  constructor(db) { this.db = db; }
  async all() {
    return this.db.prepare(`SELECT a.workflow_key,a.enabled,a.rollout_stage,a.updated_at,d.name,d.description,u.name AS updated_by_name
      FROM automation_switches a JOIN workflow_definitions d ON d.workflow_key=a.workflow_key LEFT JOIN users u ON u.id=a.updated_by ORDER BY d.name`).all();
  }
  async get(key) { return this.db.prepare('SELECT workflow_key,enabled,rollout_stage FROM automation_switches WHERE workflow_key=?').get(key); }
  async lock(key) { return this.db.prepare('SELECT workflow_key,enabled,rollout_stage FROM automation_switches WHERE workflow_key=? FOR UPDATE').get(key); }
  async set(key, field, value, actorId) {
    const column = field === 'enabled' ? 'enabled' : 'rollout_stage';
    await this.db.prepare(`UPDATE automation_switches SET ${column}=?,updated_by=?,updated_at=now() WHERE workflow_key=?`).run(value, actorId, key);
  }
  async event({ key, field, oldValue, newValue, reason, actorId }) {
    await this.db.prepare('INSERT INTO automation_switch_events(workflow_key,field,old_value,new_value,reason,changed_by) VALUES(?,?,?,?,?,?)').run(key, field, String(oldValue), String(newValue), reason, actorId);
  }
  async events(key) {
    return this.db.prepare(`SELECT e.field,e.old_value,e.new_value,e.reason,e.changed_at,u.name AS changed_by FROM automation_switch_events e JOIN users u ON u.id=e.changed_by
      WHERE (?::text IS NULL OR e.workflow_key=?) ORDER BY e.id DESC LIMIT 200`).all(key ?? null, key ?? null);
  }
}

/**
 * One ON/OFF switch per automation workflow. Every switch starts OFF. Only a
 * holder of automation.enable (owner-only) may turn one ON or change its
 * rollout stage; every change records who, when, old and new value.
 */
export class AutomationService {
  constructor({ repository, transactions, audit, access }) { Object.assign(this, { repository, transactions, audit, access }); }

  async list(user) {
    this.access.require(user, 'automation.read');
    const [switches, history] = await Promise.all([this.repository.all(), this.repository.events(null)]);
    return {
      switches: switches.map((r) => ({ key: r.workflow_key, name: r.name, description: r.description, enabled: r.enabled, rolloutStage: r.rollout_stage, updatedAt: r.updated_at, updatedBy: r.updated_by_name })),
      history: history.map((h) => ({ field: h.field, oldValue: h.old_value, newValue: h.new_value, reason: h.reason, at: h.changed_at, by: h.changed_by }))
    };
  }

  async isEnabled(key) { return Boolean((await this.repository.get(key))?.enabled); }
  async stage(key) { return (await this.repository.get(key))?.rollout_stage ?? 'DRAFT_AND_APPROVAL'; }

  async update(actor, key, { enabled, rolloutStage, reason }) {
    return this.transactions.run(actor, reason, async () => {
      const current = await this.repository.lock(key);
      if (!current) throw notFound('Automation workflow not found.');
      const changes = [];
      if (enabled !== undefined && enabled !== current.enabled) changes.push(['enabled', current.enabled, enabled]);
      if (rolloutStage !== undefined && rolloutStage !== current.rollout_stage) changes.push(['rollout_stage', current.rollout_stage, rolloutStage]);
      for (const [field, oldValue, newValue] of changes) {
        const needsOwner = field === 'rollout_stage' || newValue === true;
        if (needsOwner && !this.access.can(actor, 'automation.enable')) throw forbidden('Only the owner can turn an automation ON or change its rollout stage.', 'OWNER_ONLY');
        if (!needsOwner && !this.access.can(actor, 'automation.disable') && !this.access.can(actor, 'automation.enable')) throw forbidden();
        await this.repository.set(key, field, newValue, actor.id);
        await this.repository.event({ key, field, oldValue, newValue, reason, actorId: actor.id });
        await this.audit.record({ actorId: actor.id, entity: 'AUTOMATION_SWITCH', recordId: key, action: field === 'enabled' ? (newValue ? 'SWITCH_ON' : 'SWITCH_OFF') : 'ROLLOUT_STAGE', oldValue: { [field]: oldValue }, newValue: { [field]: newValue }, reason });
      }
      return this.repository.get(key);
    });
  }
}

export class AutomationController {
  constructor({ automation }) { this.automation = automation; }
  routes() {
    const a = this.automation;
    return [
      { method: 'GET', path: '/api/v1/automation', permission: 'automation.read', handler: async ({ user }) => ({ data: await a.list(user) }) },
      {
        method: 'PATCH', path: '/api/v1/automation/:key', permission: 'automation.read',
        body: s.object({ enabled: s.bool().optional(), rolloutStage: s.enum(['DRAFT_AND_APPROVAL', 'SELECTIVE']).optional(), reason: s.reason() }),
        handler: async ({ user, params, body }) => ({ data: await a.update(user, params.key, body) })
      }
    ];
  }
}
