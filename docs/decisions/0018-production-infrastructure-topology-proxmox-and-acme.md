# ADR 0018: Production Infrastructure Topology - Proxmox VE, Dual Network & ACME DNS-01 PKI

## Status
Accepted

## Context
Phase 5 production deployment requires firm virtualization, network, and certificate boundaries based on the agreed Phase 5.0 operational criteria:
1. Virtualization hypervisor stack and clustering quorum.
2. TLS certificate trust model for public employee personal mobile devices vs. internal node-to-node mesh.
3. Concurrency baseline and k6 load testing formulas for morning punch rushes and portal viewer peaks.
4. Mobile GPS geofencing network requirements.
5. Offsite backup encryption custody.

## Decision

### 1. Virtualization Platform
- **Proxmox VE (Debian-based):** 3-node physical hypervisor cluster with Corosync clustering and live VM migration. If only 2 physical hypervisor hosts are provisioned, a lightweight external Corosync Quorum Device (QDevice / Raspberry Pi / Bastion VM) will be deployed to guarantee strict quorum and prevent split-brain.
- Storage: Dedicated NVMe ZFS pools per host, or Ceph storage network if 10GbE interconnect is available.

### 2. Dual-Layer PKI & Certificate Architecture
- **Public Employee-Facing FQDN (`hrms.<domain>`):** Provisioned via **Let's Encrypt ACME DNS-01** challenges. This ensures native trust across all unmanaged employee personal Android and iOS devices without requiring manual Root CA distribution. Automated certificate renewal will be monitored with Prometheus alerts at 21 days and 7 days prior to expiration.
- **Internal Cluster Communication:** Dedicated **Internal Enterprise Root CA** (managed via OpenBao / cfssl) issuing mTLS certificates strictly for intra-node communication:
  - etcd 3-node cluster peer & client mTLS (2379/2380)
  - Patroni REST API mutual TLS (8008)
  - PostgreSQL replication stream TLS (5432)
  - OpenBao Raft peer communication (8201)
  - Prometheus metrics scraper mutual TLS

### 3. Concurrency Model & k6 Load Calculation
- **Headroom Design Capacity:** 5,000 active employees.
- **Peak Arrival Window:** 80% of total staff punch within a 30-minute window (1,800 seconds).
  $$\text{Baseline Punch QPS} = \frac{0.80 \times 5000}{1800} \approx 2.22 \text{ punches/second}$$
- **k6 Load Target (with 3x burst margin):**
  $$\text{Target Punch QPS} = 3 \times 2.22 = 6.67 \text{ punches/second sustained}$$
  Spike test target: 10x burst = 22.2 punches/second for 2 minutes.
- **Concurrent Portal Viewers:** 300 simultaneous web/mobile sessions querying calendars, announcements, and dashboards while punch load runs.

### 4. Geofencing & Network Access
- Attendance geofencing is strictly mobile GPS-based (device latitude/longitude verified against DB polygon with PostGIS `ST_DWithin` and accuracy radius). Corporate static egress IPs are not required for mobile phone check-ins.
- Web punch: If permitted by policy, restricted to trusted corporate CIDRs; otherwise disabled by default.

### 5. Offsite Backup Cipher Model
- `pgBackRest repo2` (offsite) and remote object replicas use **client-side encryption** (`cipher-type=aes-256-cbc`). The remote destination (secondary DC, remote NAS, or cloud bucket) stores only ciphertext blocks.
- Passphrases and encryption keys are managed strictly through the documented Shamir key-custody process, never stored on the offsite target.
