import type { IconName } from '@/components/ds/icons';

export type BadgeKey = 'myOpenWork' | 'slaBreaches' | 'openTasks' | 'openExceptions' | 'draftsAwaitingApproval';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** UI hint only; the server enforces access. */
  permission: string;
  badge?: BadgeKey;
  badgeTone?: 'danger' | 'warning';
  /** Not yet rebuilt: opens the existing screen until its replacement ships. */
  legacy?: boolean;
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
    { href: '/enquiries', label: 'Enquiries', icon: 'inbox', permission: 'enquiries.read', keywords: 'inbox leads' },
    { href: '/quotations', label: 'Quotations', icon: 'quote', permission: 'quotations.read', keywords: 'quotes pdf' },
    { href: '/orders', label: 'Sales orders', icon: 'truck', permission: 'orders.read', keywords: 'dispatch lr delivery po' },
    { href: '/messages', label: 'Outbound drafts', icon: 'mail', permission: 'outbound.read', badge: 'draftsAwaitingApproval', keywords: 'email approval' }
  ] },
  { label: 'Supply', items: [
    { href: '/items', label: 'Items & price lists', icon: 'items', permission: 'items.read', keywords: 'sku products stock' },
    { href: '/purchasing', label: 'Purchasing', icon: 'cart', permission: 'purchasing.read', keywords: 'rfq supplier po grn vendor' }
  ] },
  { label: 'Work', items: [
    { href: '/tasks', label: 'Tasks', icon: 'tasks', permission: 'tasks.read', badge: 'openTasks', keywords: 'board todo' },
    { href: '/exceptions', label: 'Exceptions', icon: 'alert', permission: 'exceptions.read', badge: 'openExceptions', badgeTone: 'warning', keywords: 'approvals queue' }
  ] },
  { label: 'Tally', items: [
    { href: '/tally', label: 'Tally & reconciliation', icon: 'ledger', permission: 'tally.read', keywords: 'ledgers stock groups' },
    { href: '/tally/connector', label: 'Tally connector', icon: 'plug', permission: 'tally.connector.manage', keywords: 'pairing sync' }
  ] },
  { label: 'Admin', items: [
    { href: '/users', label: 'Users & roles', icon: 'shield', permission: 'users.read', keywords: 'permissions matrix' },
    { href: '/rules', label: 'Rules & switches', icon: 'sliders', permission: 'rules.read', keywords: 'automation sla discount margin' },
    { href: '/audit', label: 'Audit trail', icon: 'audit', permission: 'audit.read', keywords: 'history log' },
    { href: '/settings', label: 'Settings', icon: 'settings', permission: 'authenticated', keywords: 'theme preferences account' }
  ] }
];

/** Screens still served by the existing app (removed from this list as each one is rebuilt). */
export const LEGACY_SCREENS = new Set<string>(['/quotations', '/orders', '/items', '/purchasing', '/tally', '/tally/connector']);

export const legacyUrl = (): string => process.env.NEXT_PUBLIC_LEGACY_CRM_URL ?? 'http://127.0.0.1:3000/';

/** Where a link should go today: the rebuilt screen, or the existing app while a screen is still pending. */
export function screenHref(href: string): string {
  const path = href.split('?')[0];
  const parent = path.slice(0, path.lastIndexOf('/')) || path;
  return LEGACY_SCREENS.has(path) || LEGACY_SCREENS.has(parent) ? legacyUrl() : href;
}
