# PRODUCTION INFRASTRUCTURE REFERENCE

Reference for the agent (to write code and tests) and for the operations team (to build and run). Parameter values are **starting points**: verify against the current official documentation of each component and version, then tune with measurements. Nothing here is applied to production by the agent.

## 1. Topology
```
Internet / Employees' phones and laptops
        |
  ISP link A + link B  -->  Edge firewall (default deny; 443 in; 80 only for redirect)
        |
  [ DMZ VLAN ]  edge-01, edge-02   Nginx + WAF + keepalived (virtual IP), static asset caching, maintenance page
        |
  [ APP VLAN ]  app-01, app-02 (Next.js, Docker)   worker-01, worker-02 (BullMQ)   pgbouncer on each app/worker host
        |
  [ DATA VLAN ] pg-01 (primary) pg-02 (sync standby) pg-03 (replica)   etcd-01..03   haproxy-01..02 (+VIP)
                redis-01 (primary) redis-02 (replica) sentinel x3     minio-01..04 (erasure coded)     vault-01..03
        |
  [ BACKUP VLAN ] backup-01 (pgBackRest repo1, object backups, config backups)  -->  offsite encrypted copy (repo2)
  [ MGMT VLAN ]  bastion + VPN, monitoring (Prometheus, Alertmanager, Grafana, Loki), CI runner, registry, egress proxy, internal CA/NTP/DNS
```
Notes: PostgreSQL, Redis, MinIO and Vault have no route from the internet. App nodes reach data nodes only on the listed ports. Admins enter through VPN then bastion. Etcd must be on separate hosts/failure domains from the database members when possible (at minimum separate VMs on different hypervisor hosts). Spread replicas across different physical hosts/racks.

## 2. Sizing (starting points, validate by load test)
| Tier | ~500 employees | ~2,000 | ~5,000 |
|---|---|---|---|
| Edge (2 nodes) | 2 vCPU, 4 GB each | 4 vCPU, 8 GB | 4 vCPU, 8 GB |
| App (2 nodes) | 4 vCPU, 8 GB each | 8 vCPU, 16 GB | 8 vCPU, 16 GB (3 nodes) |
| Worker (1-2) | 4 vCPU, 8 GB | 8 vCPU, 16 GB | 8 vCPU, 16 GB x2 |
| PostgreSQL (3) | 4 vCPU, 16 GB, NVMe 200 GB | 8 vCPU, 32 GB, NVMe 500 GB | 16 vCPU, 64 GB, NVMe 1 TB |
| etcd (3) | 2 vCPU, 4 GB SSD | same | same |
| Redis (2 + 3 sentinels) | 2 vCPU, 4 GB | 4 vCPU, 8 GB | 4 vCPU, 8 GB |
| MinIO (4) | 4 vCPU, 8 GB, 2 TB each | 4 TB each | per document volume |
| Backup | 3-5x DB size | same | same |
| Monitoring/CI/registry | 4 vCPU, 16 GB | 8 vCPU, 32 GB | 8 vCPU, 32 GB |
Scale-out triggers (documented and alerted): CPU > 65% sustained at peak, p95 over SLO for 3 days, DB cache hit ratio < 98%, pool waiting clients > 0 regularly, disk > 70%, queue age > 5 min at peak, WAL generation approaching archive throughput.

## 3. Network, firewall and egress
Default deny everywhere; rules as code with automated allow/deny tests.
| From | To | Port/proto | Purpose |
|---|---|---|---|
| Internet | edge VIP | 443/tcp (80 redirect) | Web and mobile API |
| edge | app nodes | 3000/tcp (app), realtime route same | Proxy |
| app/worker | pgbouncer (local) | 6432/tcp | DB access |
| pgbouncer | haproxy VIP | 5000/tcp (primary), 5001 (replicas) | DB routing |
| haproxy | pg nodes | 5432/tcp, 8008/tcp (Patroni REST health) | Backend and health |
| pg nodes | pg nodes | 5432/tcp | Replication |
| pg nodes | etcd | 2379/tcp | Patroni DCS |
| etcd | etcd | 2380/tcp | Peer |
| app/worker | redis / sentinel | 6379, 26379/tcp | Cache, queues, pub/sub |
| redis | redis | 6379, 26379/tcp | Replication |
| app/worker | minio | 9000/tcp | Objects |
| app/worker | vault | 8200/tcp | Secrets |
| pg nodes, minio, app | backup-01 | pgBackRest TLS port / SSH, 9000 | Backups |
| backup-01 | offsite | 443 or SSH | Encrypted offsite copy |
| monitoring | all hosts | 9100 (node), 9187 (postgres), 9127 (pgbouncer), 9121 (redis), 9113 (nginx), minio metrics | Scrape |
| all hosts | loki | 3100/tcp | Logs |
| VPN/bastion | all | 22/tcp (from bastion only) | Admin |
| app/worker | egress proxy | 3128/tcp | Outbound allow-list |
| egress proxy | allow-listed FQDNs only | 443, 587 | FCM/APNs, Google APIs for attestation, SMTP relay, package mirrors, ACME |
| all hosts | NTP/DNS (internal) | 123/udp, 53 | Time and names |
Egress allow-list is reviewed quarterly. Employees' personal devices never reach MGMT or DATA VLANs.
If the organization considers a third-party CDN/WAF in front (TLS terminated by a third party), record it as a conscious data-flow decision with legal review; the default design keeps all traffic inside your infrastructure and relies on ISP-level DDoS protection.

## 4. Host hardening baseline (automate and test)
- Minimal OS install; only required packages; automatic security updates with reboot windows; kernel and package inventory (SBOM for hosts).
- SSH: keys only, no root login, MFA at VPN/bastion, idle timeout, allowed users by group, session logging; sudo with logging; no shared accounts; break-glass accounts sealed.
- nftables default-deny inbound and outbound with explicit allows; fail2ban on edge and bastion; disabled unused services and kernel modules; `sysctl` hardening; time sync (chrony) with drift alert.
- auditd rules for privileged commands, changes to `/etc`, SSH, sudo; logs forwarded to Loki and retained per policy.
- LUKS for data volumes (DB, MinIO, backup, logs, Vault storage); documented unlock procedure after reboot (key custody, no keys stored on the same disk unprotected); verify encrypted status by test.
- Containers: non-root user, read-only root filesystem with explicit tmpfs, drop all capabilities then add only needed, `no-new-privileges`, default seccomp, memory/CPU limits, no host networking or privileged mode, pinned image digests, signed images, base images minimal and scanned.
- File permissions for secrets (0400), no secrets in environment dumps/logs, Vault agent or sealed credentials delivered at start.

## 5. Component configuration guidance
### 5.1 PostgreSQL (primary parameters to review; tune by measurement)
| Area | Guidance |
|---|---|
| Memory | `shared_buffers` about 25% of RAM; `effective_cache_size` 50-75% of RAM; small `work_mem` (4-16 MB) because many connections can multiply it; `maintenance_work_mem` 512 MB-2 GB; `huge_pages` try on |
| Connections | `max_connections` low (100-200) because PgBouncer pools; separate role limits; superuser reserved connections |
| WAL/checkpoints | `wal_level=replica`; `archive_mode=on` with pgBackRest `archive-push`; `checkpoint_timeout` 10-15 min; `max_wal_size` sized to avoid frequent forced checkpoints; `wal_compression=on`; `wal_keep_size`/slots per Patroni |
| Storage | `random_page_cost` about 1.1 on NVMe; `effective_io_concurrency` per hardware; XFS or ext4 with noatime; dedicated WAL volume if possible |
| Autovacuum | Keep on; lower scale factors for high-churn tables (sessions, notifications, outbox, idempotency_keys, presence); monitor dead tuples and XID age; consider `fillfactor` for update-heavy tables |
| Logging | `log_min_duration_statement` 200-500 ms in production, `auto_explain` with sampling and threshold, `log_lock_waits=on`, `log_temp_files`, `log_connections` off (volume) but `log_disconnections` optional; ship logs to Loki with PII scrubbing |
| Safety | role-level `statement_timeout` and `idle_in_transaction_session_timeout` (API short, worker/report longer); `lock_timeout` for migrations; `pg_stat_statements` on |
| Security | `scram-sha-256`, TLS for client and replication, `pg_hba.conf` allowing only the pooler/HAProxy/replica addresses, owner/app/worker/readonly/backup roles separated, no superuser for apps, RLS forced |
| Extensions | PostGIS, pg_trgm, citext, btree_gist, pgcrypto, pg_stat_statements; same major/minor versions on all nodes; test extension upgrades in staging |
### 5.2 Patroni, etcd, HAProxy, PgBouncer
- Patroni: `synchronous_mode` on (one synchronous standby); decide `synchronous_mode_strict` consciously (strict blocks writes if no synchronous standby is available, safer for data, riskier for availability) and record in an ADR; `maximum_lag_on_failover` set; `pg_rewind` enabled; replication slots managed; watchdog if available; document `ttl`, `loop_wait`, `retry_timeout` and test that failover meets the target; planned switchover procedure for maintenance.
- etcd: 3 members, TLS, backups, separate disks, defragmentation schedule, alert on leader changes.
- HAProxy: health checks via Patroni REST (`/primary`, `/replica`), two frontends (read-write, read-only), connection draining on switchover, stats endpoint protected.
- PgBouncer: transaction pooling, `default_pool_size` sized from measured concurrency, `max_client_conn` generous, `server_idle_timeout`, protocol-level prepared statement support enabled if the version supports it and the driver uses it; application uses only `SET LOCAL`/`set_config(..., true)` inside transactions; `reserve_pool` configured; alert on waiting clients.
### 5.3 pgBackRest
- Full weekly, differential daily, continuous WAL archiving (`archive-async` on), compression, **repository encryption**, two repositories (local backup host + offsite), retention policy (for example full 4 weeks, WAL for PITR window of at least 14 days, long-term monthly retention per legal requirements), backup from a standby to spare the primary, backup verification (`check`, `verify`), automated restore tests weekly into a scratch instance, restore procedure documented for PITR, full, and single-database cases. The stanza and encryption passphrase live in Vault with separate custody copies.
### 5.4 Redis, MinIO, Vault
- Redis: AOF `everysec`, Sentinel quorum 2 of 3, `maxmemory` with `noeviction` for queues (separate instance or database for cache with LRU eviction), TLS and ACL users per service, memory alerts. Queue state must survive restarts.
- MinIO (or chosen store): erasure coding, TLS, bucket policies private, versioning on, **object lock (WORM)** for payroll/statutory/audit exports with retention, lifecycle rules (selfie retention), replication/mirroring offsite, per-service access keys with least privilege, server-side encryption with KMS integration (Vault) if supported.
- Vault: integrated storage (Raft) 3 nodes, TLS, audit device on, AppRole/agent for services, short-lived DB credentials if feasible, Shamir unseal keys split among custodians (documented ceremony, sealed envelopes or hardware tokens), periodic snapshot to backup, rotation schedule.
### 5.5 Nginx edge and WAF
- Modern TLS only, HSTS, secure headers (app also sets CSP with nonce), request/body limits per location, rate-limit zones (login, auth, punch, export, upload, general API), `limit_conn`, upstream keepalive, `proxy_next_upstream` limited to idempotent requests, health checks, maintenance page via `error_page 503` and a switch file, real client IP handling (trusted proxies only), access logs structured with request ID.
- WAF: start in detection-only mode during UAT, tune false positives (for example rich-text announcements, file uploads), then enforce; keep an exceptions register reviewed monthly.
- Static assets: long-lived immutable caching; HTML never cached publicly; compress text assets.

## 6. Deployment and migration procedure
1. CI builds, tests, scans, signs images; deploys to staging; smoke + e2e + ZAP baseline pass.
2. Change record created (what, why, risk, rollback, window, approver). Freeze windows: payroll calculation/lock, bank file generation, statutory due dates, month-end attendance lock.
3. **Expand migration** (owner role, `lock_timeout` 3-5 s, `statement_timeout` bounded, indexes `CONCURRENTLY`, no table rewrites during business hours, batched backfills) runs first and must be compatible with the currently running app version (N-1 rule).
4. Rolling app deploy: take node out of the load balancer (drain), pull signed image, start, health/readiness check, smoke test on the node, return to rotation, next node. Workers drain jobs gracefully (finish or re-queue).
5. Post-deploy checks: synthetic probes, error rate and latency watch for 15 minutes, queue health.
6. Automatic rollback to the previous image if health checks or error-rate thresholds fail; database remains compatible by construction.
7. **Contract migration** (drop/rename) only in a later release after the new version is stable; never in the same release as the expand.
8. Hotfix lane for urgent fixes with the same gates and a post-hoc regression test.

## 7. Failure and chaos drill catalogue (each drill: hypothesis, steps, expected result, measured result, data-integrity check, sign-off)
| # | Drill | Expected behavior |
|---|---|---|
| 1 | Kill PostgreSQL primary under load | Patroni promotes the synchronous standby; zero committed-data loss; apps reconnect within 30 s; alert fires; old primary rejoins via pg_rewind |
| 2 | Planned switchover | No failed requests beyond budget |
| 3 | Kill a replica / etcd member | No user impact; alerts fire; recovery documented |
| 4 | Lose 2 of 3 etcd members | Patroni demotes safely (documented behavior); recovery runbook works |
| 5 | Restart HAProxy/PgBouncer | Brief blip; retries succeed |
| 6 | Redis primary kill | Sentinel failover; app falls back for sessions; queue integrity preserved |
| 7 | MinIO node loss and drive loss | Reads/writes continue (erasure coding); alert; heal verified |
| 8 | App node loss / edge node loss | Load balancer/VIP moves traffic; error spike within budget |
| 9 | Network partition app-DB | Clear errors, no data corruption, queued punches on devices sync after recovery |
| 10 | Disk fill simulation on DB and logs | Alerts at 80/90%; runbook frees space; no corruption |
| 11 | Vault sealed / unavailable | Running services continue with cached credentials; restart path documented |
| 12 | DNS failure, NTP drift, certificate expiry (simulated) | Alerts fire early; documented fix |
| 13 | Worker crash during payroll calculate and during lock | Resume with no duplicate effects; run hash verified |
| 14 | SMTP and push provider outage | Queued with retry; no user-facing failures beyond notification delay |
| 15 | PITR restore to a timestamp between two known writes | Exactly the writes before the timestamp present; integrity hashes verify |
| 16 | Full restore to clean hosts from offsite only | Meets RTO/RPO; payslip and run hashes verify; ledger/YTD reconcile |
| 17 | Site-loss tabletop plus technical restore | Timed, gaps recorded and fixed |
| 18 | Security incident tabletop (credential leak, ransomware on app host) | Roles, comms, containment steps exercised; breach notification clock understood |

## 8. SLOs (initial; adjust with data)
| SLI | SLO |
|---|---|
| Availability of web and API (excluding announced maintenance) | 99.9% monthly |
| Punch API success (valid requests) | 99.95% monthly |
| API latency p95 | read <= 200 ms, write <= 400 ms, punch <= 300 ms (10-minute windows) |
| Page experience (RUM) | LCP p75 <= 2.5 s, INP p75 <= 200 ms |
| Payroll run completion | calculation <= 5 min for 5,000 employees; lock <= 3 min |
| Backup freshness | WAL archive age <= 15 min; last successful full <= 8 days; restore test within 7 days |
| Durability | RPO 0 for single-node failure; <= 15 min for site loss |
| Recovery | automatic DB failover <= 60 s; site loss RTO 4-8 h (cold) |
Error-budget policy: if the monthly budget is exhausted, feature work pauses and reliability work takes priority until recovered.

## 9. Degradation matrix (dependency down -> behavior)
| Dependency | Behavior | Alert |
|---|---|---|
| Redis | Sessions/permissions fall back to PostgreSQL (slower); rate limiting falls back to per-node in-memory limits; queues pause; SSE reconnects; no data loss | Page |
| PostgreSQL primary | Brief unavailability during failover; writes fail clearly; mobile punch queue holds events; read-only mode if failover fails | Page |
| PostgreSQL replicas (read) | Reports and read-only queries fall back to primary within limits | Ticket |
| MinIO | Uploads/downloads fail with clear message; punches without selfie follow policy; payslip PDFs queue; core flows continue | Page |
| SMTP | Notifications queue and retry; in-app unaffected | Ticket |
| Push provider | In-app and email continue; retry with backoff | Ticket |
| Attestation provider | Cached attestation validity continues; new device registrations paused with message | Ticket |
| ClamAV | New uploads held as pending until scanned; existing files unaffected | Ticket |
| Vault | Running services continue; new deployments blocked | Page |
| Worker pool | Jobs accumulate; user-facing writes continue; payroll jobs resume | Page when queue age exceeds threshold |
| Edge node | VIP moves to the other node | Page |

## 10. Runbook index (each uses the template below; stored in `docs/runbooks/`)
Platform: deploy, rollback, hotfix, maintenance mode on/off, rebuild a failed app node, rebuild a failed edge node, certificate renewal/rotation, DNS change, NTP drift, disk full, host patching and reboot sequence.
Database: primary failure, planned switchover, replica rebuild, etcd member replacement, PITR restore, full restore, WAL archive failing, replication lag, long-running transaction/lock pile-up, bloat and vacuum emergency, XID wraparound prevention, PgBouncer saturation, major/minor upgrade, extension upgrade.
Data stores: Redis failover, queue backlog or dead-letter handling, MinIO node/drive replace, object restore, storage full.
Security: suspected account compromise, credential/secret leak and rotation, key-custody recovery ceremony, WAF false positive handling, DDoS or abuse, personal-data-breach response (with notification clock), access review, break-glass use.
Application: attendance close-day failure, partition maintenance failure, device reset and attestation outage, period unlock, leave ledger mismatch, report failure, payroll run stuck/crashed, payroll unlock, bank file regeneration, statutory output mismatch, correction run, opening balance import, notification outage, SSE/real-time problems, mobile forced-update.
Template: Title / Purpose / Severity and impact / Detection (alerts, symptoms) / Preconditions and access needed / Diagnosis steps (commands, queries) / Resolution steps / Verification / Rollback / Escalation / Communication / Post-incident tasks / Last tested date and owner.

## 11. Alert catalogue (rules as code; each has severity, owner, runbook link, staging firing test)
Infrastructure: host down; disk > 80/90%; inode > 80%; memory pressure; CPU sustained > 85%; NTP drift; certificate expiry < 21 and < 7 days; keepalived VIP flap; unexpected reboot.
PostgreSQL: primary absent; failover occurred; replication lag > 30 s or 5 MB; WAL archive failing or age > 15 min; connections > 80%; transactions longer than 5 min; idle-in-transaction; deadlocks; autovacuum lagging; XID age high; cache hit ratio low; slow query spike; replication slot bloat; etcd leader changes; PgBouncer waiting clients > 0 for 1 min.
Redis/MinIO/Vault: Redis down, replication broken, memory > 80%, evictions on queue instance; MinIO drive offline, capacity > 75%, heal backlog; Vault sealed, audit device failing.
Application: 5xx rate > 1% for 5 min; p95 above SLO for 10 min; event-loop lag; container restarts; queue depth and oldest-job age; dead-letter growth; SSE connection errors; RUM LCP/INP regression.
Business: punch rejection or flag rate spike by reason code; nightly attendance close missing; leave ledger/balance mismatch; payroll run stuck in calculating/locking > 30 min; report failures; bank file generation errors; statutory due date approaching.
Security: failed-login spike; MFA failure spike; role/permission change outside change window; mass export; unusual salary-view volume; new admin created; WAF block spike; Vault access anomaly; privileged SSH session outside window.
Backup: no successful full in 8 days; no differential in 26 h; WAL archive gap; offsite sync lag; automated restore test failed; object-store replication lag.
Synthetic/external: login flow failing; punch probe failing; payslip fetch failing; mobile config probe failing; TLS check failing.
