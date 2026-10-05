import type { Metadata } from 'next';
import React from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIC-ADT HRMS - Incubation & Innovation Platform',
  description: 'Enterprise HRMS platform for AIC-ADT, built for performance, security, and scalability.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
