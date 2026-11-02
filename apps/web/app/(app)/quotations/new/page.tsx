'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CardSkeleton } from '@/components/ds';
import { QuoteEditorView } from '@/features/quotations/quote-editor';

function NewQuotation() {
  const enquiry = useSearchParams().get('enquiry');
  return <QuoteEditorView enquiryId={enquiry} />;
}

export default function NewQuotationPage() { return <Suspense fallback={<CardSkeleton />}><NewQuotation /></Suspense>; }
