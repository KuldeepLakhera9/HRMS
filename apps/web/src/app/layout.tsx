import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'OrgHub HRMS - Production Core Platform',
  description: 'Enterprise HRMS platform built for performance, security, and scalability.',
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
