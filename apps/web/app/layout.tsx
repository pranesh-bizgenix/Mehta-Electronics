import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui';
import './styles.css';

export const metadata: Metadata = {
  title: 'Mehta ControlDesk',
  description: 'ControlDesk CRM and workflow platform'
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#185c40' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
