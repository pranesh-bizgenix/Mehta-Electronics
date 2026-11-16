// Retained exports fail before any connection, SQL or filesystem action.
// Migrate callers to rollback transactions or self-cleaning VERIFY- rows.
const disabled = () => { throw Object.assign(new Error('Legacy test database/schema helpers are disabled by MASTER RULES. Use a rolled-back transaction or self-cleaning VERIFY- rows in mehta_electronics_local.'), { code: 'TEST_SCHEMA_DISABLED' }); };
export function assertTestSchema() { return disabled(); }
export async function temporarySchema() { return disabled(); }
export async function temporaryDatabase() { return disabled(); }
export async function shadowPublicRelations() { return disabled(); }
