export interface PermissionRolePolicy {
  allPermissions: boolean;
  allowedPermissions?: string[];
}

export interface PermissionPolicy {
  key: string;
  ownerOnly: boolean;
}

export function permissionCellLocked(role: PermissionRolePolicy, permission: PermissionPolicy, granted: boolean): boolean {
  return role.allPermissions || (permission.ownerOnly && !granted) || Boolean(role.allowedPermissions && !role.allowedPermissions.includes(permission.key));
}

export function permissionAuditReason(permissionKey: string, granted: boolean): string {
  return `${granted ? 'Granted' : 'Removed'} ${permissionKey} from the Users & roles permission matrix.`;
}
