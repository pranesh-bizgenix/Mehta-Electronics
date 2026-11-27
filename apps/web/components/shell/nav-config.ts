import type { IconName } from '@/components/ds/icons';
import {emailAutomationEnabled} from '../../features/email-automation/config';

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
export interface NavGroup { label: string; items: NavItem[]; collapsible?: boolean }

export const NAV: NavGroup[] = [
  ...(emailAutomationEnabled() ? [{ label: 'EMAIL AUTOMATION', collapsible: true, items: [
    { href: '/email-automation/inbox', label: 'Unified email inbox', icon: 'mail' as IconName, permission: 'email_automation.read' },
    { href: '/email-automation/attachments', label: 'Attachment manager', icon: 'items' as IconName, permission: 'email_automation.read' },
    { href: '/email-automation/processing', label: 'Processing monitor', icon: 'clock' as IconName, permission: 'email_automation.read' },
    { href: '/email-automation/dashboard', label: 'Automation dashboard', icon: 'dashboard' as IconName, permission: 'email_automation.read' },
    { href: '/email-automation/integrations', label: 'Integration monitor', icon: 'plug' as IconName, permission: 'email_automation.integrations.read' },
    { href: '/email-automation/errors', label: 'Error center', icon: 'alert' as IconName, permission: 'email_automation.read' }
  ] }] : []),
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.read', keywords: 'home owner kpi' },
    { href: '/notifications', label: 'Saved notifications', icon: 'bell', permission: 'authenticated', keywords: 'notification history unread messages payment reminders dues' },
    { href: '/reports', label: 'Business report PDFs', icon: 'quote', permission: 'authenticated', keywords: 'export pdf reports' },
    { href: '/work', label: 'My work', icon: 'clock', permission: 'work.read', badge: 'slaBreaches', badgeTone: 'danger', keywords: 'sla due' }
  ] },
  { label: 'Sales', collapsible: true, items: [
    { href: '/sales/customer-pos', label: 'Customer POs', icon: 'quote', permission: 'orders.read', keywords: 'purchase order email make excel manual rows columns' },
    { href: '/incoming-requests', label: 'Incoming requests', icon: 'inbox', permission: 'sales_intake.read', keywords: 'email whatsapp customer po enquiry quotation request inbox' },
    { href: '/customers', label: 'Customers', icon: 'customers', permission: 'customers.read', keywords: 'crm 360 party' },
    { href: '/contracts', label: 'Customer contracts', icon: 'quote', permission: 'customers.read', keywords: 'rate contract fixed price quantity validity' },
    { href: '/enquiries', label: 'Enquiries', icon: 'inbox', permission: 'enquiries.read', keywords: 'inbox leads' },
    { href: '/quotations', label: 'Quotations', icon: 'quote', permission: 'quotations.read', keywords: 'quotes pdf' },
    { href: '/billing', label: 'Invoice documents', icon: 'ledger', permission: 'collections.read', keywords: 'invoice pdf tally copy billing' },
    { href: '/messages', label: 'Outbound drafts', icon: 'mail', permission: 'outbound.read', badge: 'draftsAwaitingApproval', keywords: 'email approval' }
  ] },
  { label: 'Operations', collapsible: true, items: [
    { href: '/orders', label: 'Order status', icon: 'truck', permission: 'orders.read', keywords: 'sales orders supplied pending partial dispatch lr delivery customer po' },
    { href: '/items/stock-checks', label: 'Stock', icon: 'items', permission: 'items.read', keywords: 'inventory availability warehouse free reserved stock checks daily analysis' },
    { href: '/operations/open-orders', label: 'Open orders', icon: 'quote', permission: 'orders.read', keywords: 'open order pending quantities excel schedule manual rows' },
    { href: '/purchasing', label: 'Procurement', icon: 'cart', permission: 'purchasing.read', keywords: 'purchasing supplier comparison rfq purchase request po grn goods receipt' },
    { href: '/purchasing/sourcing', label: 'Supplier comparisons', icon: 'cart', permission: 'purchasing.read', keywords: 'pack conversions freight landed cost vendor quotations' },
    { href: '/purchasing/suppliers', label: 'Supplier performance', icon: 'cart', permission: 'purchasing.read', keywords: 'supplier scorecards schemes response quality delivery performance' },
    { href: '/operations/delivery-tracking', label: 'Delivery tracking', icon: 'truck', permission: 'orders.read', keywords: 'manual shipment transporter lr delivery proof' },
    { href: '/operations/delivery-schedules', label: 'Delivery schedules', icon: 'clock', permission: 'orders.read', keywords: 'customer supplier promised dates quantities late delivery commitments' },
    { href: '/operations/warehouse', label: 'Warehouse custody', icon: 'items', permission: 'logistics.grn.read', keywords: 'warehouse receipt batches serials locations packing physical custody' }
  ] },
  { label: 'Accounts', collapsible: true, items: [
    { href: '/accounts/payables', label: 'Supplier dues & payments', icon: 'ledger', permission: 'collections.read', keywords: 'supplier vendor invoice accepted goods payment approvals adjustments' },
    { href: '/accounts/collections', label: 'Collections & receipts', icon: 'ledger', permission: 'collections.read', keywords: 'payment allocations promises cheques overdue ageing invoices' },
    { href: '/accounts/bank-reconciliation', label: 'Bank reconciliation', icon: 'ledger', permission: 'collections.read', keywords: 'bank statement import receipt matching verification balances' },
    { href: '/accounts/gst', label: 'GST preparation', icon: 'ledger', permission: 'collections.read', keywords: 'gst irn eway purchase tax invoice preparation' },
    { href: '/accounts/incoming', label: 'Incoming Accounts requests', icon: 'inbox', permission: 'collections.read', keywords: 'finance email payments reminders due invoice requests' },
    { href: '/accounts/adjustments', label: 'Credit / debit requests', icon: 'ledger', permission: 'collections.read', keywords: 'credit debit adjustment approval review' }
  ] },
  { label: 'Customer Support', collapsible: true, items: [
    { href: '/support/incoming', label: 'Incoming Support requests', icon: 'inbox', permission: 'operations.read', keywords: 'product enquiries complaints warranty email support inbox' },
    { href: '/operations?kind=SUPPORT', label: 'Customer complaints', icon: 'inbox', permission: 'operations.read' },
    { href: '/operations?kind=WARRANTY', label: 'Warranty claims', icon: 'quote', permission: 'operations.read' },
    { href: '/operations?kind=RETURN', label: 'Returns & replacements', icon: 'truck', permission: 'operations.read' }
  ] },
  { label: 'Supply', collapsible: true, items: [
    { href: '/logistics', label: 'Logistics & store', icon: 'truck', permission: 'logistics.read', keywords: 'grn dispatch photos assigned orders store' },
    { href: '/items', label: 'Items & price lists', icon: 'items', permission: 'items.read', keywords: 'sku products stock' },
    { href: '/purchasing/rfqs', label: 'Vendor RFQ documents', icon: 'quote', permission: 'purchasing.read' },
    { href: '/purchasing/purchase-orders', label: 'Supplier PO documents', icon: 'quote', permission: 'purchasing.read' }
  ] },
  { label: 'Work', collapsible: true, items: [
    { href: '/operations', label: 'Support & collections', icon: 'inbox', permission: 'operations.read', keywords: 'incoming email complaints warranty returns receipts payments invoices' },
    { href: '/tasks', label: 'Tasks', icon: 'tasks', permission: 'tasks.read', badge: 'openTasks', keywords: 'board todo' },
    { href: '/exceptions', label: 'Exceptions', icon: 'alert', permission: 'exceptions.read', badge: 'openExceptions', badgeTone: 'warning', keywords: 'approvals queue' }
  ] },
  { label: 'Tally', collapsible: true, items: [
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
