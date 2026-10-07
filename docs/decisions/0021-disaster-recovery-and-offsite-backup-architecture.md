# ADR 0021: Disaster Recovery & Offsite Backup Architecture

## Status
Accepted

## Context
Data durability and business continuity for employee master records, statutory payroll archives, and immutable attendance punch logs must meet strict Recovery Point Objective ($RPO$) and Recovery Time Objective ($RTO$) targets without exposing unencrypted personal or financial data to offsite storage providers.

Target Objectives:
- **Single-Node Failure RPO:** $0$ (guaranteed by Patroni synchronous replication).
- **Catastrophic Site-Loss RPO:** $\le 15\text{ minutes}$.
- **Site-Loss RTO (Cold Restore):** $4 \text{ to } 8\text{ hours}$.

## Decision
We establish a **Dual-Repository Cold Restore Model** using **pgBackRest** paired with **Client-Side Encryption**:

1. **Local Repository (`repo1` - Backup Server on BACKUP VLAN):**
   - High-throughput direct backup from the synchronous standby node (`pg-02`), sparing the primary node from backup I/O.
   - Schedule: Weekly full backup (Sunday 01:00 UTC), Daily differential backup (Monday-Saturday 01:00 UTC), Continuous WAL streaming (`archive-async=on`, max 15-minute archive timeout).
   - Encryption: Client-side AES-256-CBC (`cipher-type=aes-256-cbc`) with passphrase injected at runtime via OpenBao.
2. **Offsite Repository (`repo2` - Remote Secondary Site / Controlled Cloud):**
   - Asynchronous WAL and differential backup mirroring to an offsite destination.
   - Client-side encryption ensures the remote storage host holds strictly encrypted ciphertext blocks.
   - The encryption passphrase is held exclusively within the physical Shamir split-custody envelopes, never stored on the remote target.
3. **Automated Restore Verification:**
   - A weekly automated test job restores the latest backup to a sandboxed scratch database instance, recomputes payslip SHA-256 hashes, and asserts zero corruption.

## Consequences
- Guarantees $RPO \le 15\text{ min}$ even if the primary data center experiences complete physical destruction.
- Guarantees zero data leakage on external offsite storage.
- Cold restore requires 4 to 8 hours to provision hosts and stream data; a warm standby site remains an optional phase 6 enhancement.
