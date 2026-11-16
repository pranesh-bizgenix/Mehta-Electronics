import {installPermissionProvider,permissionsFor} from '../src/rbac.js';

/** Deterministic seed-role matrix inside the caller's rollback transaction only.
 * Existing dev permissions must not decide an isolated test's expected outcome.
 */
export async function fixturePermissions(db){
 installPermissionProvider(null);
 for(const role of ['EXECUTIVE','MANAGER','ACCOUNTS']){
  const expected=permissionsFor(role);
  await db.prepare('DELETE FROM role_permissions WHERE role_key=?').run(role);
  for(const permission of expected)await db.prepare('INSERT INTO role_permissions(role_key,permission_key) SELECT ?,key FROM permissions WHERE key=? ON CONFLICT DO NOTHING').all(role,permission);
 }
}
