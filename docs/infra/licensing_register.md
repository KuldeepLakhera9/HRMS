# Open Source Licensing Register & Intellectual Property Compliance

## 1. Compliance Statement
The HRMS platform is an enterprise-grade, self-hosted proprietary platform designed for on-premises deployment. All third-party libraries, container images, orchestrators, databases, and dependencies have been vetted against strict licensing criteria.

**Key Invariants:**
1. **Zero Viral Copyleft in Application Core:** No GPL-v3 or AGPL-v3 code is statically linked or imported into the TypeScript application codebase (`@hrms/core`, `@hrms/db`, `@hrms/web`, `@hrms/worker`, `@hrms/shared`).
2. **Permissive Runtime:** The core runtime consists solely of MIT, Apache-2.0, BSD-2/3-Clause, and PostgreSQL License components.
3. **Stand-alone Server Isolation:** Infrastructure daemons (e.g., Linux Kernel, Nginx, PostgreSQL, nftables, WireGuard) run strictly as independent OS-level network daemons communicating across standard protocol boundaries (TCP/IP, HTTP, Postgres Wire Protocol).

---

## 2. Infrastructure & Data Tier License Inventory

| Component | Upstream Project | License | Status & Analysis |
| :--- | :--- | :--- | :--- |
| **PostgreSQL 16** | PostgreSQL Global Development Group | PostgreSQL License (MIT-style) | Fully compliant. Permissive. |
| **PostGIS** | PostGIS Project | GPL-2.0-or-later (server extension) | Compliant. Runs inside PostgreSQL daemon; no app linking. |
| **Patroni** | Zalando SE | MIT License | Fully compliant. Distributed HA orchestrator. |
| **etcd** | Cloud Native Computing Foundation (CNCF) | Apache-2.0 | Fully compliant. Consensus backend. |
| **HAProxy** | HAProxy Technologies | GPL-2.0 (core) / LGPL-2.1 (library) | Compliant. Independent TCP proxy daemon. |
| **PgBouncer** | PgBouncer Community | BSD-2-Clause | Fully compliant. Connection pooler. |
| **pgBackRest** | pgBackRest Development Team | MIT License | Fully compliant. Backup engine. |
| **Valkey 7.2+** | Linux Foundation | BSD-3-Clause | Fully compliant. True open-source fork replacing Redis SSPL. |
| **OpenBao 2.x**| Linux Foundation | Mozilla Public License 2.0 (MPL-2.0)| Fully compliant. Community fork replacing Vault BSL. |
| **MinIO** | MinIO Inc. | AGPL-v3 (server binary) | Compliant via isolated network S3 protocol boundaries. |
| **Nginx** | F5 / Nginx Inc. | 2-clause BSD-like | Fully compliant. Edge reverse proxy. |
| **Keepalived** | Keepalived Project | GPL-2.0 | Compliant. VRRP daemon for VIP failover. |
| **Coraza WAF** | OWASP Foundation | Apache-2.0 | Fully compliant. Next-gen WAF engine. |
| **WireGuard** | Jason A. Donenfeld | GPL-2.0 (kernel) / MIT | Compliant. Kernel networking module. |

---

## 3. Node.js & Application Dependency Registry

| Package | Purpose | Declared License |
| :--- | :--- | :--- |
| **Node.js 20 LTS** | Runtime environment | MIT / Node.js License |
| **Next.js 14+** | Web application framework | MIT License |
| **React 18+** | User interface rendering | MIT License |
| **Drizzle ORM** | PostgreSQL ORM & query builder | Apache-2.0 |
| **pg (node-postgres)**| Native PostgreSQL driver | MIT License |
| **ioredis** | Redis/Valkey client | MIT License |
| **BullMQ** | Background job queueing | MIT License |
| **Zod** | Schema validation | MIT License |
| **Pino** | High-performance JSON logger | MIT License |
| **Argon2** | Password hashing | MIT License |
| **@aws-sdk/client-s3**| S3 object client | Apache-2.0 |

---

## 4. Verification Check
- Automated CI pipeline runs `pnpm licenses list` and dependency scanners to enforce that no copyleft dependencies enter application bundles.
- All container base images use official Debian Bookworm (`debian:bookworm-slim`) and Alpine (`alpine:latest`) distributions.
