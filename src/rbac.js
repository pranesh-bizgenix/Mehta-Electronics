export const ROLES = ['EXECUTIVE', 'MANAGER', 'ACCOUNTS', 'OWNER'];

const rolePermissions = {
  EXECUTIVE: ['dashboard.read', 'customers.read', 'customers.create', 'customers.update', 'customers.duplicates', 'items.read', 'enquiries.read', 'enquiries.create', 'enquiries.update', 'quotations.read', 'quotations.create', 'quotations.update', 'orders.read'],
  MANAGER: ['dashboard.read', 'users.read', 'customers.read', 'customers.create', 'customers.update', 'customers.duplicates', 'items.read', 'items.create', 'items.update', 'enquiries.read', 'enquiries.create', 'enquiries.update', 'quotations.read', 'quotations.create', 'quotations.update', 'quotations.status', 'quotations.send', 'quotations.approve', 'quotations.cost.read', 'orders.read', 'orders.create', 'orders.update', 'audit.read', 'tally.read', 'tally.sync'],
  ACCOUNTS: ['dashboard.read', 'customers.read', 'customers.update', 'customers.duplicates', 'items.read', 'enquiries.read', 'quotations.read', 'orders.read', 'audit.read', 'tally.read', 'tally.sync'],
  OWNER: ['*']
};

export function permissionsFor(role) {
  return rolePermissions[role] ?? [];
}

export function hasPermission(user, permission) {
  const permissions = permissionsFor(user?.role);
  return permissions.includes('*') || permissions.includes(permission);
}
