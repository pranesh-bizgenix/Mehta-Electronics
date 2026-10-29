import { conflict, forbidden, notFound, validationFailed } from '../../core/errors.js';
import { installPermissionProvider } from '../../rbac.js';

/**
 * Holds the role/permission matrix in memory and refreshes it when the
 * database version (max access_matrix_events id) changes. Installed as the
 * permission provider for every hasPermission() call in the codebase.
 */
export class AccessService {
  constructor({ repository, transactions, audit, mfaEnabled = false }) {
    this.mfaEnabled = mfaEnabled;
    this.repository = repository;
    this.transactions = transactions;
    this.audit = audit;
    this.matrix = new Map();
    this.loadedVersion = -1;
  }

  async load() {
    const [roles, grants, version] = await Promise.all([this.repository.roles(), this.repository.grants(), this.repository.version()]);
    const matrix = new Map(roles.map((r) => [r.key, { allPermissions: r.all_permissions, requiresMfa: r.requires_mfa, active: r.status === 'ACTIVE', permissions: new Set() }]));
    for (const g of grants) matrix.get(g.role_key)?.permissions.add(g.permission_key);
    this.matrix = matrix;
    this.loadedVersion = version;
    return this;
  }

  /** Cheap per-request freshness check so edits apply across server processes. */
  async refreshIfStale(version) {
    if (version !== undefined && Number(version) !== this.loadedVersion) await this.load();
  }

  install() {
    installPermissionProvider({
      permissionsFor: (role) => {
        const entry = this.matrix.get(role);
        if (!entry || !entry.active) return [];
        return entry.allPermissions ? ['*'] : [...entry.permissions];
      },
      requiresMfa: (role) => this.mfaEnabled && Boolean(this.matrix.get(role)?.requiresMfa)
    });
    return this;
  }

  roleExists(key) { return Boolean(this.matrix.get(key)?.active); }

  requiresMfa(role) { return this.mfaEnabled && Boolean(this.matrix.get(role)?.requiresMfa); }

  can(user, permission) {
    const entry = this.matrix.get(user?.role);
    return Boolean(entry?.active && (entry.allPermissions || entry.permissions.has(permission)));
  }

  require(user, permission) {
    if (!this.can(user, permission)) throw forbidden();
  }

  /** Strips fields the user may not see. map = { permissionKey: ['field', ...] } */
  redact(user, record, map) {
    if (!record || typeof record !== 'object') return record;
    const out = Array.isArray(record) ? record.map((r) => this.redact(user, r, map)) : { ...record };
    if (Array.isArray(out)) return out;
    for (const [permission, fields] of Object.entries(map)) {
      if (this.can(user, permission)) continue;
      for (const field of fields) delete out[field];
    }
    return out;
  }

  async matrixView(user) {
    this.require(user, 'access.read');
    const [roles, permissions, grants, history] = await Promise.all([this.repository.roles(), this.repository.permissions(), this.repository.grants(), this.repository.history(100)]);
    const granted = new Set(grants.map((g) => `${g.role_key}|${g.permission_key}`));
    return {
      roles: roles.map((r) => ({ key: r.key, name: r.name, description: r.description, requiresMfa: r.requires_mfa, allPermissions: r.all_permissions, isSystem: r.is_system, status: r.status })),
      permissions: permissions.map((p) => ({ key: p.key, resource: p.resource, action: p.action, description: p.description, ownerOnly: p.owner_only, grantedTo: roles.filter((r) => r.all_permissions || granted.has(`${r.key}|${p.key}`)).map((r) => r.key) })),
      history: history.map((h) => ({ id: Number(h.id), role: h.role_key, permission: h.permission_key, change: h.change, oldValue: h.old_value, newValue: h.new_value, reason: h.reason, changedAt: h.changed_at, changedBy: h.changed_by_name })),
      version: this.loadedVersion
    };
  }

  async setGrant(actor, { role, permission, granted, reason }) {
    this.require(actor, 'access.manage');
    return this.transactions.run(actor, reason, async () => {
      const roleRow = await this.repository.role(role);
      if (!roleRow) throw notFound('Role not found.');
      if (roleRow.all_permissions) throw conflict('The owner role always holds every permission and cannot be edited.', 'ROLE_LOCKED');
      const perm = await this.repository.permission(permission);
      if (!perm) throw notFound('Permission not found.');
      if (perm.owner_only && granted) throw conflict(`${perm.description} is reserved for the owner.`, 'OWNER_ONLY_PERMISSION');
      const before = await this.repository.hasGrant(role, permission);
      if (before === granted) return this.matrixView(actor);
      if (granted) await this.repository.grant(role, permission, actor.id);
      else await this.repository.revoke(role, permission);
      await this.repository.event({ roleKey: role, permissionKey: permission, change: granted ? 'GRANT' : 'REVOKE', oldValue: { granted: before }, newValue: { granted }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'ACCESS_MATRIX', recordId: `${role}:${permission}`, action: granted ? 'GRANT' : 'REVOKE', oldValue: { granted: before }, newValue: { granted }, reason });
      await this.load();
      return this.matrixView(actor);
    });
  }

  async createRole(actor, { key, name, description, requiresMfa, reason }) {
    this.require(actor, 'access.manage');
    return this.transactions.run(actor, reason, async () => {
      if (await this.repository.role(key)) throw conflict('A role with this key already exists.', 'DUPLICATE');
      await this.repository.createRole({ key, name, description, requiresMfa }, actor.id);
      await this.repository.event({ roleKey: key, change: 'ROLE_CREATED', newValue: { name, description, requiresMfa }, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'ROLE', recordId: key, action: 'CREATE', newValue: { name, description, requiresMfa }, reason });
      await this.load();
      return this.matrixView(actor);
    });
  }

  async updateRole(actor, key, { name, description, requiresMfa, status, reason }) {
    this.require(actor, 'access.manage');
    return this.transactions.run(actor, reason, async () => {
      const old = await this.repository.role(key);
      if (!old) throw notFound('Role not found.');
      if (old.all_permissions && (status === 'INACTIVE' || requiresMfa === false)) throw conflict('The owner role must stay active and keep MFA enabled.', 'ROLE_LOCKED');
      if (status === 'INACTIVE' && await this.repository.activeUserCount(key) > 0) throw validationFailed('Move active users to another role before deactivating this role.');
      const next = { name: name ?? old.name, description: description === undefined ? old.description : description, requiresMfa: requiresMfa ?? old.requires_mfa, status: status ?? old.status };
      await this.repository.updateRole(key, next, actor.id);
      const before = { name: old.name, description: old.description, requiresMfa: old.requires_mfa, status: old.status };
      await this.repository.event({ roleKey: key, change: 'ROLE_UPDATED', oldValue: before, newValue: next, reason, actorId: actor.id });
      await this.audit.record({ actorId: actor.id, entity: 'ROLE', recordId: key, action: 'UPDATE', oldValue: before, newValue: next, reason });
      await this.load();
      return this.matrixView(actor);
    });
  }
}
