'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  GitFork,
  Briefcase,
  Layers,
  ShieldCheck,
  Clock,
  CircleDollarSign,
  ScrollText,
  ChevronRight,
  MapPin,
  Network,
  Users,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
  phase?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAVIGATION: NavSection[] = [
  {
    title: 'OVERVIEW',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'ORGANIZATION',
    items: [
      { title: 'Employees', href: '/employees', icon: Users },
      { title: 'Org Chart', href: '/org/chart', icon: Network },
      { title: 'Work Locations', href: '/org/locations', icon: MapPin },
      { title: 'Departments', href: '/org/departments', icon: GitFork },
      { title: 'Designations', href: '/org/designations', icon: Briefcase },
      { title: 'Cost Centers', href: '/org/cost-centers', icon: Layers },
      { title: 'Company Settings', href: '/org/company', icon: Building2 },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { title: 'Security & Sessions', href: '/security', icon: ShieldCheck },
      { title: 'Audit Trail', href: '/audit-logs', icon: ScrollText },
    ],
  },
  {
    title: 'UPCOMING MODULES',
    items: [
      { title: 'Attendance', href: '#', icon: Clock, phase: 'Phase 2' },
      { title: 'Payroll & Tax', href: '#', icon: CircleDollarSign, phase: 'Phase 4' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #6366f1 0%, #38bdf8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
          }}
        >
          <ShieldCheck size={20} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em', color: '#fff' }}>
            OrgHub HRMS
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Enterprise Platform
          </div>
        </div>
      </div>

      {/* Tenant Indicator */}
      <div
        style={{
          margin: '1rem 1rem 0.5rem',
          padding: '0.625rem 0.875rem',
          backgroundColor: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 600, textTransform: 'uppercase' }}>
            Active Entity
          </div>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            OrgHub Tech Ltd
          </div>
        </div>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--success)',
            boxShadow: '0 0 8px var(--success)',
          }}
        />
      </div>

      {/* Navigation Sections */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.75rem 0.75rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {NAVIGATION.map((section, idx) => (
          <div key={idx}>
            <div
              style={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                letterSpacing: '0.05em',
                padding: '0 0.75rem',
                marginBottom: '0.375rem',
              }}
            >
              {section.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {section.items.map((item, itemIdx) => {
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href));
                const Icon = item.icon;
                const isUpcoming = !!item.phase;

                return (
                  <Link
                    key={itemIdx}
                    href={item.href}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? '#fff' : isUpcoming ? 'var(--text-muted)' : 'var(--text-secondary)',
                      backgroundColor: isActive ? 'var(--primary)' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                      cursor: isUpcoming ? 'default' : 'pointer',
                      opacity: isUpcoming ? 0.7 : 1,
                    }}
                  >
                    <Icon size={18} />
                    <span style={{ flex: 1 }}>{item.title}</span>
                    {item.phase && (
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {item.phase}
                      </span>
                    )}
                    {isActive && <ChevronRight size={14} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer System Info */}
      <div
        style={{
          padding: '1rem 1.25rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        <span>OrgHub Platform</span>
        <span
          style={{
            padding: '0.125rem 0.375rem',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--success)',
            borderRadius: '4px',
            fontWeight: 600,
          }}
        >
          v0.1.0 Alpha
        </span>
      </div>
    </aside>
  );
}
