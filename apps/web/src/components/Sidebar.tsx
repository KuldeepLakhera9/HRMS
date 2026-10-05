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
  FileEdit,
  Bell,
  CheckSquare,
  Calendar,
  FileSpreadsheet,
  Megaphone,
  LifeBuoy,
  UploadCloud,
  Activity,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ size?: number; color?: string; className?: string }>;
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
      { title: 'Approvals Inbox', href: '/workflow/inbox', icon: CheckSquare },
      { title: 'Leave & Time Off', href: '/leave', icon: Calendar },
      { title: 'Reports & Analytics', href: '/reports', icon: FileSpreadsheet },
      { title: 'Announcements', href: '/announcements', icon: Megaphone },
      { title: 'Helpdesk', href: '/helpdesk', icon: LifeBuoy },
    ],
  },
  {
    title: 'ORGANIZATION',
    items: [
      { title: 'Employees', href: '/employees', icon: Users },
      { title: 'Attendance Shifts', href: '/attendance/shifts', icon: Clock },
      { title: 'Change Requests', href: '/admin/change-requests', icon: FileEdit },
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
      { title: 'User Management', href: '/admin/users', icon: Users },
      { title: 'Roles & Permissions', href: '/admin/roles', icon: ShieldCheck },
      { title: 'Security & Sessions', href: '/security', icon: ShieldCheck },
      { title: 'Notification Settings', href: '/settings/notifications', icon: Bell },
      { title: 'Audit Trail', href: '/audit-logs', icon: ScrollText },
      { title: 'Data Migration', href: '/migration', icon: UploadCloud },
      { title: 'Pilot Telemetry', href: '/pilot/metrics', icon: Activity },
    ],
  },
  {
    title: 'UPCOMING MODULES',
    items: [
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
        backgroundColor: 'var(--brand-dark, #063D27)',
        borderRight: '1px solid var(--sidebar-border, rgba(255, 255, 255, 0.08))',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--sidebar-border, rgba(255, 255, 255, 0.08))',
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
            background: 'var(--brand-secondary, #73992A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            boxShadow: '0 2px 8px rgba(115, 153, 42, 0.4)',
          }}
        >
          <ShieldCheck size={20} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em', color: '#FFFFFF' }}>
            AIC-ADT HRMS
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#A9C46C', fontWeight: 600, letterSpacing: '0.04em' }}>
            INCUBATION CENTRE
          </div>
        </div>
      </div>

      {/* Tenant Indicator */}
      <div
        style={{
          margin: '1rem 1rem 0.5rem',
          padding: '0.625rem 0.875rem',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '0.6875rem', color: '#A9C46C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active Campus
          </div>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#FFFFFF' }}>
            AIC-ADT Campus
          </div>
        </div>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--brand-secondary, #73992A)',
            boxShadow: '0 0 8px var(--brand-secondary, #73992A)',
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
                color: '#8CA08E',
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
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? '#FFFFFF' : isUpcoming ? '#8CA08E' : 'var(--sidebar-foreground, #E8EEE9)',
                      backgroundColor: isActive ? 'var(--brand-secondary, #73992A)' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                      cursor: isUpcoming ? 'default' : 'pointer',
                      opacity: isUpcoming ? 0.6 : 1,
                    }}
                  >
                    <Icon size={18} color={isActive ? '#FFFFFF' : isUpcoming ? '#8CA08E' : 'var(--sidebar-icon, #C7D7C5)'} />
                    <span style={{ flex: 1 }}>{item.title}</span>
                    {item.phase && (
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          color: '#A9C46C',
                        }}
                      >
                        {item.phase}
                      </span>
                    )}
                    {isActive && <ChevronRight size={14} color="#FFFFFF" />}
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
          borderTop: '1px solid var(--sidebar-border, rgba(255, 255, 255, 0.08))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          color: '#8CA08E',
        }}
      >
        <span>AIC-ADT Platform</span>
        <span
          style={{
            padding: '0.125rem 0.375rem',
            backgroundColor: 'rgba(115, 153, 42, 0.2)',
            color: '#A9C46C',
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
