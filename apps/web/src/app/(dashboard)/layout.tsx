import React from 'react';
import { Sidebar } from '../../components/Sidebar';
import { Header } from '../../components/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Fixed Left Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div
        style={{
          marginLeft: 'var(--sidebar-width)',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <Header />
        <main
          style={{
            flex: 1,
            padding: '2rem',
            maxWidth: '1440px',
            width: '100%',
            margin: '0 auto',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
