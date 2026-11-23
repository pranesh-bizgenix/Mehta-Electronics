import type { ApiClient, Paginated } from '@/lib/api/client';
import type {QuotationRequest,QuotationLineRequest} from '../../../../public/quotation-request.js';
import type {PricingBinding} from '@/features/customers/management-api';

export type QuoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT' | 'WON' | 'LOST' | 'EXPIRED' | 'CANCELLED';
export type QuoteAction = 'SUBMIT' | 'APPROVE' | 'RETURN' | 'SEND' | 'WON' | 'LOST' | 'EXPIRE' | 'CANCEL';

export interface QuoteLine {
  customerPricing?:PricingBinding;
  sourceLineId?: string;
  pricingSelection?: {level:number;fingerprint:string};
  requestDetails?:QuotationLineRequest;
  itemId: number; partCode: string; hsn: string; description: string; uom: string;
  quantity: string; unitPrice: string; discountPercent: string; taxPercent: string;
  net: string; cgst: string; sgst: string; igst: string; total: string;
}
export interface Pricing {
  cost: string; missingCost: boolean; marginPercent: string | null; belowFloor: boolean; floorPercent: string; marginBasis: 'LINE_AND_TOTAL' | 'TOTAL';
  lines: { itemId: number; unitCost: string | null; cost?: string; marginPercent: string | null; belowFloor?: boolean }[];
}
export interface Quotation {
  companyId?:string;requiresWarehouseReview?:boolean;
  approval?:{roundId:string;completed:number;total:number;pendingStageId:string|null;canApprove:boolean;canReturn:boolean;ownerSelfApproval?:boolean;blocked?:boolean;note?:string;steps:{id:string;number:number;status:'COMPLETED'|'PENDING'|'WAITING'}[]}|null;
  request?:QuotationRequest;
  id: number; status: QuoteStatus; version: number; created_by: number; updated_at: string; duplicateOf?: number | null;
  quotation_number: string; customerId: number; customer_name: string; customerGstin: string; customerAddress: string; enquiryId: number | null;
  validUntil: string; placeOfSupply: string; sellerState: string; supplyType: 'DOMESTIC_STANDARD'; terms: string; notes: string;
  lines: QuoteLine[]; subtotal: string; cgst: string; sgst: string; igst: string; total: string; localTaxLabel: 'SGST' | 'UTGST';
  pricing?: Pricing;
}
export interface QuoteListRow extends Omit<Quotation, 'lines' | 'pricing'> { lines?: QuoteLine[] }
export interface QuoteEvent { id: number; action: string; reason: string; created_at: string; actor: string; version: number | null; public_detail?: Record<string, unknown> }
export interface QuoteVersion { version: number; reason: string; created_at: string; created_by: number }
export interface Policy { seller_state: string; revision: number; confirmed?: boolean; floor_percent?: string; margin_basis?: 'LINE_AND_TOTAL' | 'TOTAL'; letterhead: { name: string; address?: string; gstin?: string; email?: string; phone?: string } }
export interface PricingEvent extends QuoteEvent { private_detail: { before: unknown; after: unknown } }
export interface CostImportPlan { fingerprint: string; canSave: boolean; rows: { row: number; partCode: string; description: string; currentCost: string | null; unitCost: string; issues: string[] }[] }
export interface QuoteInput {
  companyId?:string;
  request?:QuotationRequest;
  customerId: number; enquiryId?: number | null; validUntil: string; placeOfSupply: string; supplyType: 'DOMESTIC_STANDARD'; terms: string; notes: string;
  lines: { customerPricing?:PricingBinding; pricingSelection?: {level:number;fingerprint:string}; itemId: number; description: string; quantity: string; unitPrice: string; discountPercent: string; taxPercent: string; requestDetails?:QuotationLineRequest }[];
  reason: string; version?: number;
}
export interface EnquirySource { id: number; customer_id: number; notes: string | null; lines: { item_id: number | null; description: string; quantity: string; target_price: string | null; part_code: string | null; uom: string | null }[] }

export const quotationsApi = (client: ApiClient) => ({
  list: (q: { page: number; search: string; status: string }, signal?: AbortSignal) => client.get<Paginated<QuoteListRow> & { legacyCount: number }>('/api/crm/quotations', { query: q, signal }),
  get: (id: number | string, signal?: AbortSignal) => client.data<Quotation>('GET', `/api/crm/quotations/${id}`, undefined, { signal }),
  history: (id: number | string, signal?: AbortSignal) => client.data<{ versions: QuoteVersion[]; events: QuoteEvent[] }>('GET', `/api/crm/quotations/${id}/history`, undefined, { signal }),
  policy: () => client.data<Policy | null>('GET', '/api/crm/quotation-policy'),
  cost: (itemId: number) => client.data<{ item_id: number; unit_cost: string | null }>('GET', `/api/crm/quotation-costs/${itemId}`),
  pricingHistory: (itemId?: string) => client.data<PricingEvent[]>('GET', itemId ? `/api/crm/quotation-costs/${itemId}/history` : '/api/crm/quotation-policy/history'),
  enquiry: (id: number | string) => client.data<EnquirySource>('GET', `/api/crm/quotation-enquiries/${id}`),
  create: (body: QuoteInput, idempotencyKey: string) => client.data<Quotation>('POST', '/api/crm/quotations', body, { idempotencyKey }),
  revise: (id: number, body: QuoteInput) => client.data<Quotation>('PUT', `/api/crm/quotations/${id}`, body),
  action: (id: number, body: { action: QuoteAction; version: number; reason: string; overrideFloor?: boolean;ownerSelfApproval?:boolean;roundId?:string;stageId?:string;requestKey?:string }) => client.data<Quotation>('POST', `/api/crm/quotations/${id}/actions`, body),
  duplicate: (id: number, reason: string) => client.data<Quotation>('POST', `/api/crm/quotations/${id}/duplicate`, { reason }),
  email: (id: number, body: { to: string; subject: string; message: string; version: number; reason: string }) => client.post<unknown>(`/api/quotations/${id}/send-email`, body),
  customer: (id: number) => client.data<{ id: number; name: string; gstin: string | null; profile: { state_code?: string | null }; contacts: { email?: string | null; is_primary?: number | boolean }[] }>('GET', `/api/crm/customers/${id}`),
  customers: (search: string) => client.get<Paginated<{ id: number; name: string; gstin: string | null }>>('/api/crm/customers', { query: { search, status: 'ACTIVE', pageSize: 20 } }),
  items: (search: string, signal?: AbortSignal) => client.get<Paginated<{ id: number; part_code: string; description: string; uom: string; hsn: string | null }>>('/api/crm/items', { query: { search, status: 'ACTIVE', pageSize: 20 }, signal })
});
export type QuotationsApi = ReturnType<typeof quotationsApi>;

export const EDITABLE: QuoteStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
export const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};
