'use client';

import { use } from 'react';
import { QuoteEditorView } from '@/features/quotations/quote-editor';

export default function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <QuoteEditorView key={id} id={id} />;
}
