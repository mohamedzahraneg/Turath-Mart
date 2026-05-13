import React from 'react';
import type { Metadata, Viewport } from 'next';
import '../styles/tailwind.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import AppUpdateChecker from '@/components/AppUpdateChecker';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://turathmasr.com';
const SITE_NAME = 'تراث مصر';
const APP_NAME = 'Turath Masr';
const DESCRIPTION =
  'نظام إدارة متكامل لشركة Turath Masr لتسجيل الأوردرات وتتبع الشحن وإدارة المخزون والتقارير المالية.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: APP_NAME,
  title: {
    default: `${APP_NAME} — نظام إدارة الشحن`,
    template: `%s • ${APP_NAME}`,
  },
  description: DESCRIPTION,
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
  },
  // Internal staff tool — keep it out of search engines and social previews.
  // Public customer pages (e.g. /track/[orderId]) can opt back in by exporting
  // their own `metadata.robots` override.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${APP_NAME} — نظام إدارة الشحن`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary',
    title: `${APP_NAME} — نظام إدارة الشحن`,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <AuthProvider>
          <NotificationProvider>
            <AppUpdateChecker />
            {children}
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
