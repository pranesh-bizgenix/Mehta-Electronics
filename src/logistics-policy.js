export const logisticsPermissions = {
  LOGISTICS_LEAD: ['logistics.read','logistics.orders.read','logistics.grn.read','logistics.grn.manage','logistics.grn.post','logistics.dispatch.manage','logistics.assignment.manage','logistics.evidence.write'],
  STORE_STAFF: ['logistics.read','logistics.orders.assigned','logistics.evidence.write']
};
export const isLogisticsRole = user => Object.hasOwn(logisticsPermissions, user?.role ?? '');
export function restrictLogisticsPermissions(role, permissions) {
  return Object.hasOwn(logisticsPermissions, role) ? permissions.filter(p => logisticsPermissions[role].includes(p)) : permissions;
}
