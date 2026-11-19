import {notFound} from 'next/navigation';
import type {ReactNode} from 'react';
import {emailAutomationEnabled} from '@/features/email-automation/config';
export const dynamic = 'force-dynamic';
export default function EmailAutomationLayout({children}:{children:ReactNode}) {
  if(!emailAutomationEnabled()) notFound();
  return children;
}
