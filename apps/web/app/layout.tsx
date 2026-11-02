import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/noto-sans-devanagari';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/workspace.css';
import { Providers } from './providers';
import { THEME_BOOT_SCRIPT } from '@/lib/preferences';

export const metadata: Metadata = {
  title: { default: 'ControlDesk', template: '%s · ControlDesk' },
  description: 'Mehta Siemens ControlDesk: CRM and workflow on top of Tally'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#0f172a' }, { media: '(prefers-color-scheme: dark)', color: '#0b1220' }] // check-tokens: allow (browser chrome matches navy workspace palette)
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
