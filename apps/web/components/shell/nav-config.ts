import type { IconName } from '@/components/ds/icons';

export type BadgeKey = 'myOpenWork' | 'slaBreaches' | 'openTasks' | 'openExceptions' | 'draftsAwaitingApproval';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** UI hint only; the server enforces access. */
  permission: string;
  ownerOnly?: boolean;
  badge?: BadgeKey;
  badgeTone?: 'danger' | 'warning';
  keywords?: string;
}
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.read', keywords: 'home owner kpi' },
    { href: '/work', label: 'My work', icon: 'clock', permission: 'work.read', badge: 'slaBreaches', badgeTone: 'danger', keywords: 'sla due' }
  ] },
  { label: 'Sales', items: [
    { href: '/customers', label: 'Customers', icon: 'customers', permission: 'customers.read', keywords: 'crm 360 party' },
    { href: '/contracts', label: 'Customer contracts', icon: 'quote', permission: 'customers.read', keywords: 'rate contract fixed price quantity validity' },
    { href: '/enquiries', label: 'Enquiries', icon: 'inbox', permission: 'enquiries.read', keywords: 'inbox leads' },
    { href: '/quotations', label: 'Quotations', icon: 'quote', permission: 'quotations.read', keywords: 'quotes pdf' },
    { href: '/orders', label: 'Sales orders', icon: 'truck', permission: 'orders.read', keywords: 'dispatch lr delivery po' },
    { href: '/messages', label: 'Outbound drafts', icon: 'mail', permission: 'outbound.read', badge: 'draftsAwaitingApproval', keywords: 'email approval' }
  ] },
  { label: 'Supply', items: [
    { href: '/logistics', label: 'Logistics & store', icon: 'truck', permission: 'logistics.read', keywords: 'grn dispatch photos assigned orders store' },
    { href: '/items', label: 'Items & price lists', icon: 'items', permission: 'items.read', keywords: 'sku products stock' },
    { href: '/purchasing', label: 'Purchasing', icon: 'cart', permission: 'purchasing.read', keywords: 'rfq supplier po grn vendor' },
    { href: '/purchasing/rfqs', label: 'Vendor RFQ documents', icon: 'quote', permission: 'purchasing.read' },
    { href: '/purchasing/purchase-orders', label: 'Supplier PO documents', icon: 'quote', permission: 'purchasing.read' }
  ] },
  { label: 'Work', items: [
    { href: '/operations', label: 'Support & collections', icon: 'inbox', permission: 'operations.read', keywords: 'incoming email complaints warranty returns receipts payments invoices' },
    { href: '/tasks', label: 'Tasks', icon: 'tasks', permission: 'tasks.read', badge: 'openTasks', keywords: 'board todo' },
    { href: '/exceptions', label: 'Exceptions', icon: 'alert', permission: 'exceptions.read', badge: 'openExceptions', badgeTone: 'warning', keywords: 'approvals queue' }
  ] },
  { label: 'Tally', items: [
    { href: '/tally', label: 'Tally & reconciliation', icon: 'ledger', permission: 'tally.read', keywords: 'ledgers stock groups' },
    { href: '/tally/conflicts', label: 'Tally conflicts', icon: 'ledger', permission: 'tally.read', keywords: 'differences recovery reconciliation' },
    { href: '/tally/monitor', label: 'Sync monitor', icon: 'plug', permission: 'tally.read', keywords: 'sync jobs queue delivery indexing retry' },
    { href: '/tally/financial', label: 'Receipts & outstanding', icon: 'ledger', permission: 'customers.dues.read', keywords: 'payments cheques bills financial' },
    { href: '/tally/connector', label: 'Tally connector', icon: 'plug', permission: 'tally.connector.manage', keywords: 'pairing sync' },
    { href: '/tally/write', label: 'Tally write operations', icon: 'sliders', permission: 'tally.write.manage', ownerOnly: true, keywords: 'write create outbox mapping dry run approval kill switch' }
  ] },
  { label: 'Admin', items: [
    { href: '/setup', label: 'Setup checklist', icon: 'tasks', permission: 'users.read', ownerOnly: true, keywords: 'readiness onboarding backup configuration' },
    { href: '/decisions', label: 'Business decisions', icon: 'tasks', permission: 'rules.manage', ownerOnly: true, keywords: 'prem confirmation questions blocked workflows decision sheet' },
    { href: '/users', label: 'Users & roles', icon: 'shield', permission: 'users.read', keywords: 'permissions matrix' },
    { href: '/rules', label: 'Rules & switches', icon: 'sliders', permission: 'rules.read', keywords: 'automation sla discount margin' },
    { href: '/audit', label: 'Audit trail', icon: 'audit', permission: 'audit.read', keywords: 'history log' },
    { href: '/settings', label: 'Settings', icon: 'settings', permission: 'authenticated', keywords: 'theme preferences account' }
  ] }
];

/** All application links stay in this ControlDesk origin. */
export function screenHref(href: string): string { return href; }
