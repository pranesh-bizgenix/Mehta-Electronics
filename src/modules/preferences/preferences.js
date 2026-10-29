import { s } from '../../core/schema.js';
import { validationFailed } from '../../core/errors.js';

const DEFAULTS = { theme: 'system', density: 'comfortable', sidebarCollapsed: false, savedFilters: {} };

/** @interface PreferencesRepository */
export class PreferencesRepository {
  constructor(db) { this.db = db; }
  async get(userId) {
    return this.db.prepare('SELECT theme,density,sidebar_collapsed,saved_filters,updated_at FROM user_preferences WHERE user_id=?').get(userId);
  }
  async upsert(userId, p) {
    return this.db.prepare(`INSERT INTO user_preferences(user_id,theme,density,sidebar_collapsed,saved_filters) VALUES(?,?,?,?,?::text::jsonb)
      ON CONFLICT(user_id) DO UPDATE SET theme=EXCLUDED.theme,density=EXCLUDED.density,sidebar_collapsed=EXCLUDED.sidebar_collapsed,saved_filters=EXCLUDED.saved_filters,updated_at=now()
      RETURNING theme,density,sidebar_collapsed,saved_filters,updated_at`).get(userId, p.theme, p.density, p.sidebarCollapsed, JSON.stringify(p.savedFilters));
  }
}

/** Per-user UI preferences. Purely presentational; no permission is implied. */
export class PreferencesService {
  constructor({ repository }) { this.repository = repository; }
  view(row) {
    return row ? { theme: row.theme, density: row.density, sidebarCollapsed: row.sidebar_collapsed, savedFilters: row.saved_filters, updatedAt: row.updated_at } : { ...DEFAULTS, updatedAt: null };
  }
  async get(user) { return this.view(await this.repository.get(user.id)); }
  async update(user, patch) {
    const current = await this.get(user);
    const next = { ...current, ...patch };
    if (JSON.stringify(next.savedFilters).length > 20000) throw validationFailed('Saved filters are too large.');
    return this.view(await this.repository.upsert(user.id, next));
  }
}

/**
 * Sidebar badge counts. Each count is only computed for users who may see the
 * underlying records; other counts are omitted, never zero-filled.
 */
export class BadgeRepository {
  constructor(db) { this.db = db; }
  async openExceptions() { return Number((await this.db.prepare("SELECT count(*) AS n FROM exception_cases WHERE status='OPEN'").get()).n); }
  async myBreaches(userId) { return Number((await this.db.prepare("SELECT count(*) AS n FROM work_items WHERE (owner_user_id=? OR escalated_to_user_id=?) AND sla_state='BREACHED' AND status IN ('OPEN','IN_PROGRESS','WAITING') AND NOT is_deleted").get(userId, userId)).n); }
  async myOpenWork(userId) { return Number((await this.db.prepare("SELECT count(*) AS n FROM work_items WHERE (owner_user_id=? OR escalated_to_user_id=?) AND status IN ('OPEN','IN_PROGRESS','WAITING') AND NOT is_deleted").get(userId, userId)).n); }
  async draftsAwaiting() { return Number((await this.db.prepare("SELECT count(*) AS n FROM email_drafts WHERE status='DRAFT'").get()).n); }
  async unreadNotifications(userId) { return Number((await this.db.prepare("SELECT count(*) AS n FROM notifications WHERE user_id=? AND channel='IN_APP' AND delivery_state<>'READ'").get(userId)).n); }
  async openTasks(userId) { return Number((await this.db.prepare("SELECT count(*) AS n FROM tasks WHERE owner_user_id=? AND status IN ('OPEN','IN_PROGRESS') AND NOT is_deleted").get(userId)).n); }
}

export class BadgeService {
  constructor({ repository, access }) { this.repository = repository; this.access = access; }
  async forUser(user) {
    const r = this.repository;
    const out = { unreadNotifications: await r.unreadNotifications(user.id) };
    if (this.access.can(user, 'work.read')) { out.myOpenWork = await r.myOpenWork(user.id); out.slaBreaches = await r.myBreaches(user.id); }
    if (this.access.can(user, 'tasks.read')) out.openTasks = await r.openTasks(user.id);
    if (this.access.can(user, 'exceptions.read')) out.openExceptions = await r.openExceptions();
    if (this.access.can(user, 'outbound.read')) out.draftsAwaitingApproval = await r.draftsAwaiting();
    return out;
  }
}

export class PreferencesController {
  constructor({ preferences, badges }) { this.preferences = preferences; this.badges = badges; }
  routes() {
    return [
      { method: 'GET', path: '/api/v1/me/preferences', permission: 'authenticated', handler: async ({ user }) => ({ data: await this.preferences.get(user) }) },
      {
        method: 'PUT', path: '/api/v1/me/preferences', permission: 'authenticated',
        body: s.object({ theme: s.enum(['system', 'light', 'dark']).optional(), density: s.enum(['comfortable', 'compact']).optional(), sidebarCollapsed: s.bool().optional(), savedFilters: s.json({ maxBytes: 20000 }).optional() }),
        handler: async ({ user, body }) => ({ data: await this.preferences.update(user, body) })
      },
      { method: 'GET', path: '/api/v1/me/badges', permission: 'authenticated', handler: async ({ user }) => ({ data: await this.badges.forUser(user) }) }
    ];
  }
}
