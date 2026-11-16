'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CardSkeleton } from '@/components/ds';
import { QuoteEditorView } from '@/features/quotations/quote-editor';

function NewQuotation() {
  const params = useSearchParams();
  const enquiry = params.get('enquiry');
  const customer = params.get('customerId') || params.get('customer');
  return <QuoteEditorView key={`${enquiry || ''}:${customer || ''}`} enquiryId={enquiry} customerId={customer} />;
}

export default function NewQuotationPage() { return <Suspense fallback={<CardSkeleton />}><NewQuotation /></Suspense>; }
