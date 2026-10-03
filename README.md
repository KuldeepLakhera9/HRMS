# HRMS Platform (Production-Grade Self-Hosted Enterprise Edition)

A high-performance, multi-tenant-ready, self-hosted Human Resource Management System (Keka/greytHR class) engineered for deployment in private data center infrastructure.

---

## 1. 15-Minute Local Quickstart

### Prerequisites
- **Node.js**: v20+ Active LTS
- **pnpm**: v9+ (`corepack enable pnpm`)
- **Docker & Docker Compose**: For local PostgreSQL (PostGIS), Redis, and MinIO storage
- **Git**

### Step-by-Step Setup

```bash
# 1. Clone the repository and enter directory
cd HRMS

# 2. Install workspace dependencies
pnpm install

# 3. Setup environment configuration
cp .env.example .env

# 4. Spin up local infrastructure (PostgreSQL with PostGIS, Redis, MinIO)
pnpm infra:up

# 5. Run versioned database migrations as hrms_owner
pnpm db:migrate

# 6. Seed core system roles, organization structure, and admin credentials
pnpm db:seed

# Optional: Seed high-volume load dataset (5,000 employees)
pnpm seed:load

# 7. Start Next.js web application and background worker in development mode
pnpm dev
```

Visit the dashboard at `http://localhost:3000`.

---

## 2. Seed Credentials & Role Matrix

| Email | Password | Role | MFA Enforced | Access Level |
|---|---|---|---|---|
| `admin@orghub.internal` | `AdminPass123!` | `super_admin` | Yes | Unrestricted platform access |
| `hr@orghub.internal` | `HrPass123!` | `hr_manager` | Yes | Employee master, bulk import, org hierarchy |
| `accountant@orghub.internal` | `AccountantPass123!` | `accountant` | Yes | Financial records, salary structures, payouts |
| `manager@orghub.internal` | `ManagerPass123!` | `manager` | No | Team approvals, change requests, direct reports |
| `employee@orghub.internal` | `EmpPass123!` | `employee` | No | Employee self-service, profile, documents |
| `auditor@orghub.internal` | `AuditorPass123!` | `auditor` | No | Read-only compliance audit trail inspection |

---

## 3. Technology Stack

- **Runtime & Language**: TypeScript 5.8 (strict mode), Node.js Active LTS
- **Monorepo & Build**: Turborepo, pnpm workspaces
- **Frontend App**: Next.js 15 (App Router, Server Components default), React 19, Tailwind CSS, Lucide icons
- **Database**: PostgreSQL 16 + PostGIS + pg_trgm + citext
- **ORM & Migrations**: Drizzle ORM, drizzle-kit (hand-written SQL migrations with RLS policies and triggers)
- **Data Isolation**: Dual-layer tenant isolation (Repository company_id filter + PostgreSQL Row-Level Security `FORCE ROW LEVEL SECURITY`)
- **Cache & Queues**: Redis (ioredis), BullMQ background worker daemons
- **Object Storage**: S3-compatible MinIO via AWS SDK v3 with pre-signed upload URLs and magic-byte verification
- **Security & Crypto**: Argon2id password hashing, AES-256-GCM field encryption, HMAC-SHA256 blind indexing
- **Observability**: Prometheus text exposition at `/api/metrics`, pg pool stats, slow-query logging (>100ms)

---

## 4. Architecture Layers

```
apps/web (Next.js 15 App Router & API handlers)
   │
   ▼
packages/core (Pure TypeScript Domain Services & Authorization)
   ├── auth, rbac, employee, org, document, changerequest, customfield, bulk, notification, audit, metrics
   │
   ▼
packages/db (PostgreSQL Schemas, RLS Policies, Drizzle Models, withTenant Transaction Wrapper)
   ├── RLS enforced via set_config('app.company_id', $1, true)
   │
   ▼
PostgreSQL 16 (PgBouncer in transaction mode)
```

---

## 5. Key Verification Commands

```bash
# Verify TypeScript compilation and type safety
pnpm run typecheck

# Verify ESLint across all workspaces
pnpm run lint

# Run all unit tests (Vitest)
pnpm vitest run packages/

# Run k6 load performance benchmark (200 VUs)
k6 run tests/load/k6-sprint-1-4.js

# Production build verification
pnpm run build
```

---

## 6. Documentation Directory

- [PHASE1_SPEC.md](file:///c:/Kuldeep's%20Work/Projects/HRMS/docs/PHASE1_SPEC.md) - Exact Phase 1 scope and requirements
- [HRMS_Phase_Plan.md](file:///c:/Kuldeep's%20Work/Projects/HRMS/docs/HRMS_Phase_Plan.md) - Master roadmap, gates, and tasks
- [RUNBOOK.md](file:///c:/Kuldeep's%20Work/Projects/HRMS/docs/RUNBOOK.md) - Operational runbook, monitoring, and backups
- [MIGRATION_GUIDE.md](file:///c:/Kuldeep's%20Work/Projects/HRMS/docs/MIGRATION_GUIDE.md) - Database migration rules and procedures
- [GATE_G1_REPORT.md](file:///c:/Kuldeep's%20Work/Projects/HRMS/docs/GATE_G1_REPORT.md) - Phase 1 Gate G1 Closure and Verification Evidence
