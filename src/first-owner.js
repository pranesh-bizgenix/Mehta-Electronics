import { s, validate } from './core/schema.js';
import { conflict, validationFailed } from './core/errors.js';
import { hashPassword, validatePassword } from './security.js';

const inputSchema = s.object({ name: s.string({ min: 1, max: 200 }), email: s.email(), password: s.string({ min: 12, max: 128, trim: false }), reason: s.reason() });

/** Explicit operator action only. Never invoked by application startup. */
export async function provisionFirstOwner(sql, input) {
  const body = validate(inputSchema, input);
  const problem = validatePassword(body.password);
  if (problem) throw validationFailed(problem);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(73429923)`;
    await tx`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
    const [count] = await tx`SELECT count(*)::integer AS count FROM users`;
    if (count.count !== 0) throw conflict('First-Owner setup is only available when no staff accounts exist. Use existing Owner administration or account recovery.', 'FIRST_OWNER_ALREADY_CONFIGURED');
    const [role] = await tx`SELECT key,status,all_permissions,requires_mfa FROM roles WHERE key='OWNER' FOR UPDATE`;
    if (!role || role.status !== 'ACTIVE' || !role.all_permissions || !role.requires_mfa) throw conflict('The active protected Owner role is required. Run and verify the approved migrations first.', 'OWNER_ROLE_INVALID');
    const [user] = await tx`INSERT INTO users(name,email,role,status,password_hash,must_change_password) VALUES(${body.name},${body.email.toLowerCase()},'OWNER','ACTIVE',${hashPassword(body.password)},1) RETURNING id,name,email,role,status`;
    await tx`SELECT set_config('mehta.actor_id',${String(user.id)},true),set_config('mehta.audit_reason',${body.reason},true)`;
    await tx`INSERT INTO audit_logs(user_id,entity,record_id,action,new_value,reason) VALUES(${user.id},'USER',${String(user.id)},'FIRST_OWNER_PROVISIONED',${JSON.stringify({ name: user.name, email: user.email, role: 'OWNER', mustChangePassword: true })},${body.reason})`;
    return user;
  });
}
