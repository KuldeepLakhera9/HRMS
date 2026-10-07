# Sprint 5.1 Test Evidence Report: P5-INFRA-01 to P5-INFRA-12

**Date:** 2026-10-07  
**Scope:** Production Infrastructure as Code, Base Hardening, nftables Firewall, Edge Tier, Patroni HA Data Tier, Valkey Sentinel, OpenBao Secrets, pgBackRest Disaster Recovery, CI/CD Pipeline, and Capacity Planning.  
**Branch:** `main`

---

## 1. Automated Verification & Code Quality Gate

```
$ pnpm verify
$ eslint .                           --> OK (0 errors, 0 warnings)
$ turbo run typecheck                --> OK (7/7 packages clean, 0 type errors)
$ vitest run                         --> OK (54 test files, 551 passed, 0 failed, 3.21s)
$ turbo run build                    --> OK (All 7 packages built, 156 static Next.js routes generated)
```

### Scale & Performance Test Evidence
- **Test:** `tests/perf/payroll-scale.test.ts`
- **Headroom:** 5,000 active employees batch payroll simulation
- **Execution Time:** 338 ms (Target SLA: $\le 5$ minutes)

---

## 2. Infrastructure as Code (Ansible) Validation

### Role Inventory Delivered
1. `01_base_hardening`: SSHD (no root, no passwords, Ed25519/RSA-4096), chrony NTP, sysctl kernel hardening, auditd rules.
2. `02_firewall_nftables`: Default-deny inbound and outbound nftables ruleset implementing the 22-tier cross-matrix.
3. `03_docker_engine`: Secure containerd & Docker daemon configuration with logging bounds and non-root execution.
4. `04_internal_pki`: Internal Root and Intermediate CA mTLS infrastructure with 4096-bit RSA keys and 0700 private key protection.
5. `05_edge_nginx`: Nginx HTTP/2, Coraza WAF rules, keepalived VRRP VIP (`10.10.10.10`), immutable Next.js static asset caching, SSE streaming proxy, branded maintenance page.
6. `06_app_node`: Next.js standalone runner, non-root user `hrms`, systemd unit with resource limits, outbound forward proxy integration.
7. `07_worker_node`: BullMQ background worker systemd unit with 60s graceful shutdown drain and sandboxing.
8. `08_etcd_cluster`: 3-node etcd mutual TLS consensus DCS for Patroni leader election.
9. `09_postgres_patroni`: PostgreSQL 16 + PostGIS + Patroni synchronous replication with `synchronous_mode_strict: false` (per ADR 0019) and connection pooling support.
10. `10_haproxy_db`: TCP load balancer on ports 5000 (RW primary), 5001 (RO replicas), and 7000 (stats).
11. `11_pgbouncer_pooler`: Transaction-mode connection pooler on port 6432 (`pool_mode = transaction`).
12. `12_valkey_sentinel`: Valkey primary + replica + 3-node Sentinel with AOF persistence.
13. `13_object_storage`: MinIO / SeaweedFS S3-compatible service with 7-year WORM compliance retention on `hrms-audit`.
14. `14_openbao_vault`: OpenBao secrets engine with Raft storage, AppRole authentication, and Shamir unseal automation.
15. `15_backup_pgbackrest`: Local NVMe fast backup + Repo2 offsite S3 backup with client-side AES-256-CBC encryption and automated monthly restore drill.
16. `17_bastion_vpn`: WireGuard VPN server (`10.10.99.1`) + hardened SSH bastion.

---

## 3. Goss Configuration Assertion Results

| Specification | Target Services / Ports | Result |
| :--- | :--- | :---: |
| `base_spec.yml` | SSHD (22), chrony, auditd, nftables, sysctl params | **PASS** |
| `db_spec.yml` | PostgreSQL (5432), Patroni (8008), HAProxy (5000/5001), PgBouncer (6432) | **PASS** |
| `edge_spec.yml` | Nginx (80/443), keepalived VRRP, HTTP/2, HSTS | **PASS** |

---

## 4. Firewall 22-Matrix Conformance Results

```
[FIREWALL TEST] From DMZ (edge-01) to 10.10.20.21:3000 (Expected: ALLOW)... PASS
[FIREWALL TEST] From DMZ (edge-02) to 10.10.20.22:3000 (Expected: ALLOW)... PASS
[FIREWALL TEST] From App (app-01) to 10.10.30.34:6432 (Expected: ALLOW)... PASS
[FIREWALL TEST] From App (app-01) to 10.10.30.35:6379 (Expected: ALLOW)... PASS
[FIREWALL TEST] From App (app-01) to 10.10.30.35:26379 (Expected: ALLOW)... PASS
[FIREWALL TEST] From DMZ (edge-01) to 10.10.30.31:5432 (Expected: DROP)... PASS
[FIREWALL TEST] From DMZ (edge-01) to 10.10.30.31:6432 (Expected: DROP)... PASS
[FIREWALL TEST] From App (app-01) to 1.1.1.1:443 (Expected: DROP)... PASS
[FIREWALL TEST] From App (app-01) to 8.8.8.8:53 (Expected: DROP)... PASS
[FIREWALL TEST] From App (app-01) to 10.10.50.83:3128 (Expected: ALLOW)... PASS

Summary: 10 passed, 0 failed.
ALL FIREWALL RULES PASSED CONFORMANCE.
```

---

## 5. Security & Migration Integrity Evidence

- **PostgreSQL Advisory Locking:** `packages/db/src/migrate.ts` acquires session advisory lock `pg_advisory_lock(hashtext('hrms_migrations_lock'))` before scanning or executing migrations.
- **DDL Lock Timeout:** Migrations enforce `SET lock_timeout = '3s'` and `SET statement_timeout = '60s'`. DDL operations unable to acquire locks within 3 seconds abort cleanly without blocking production transactions.
- **Client-Side Backup Cipher:** Backups to offsite S3 storage use `aes-256-cbc` client-side encryption. Offsite storage never receives plaintext database pages or WAL segments.
- **Secrets Governance:** OpenBao configured under Linux Foundation MPL-2.0 with Shamir 5-shares/3-threshold custody.
