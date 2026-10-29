import type { ApiClient, Paginated } from '@/lib/api/client';

export type EnquiryStatus = 'NEW' | 'QUALIFIED' | 'QUOTED' | 'WON' | 'LOST' | 'CANCELLED';
export interface EnquiryRow { id: number; enquiry_number: string; subject: string; status: EnquiryStatus; source: string | null; expected_by: string | null; customer_id: number; customer_name: string; owner_name: string | null; assigned_to: number | null; line_count: number; created_at: string; updated_at: string }
export interface EnquiryLine { id: number; item_id: number | null; part_code: string | null; description: string; quantity: string; uom: string | null; target_price?: string | null }
export interface Enquiry extends Omit<EnquiryRow, 'owner_name' | 'line_count'> { assigned_name: string | null; notes: string | null; lines: EnquiryLine[] }
export interface Revision { id: number; revision_number: number; reason: string; created_at: string; created_by_name: string }
export interface EnquiryInput { customerId: number; subject: string; source?: string | null; expectedBy?: string | null; ownerId?: number; notes?: string | null; lines: { itemId: number; quantity: string }[]; reason?: string }

/** Allowed transitions (mirrors the server; the server is authoritative). */
export const TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = { NEW: ['QUOTED', 'CANCELLED'], QUALIFIED: ['QUOTED', 'LOST', 'CANCELLED'], QUOTED: ['WON', 'LOST', 'CANCELLED'], WON: [], LOST: [], CANCELLED: [] };
export const SOURCES = ['Email', 'Phone', 'WhatsApp', 'Walk-in', 'Referral', 'Website', 'Other'];

export const enquiriesApi = (client: ApiClient) => ({
  list: (q: Record<string, string | number>, signal?: AbortSignal) => client.get<Paginated<EnquiryRow>>('/api/crm/enquiries', { query: { ...q, pageSize: 25 }, signal }),
  get: (id: number | string, signal?: AbortSignal) => client.data<Enquiry>('GET', `/api/crm/enquiries/${id}`, undefined, { signal }),
  revisions: (id: number | string, signal?: AbortSignal) => client.data<Revision[]>('GET', `/api/enquiries/${id}/revisions`, undefined, { signal }),
  create: (body: EnquiryInput, idempotencyKey: string) => client.data<Enquiry>('POST', '/api/crm/enquiries', body, { idempotencyKey }),
  revise: (id: number, body: EnquiryInput & { reason: string }) => client.data<Enquiry>('PUT', `/api/crm/enquiries/${id}`, body),
  setStatus: (id: number, status: EnquiryStatus, reason: string) => client.data<Enquiry>('PATCH', `/api/crm/enquiries/${id}/status`, { status, reason }),
  owners: () => client.data<{ id: number; name: string }[]>('GET', '/api/crm/owners'),
  customers: (search: string) => client.get<Paginated<{ id: number; name: string; gstin: string | null }>>('/api/crm/customers', { query: { search, status: 'ACTIVE', pageSize: 20 } }),
  items: (search: string) => client.get<Paginated<{ id: number; part_code: string; description: string; uom: string }>>('/api/crm/items', { query: { search, status: 'ACTIVE', pageSize: 20 } })
});
export type EnquiriesApi = ReturnType<typeof enquiriesApi>;
