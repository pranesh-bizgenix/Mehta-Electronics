// Permission checks used across the codebase.
//
// The authoritative matrix lives in PostgreSQL (roles, permissions,
// role_permissions; migration 0021) and is edited in Users & Roles. At startup
// the AccessService installs itself as the provider below. The static map is
// the seed it was created from and is only used when no provider is installed
// (unit tests that call services directly).

export const ROLES = ['EXECUTIVE', 'MANAGER', 'ACCOUNTS', 'OWNER'];

const seedPermissions = {
  EXECUTIVE: ['dashboard.read', 'customers.read', 'customers.create', 'customers.update', 'customers.duplicates', 'items.read', 'enquiries.read', 'enquiries.create', 'enquiries.update', 'quotations.read', 'quotations.create', 'quotations.update', 'orders.read', 'orders.create', 'orders.update', 'work.read', 'tasks.read', 'tasks.write', 'exceptions.raise'],
  MANAGER: ['dashboard.read', 'users.read', 'customers.read', 'customers.create', 'customers.update', 'customers.duplicates', 'items.read', 'items.create', 'items.update', 'enquiries.read', 'enquiries.create', 'enquiries.update', 'quotations.read', 'quotations.create', 'quotations.update', 'quotations.status', 'quotations.send', 'quotations.approve', 'quotations.cost.read', 'orders.read', 'orders.create', 'orders.update', 'orders.review', 'orders.dispatch', 'purchasing.read', 'purchasing.write', 'purchasing.approve', 'tally.read', 'tally.sync', 'items.list_price.read', 'work.read', 'tasks.read', 'tasks.write', 'exceptions.raise'],
  ACCOUNTS: ['dashboard.read', 'customers.read', 'customers.update', 'customers.duplicates', 'items.read', 'enquiries.read', 'quotations.read', 'orders.read', 'tally.read', 'tally.sync', 'customers.dues.read', 'work.read', 'tasks.read', 'tasks.write', 'exceptions.raise'],
  OWNER: ['*']
};

const seedProvider = {
  permissionsFor: (role) => seedPermissions[role] ?? [],
  requiresMfa: (role) => role === 'OWNER'
};

let provider = seedProvider;

/** Installs the database-backed matrix (AccessService). */
export function installPermissionProvider(next) { provider = next ?? seedProvider; }

export function permissionsFor(role) {
  return provider.permissionsFor(role);
}

export function hasPermission(user, permission) {
  const permissions = permissionsFor(user?.role);
  return permissions.includes('*') || permissions.includes(permission);
}

export function roleRequiresMfa(role) {
  return provider.requiresMfa(role);
}
