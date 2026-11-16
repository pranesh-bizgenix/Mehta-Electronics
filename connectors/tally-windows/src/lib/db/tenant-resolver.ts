export interface TenantDatabaseResolution {
  orgId: string;
  mode: 'shared' | 'dedicated';
  dbUrl: string | null;
  dbProvider: string;
  source: 'tenant_database_connections' | 'organizations' | 'default';
}
// Inherited upstream source is not another ControlDesk backend.
// Never select an organization-specific URL or import the absent DB client.
export async function resolveTenantDatabase(_orgId: string): Promise<TenantDatabaseResolution> {
  throw new Error('Alternate tenant database routing is disabled. Only the guarded ControlDesk connection to mehta_electronics_local is permitted.');
}
