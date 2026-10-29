import type { ApiClient, Paginated } from '@/lib/api/client';

export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'ON_HOLD';
export interface CustomerRow { id: number; name: string; customer_code: string | null; gstin: string | null; credit_limit: string; credit_days: number; payment_terms: string | null; tally_linked: boolean; status: CustomerStatus; updated_at: string }
export interface Contact { id?: number; name: string; designation?: string | null; phone?: string | null; email?: string | null; is_primary?: number | boolean; isPrimary?: boolean }
export interface PartMapping { id: number; item_id: number; part_code: string; customer_part_number: string; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' }
export interface Customer extends CustomerRow {
  billing_address: string | null; owner_id: number | null; created_at: string;
  profile: { state_code?: string | null; payment_terms?: string | null; company_id?: string | null; tally_ledger_name?: string | null };
  contacts: Contact[]; partMappings: PartMapping[];
  tally: { linked: boolean; matchCount: number; companyId: string | null; name: string | null };
  dues: { available: boolean; financialAccess: boolean; closingBalance?: string; drCr?: string; fetchedAt?: string; note: string };
}
export interface HistoryRow { id: number; number: string; status: string; created_at: string; updated_at: string }
export interface CustomerInput {
  name: string; customerCode?: string | null; gstin?: string | null; stateCode?: string | null; paymentTerms?: string | null; creditDays: number; creditLimit: string;
  billingAddress?: string | null; status: CustomerStatus; ownerId?: number | null; companyId?: string | null; tallyName?: string | null;
  contacts: { id?: number; name: string; designation?: string | null; phone?: string | null; email?: string | null; isPrimary: boolean }[]; reason?: string;
}
export interface Duplicate { id: number; name: string; gstin: string | null; customer_code: string | null; matched_on?: string[] }

/** Typed access to the customer endpoints (unchanged existing contracts). */
export const customersApi = (client: ApiClient) => ({
  list: (q: { page: number; search: string; status: string }, signal?: AbortSignal) => client.get<Paginated<CustomerRow>>('/api/crm/customers', { query: { ...q, pageSize: 25 }, signal }),
  get: (id: number | string, signal?: AbortSignal) => client.data<Customer>('GET', `/api/crm/customers/${id}`, undefined, { signal }),
  create: (body: CustomerInput, idempotencyKey: string) => client.data<Customer>('POST', '/api/crm/customers', body, { idempotencyKey }),
  update: (id: number, body: Partial<CustomerInput> & { reason: string }) => client.data<Customer>('PATCH', `/api/crm/customers/${id}`, body),
  history: (id: number | string, tab: 'enquiries' | 'quotes' | 'orders' | 'invoices', signal?: AbortSignal) =>
    client.get<{ data: HistoryRow[]; available?: boolean; reason?: string }>(`/api/crm/customers/${id}/history/${tab}`, { signal }),
  duplicates: (body: { name?: string; gstin?: string | null; excludeId?: number }) => client.data<Duplicate[]>('POST', '/api/customers/duplicates', body),
  savePart: (customerId: number, mappingId: number | null, body: { itemId: number; customerPartNumber: string; status: PartMapping['status']; reason?: string }) =>
    mappingId ? client.data('PATCH', `/api/crm/customers/${customerId}/part-mappings/${mappingId}`, body) : client.data('POST', `/api/crm/customers/${customerId}/part-mappings`, body),
  owners: () => client.data<{ id: number; name: string }[]>('GET', '/api/crm/owners'),
  companies: () => client.data<{ id: string; name: string; display_name: string }[]>('GET', '/api/tally/read-companies'),
  tallyLedgers: (companyId: string, search: string) => client.get<{ data: { name: string; display_name?: string; gstin?: string | null }[] }>('/api/tally/customers', { query: { companyId, search, pageSize: 20 } }),
  items: (search: string) => client.get<Paginated<{ id: number; part_code: string; description: string }>>('/api/crm/items', { query: { search, status: 'ACTIVE', pageSize: 20 } })
});
export type CustomersApi = ReturnType<typeof customersApi>;
