# HRMS Infrastructure Capacity Plan & Sizing Model

## 1. Executive Summary & Design Headroom
This document establishes the compute, memory, storage IOPS, and network bandwidth sizing model for the self-hosted HRMS platform.
- **Baseline Target:** 5,000 active employees (design headroom).
- **Peak Concurrency:** 80% of staff punch within a 30-minute window ($4,000 / 1,800\text{ s} \approx 2.22\text{ punches/s}$ baseline, with a $3\times$ burst margin targeting $6.67\text{ punches/s}$ sustained and $20\text{–}22\text{ punches/s}$ burst spikes).
- **Interactive Portal Concurrency:** 300 active simultaneous web/mobile portal sessions during peak shift changes.
- **Hypervisor Infrastructure:** 3-node clustered Proxmox VE with Ceph or local replicated NVMe ($N+1$ host resilience: any single hypervisor can fail with remaining two running $<80\%$ utilization).

---

## 2. Workload & Transaction Metrics

| Workload Component | Volume / Rate | Target Latency Budget | Query / DB Budget |
| :--- | :--- | :--- | :--- |
| **Punch Ingestion (API)** | 2.22 sustained / 22 peak / sec | p95 $\le 100\text{ ms}$ | $\le 4$ SQL queries (auth + geofence + punch + audit) |
| **Portal Dashboard View** | 300 concurrent users | p95 $\le 200\text{ ms}$ | $\le 6$ SQL queries (cached org/rules in Redis) |
| **Payroll Processing Run** | 5,000 employees in batch | $\le 60\text{ seconds}$ total | BullMQ partitioned workers |
| **Document Uploads** | Up to 10 MB per payload | Transfer limited | S3 direct streaming through edge proxy |

---

## 3. Storage & Database Volume Growth Projections

### Annual Row & Volume Estimation (5,000 Employees)
- **Daily Punches:** $5,000 \times 4\text{ punches} = 20,000\text{ rows/day}$
  - Annual: $\approx 5.2\text{ million rows/year} \approx 1.8\text{ GB data} + 2.2\text{ GB indexes} = 4.0\text{ GB/year}$.
- **Audit Logs:** $\approx 40,000\text{ events/day} \approx 14.6\text{ million rows/year} \approx 8.5\text{ GB/year}$.
- **Payroll Ledgers & Lines:** $5,000 \times 12\text{ months} \times 20\text{ lines} \approx 1.2\text{ million rows/year} \approx 1.5\text{ GB/year}$.
- **Document Attachments (MinIO):** Average 25 MB/employee/year $\approx 125\text{ GB/year}$.
- **Total 3-Year Sizing Baseline:**
  - PostgreSQL Database: $\approx 60\text{ GB}$ (with index headroom and table bloat factor $2.5\times$).
  - Object Storage (MinIO): $\approx 500\text{ GB}$ (with 7-year WORM compliance retention).

---

## 4. Virtual Machine Allocation Matrix (Proxmox VE)

| VM Name | Role | vCPU | RAM | NVMe Disk | Subnet & IP |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **edge-node-01** | Nginx Edge + WAF (Keepalived Master) | 4 | 8 GB | 50 GB | DMZ (`10.10.10.11`) |
| **edge-node-02** | Nginx Edge + WAF (Keepalived Backup) | 4 | 8 GB | 50 GB | DMZ (`10.10.10.12`) |
| **app-node-01** | Next.js Standalone App Server | 8 | 16 GB | 80 GB | App (`10.10.20.21`) |
| **app-node-02** | Next.js Standalone App Server | 8 | 16 GB | 80 GB | App (`10.10.20.22`) |
| **worker-node-01**| BullMQ Background Jobs & Payroll | 8 | 16 GB | 80 GB | App (`10.10.20.23`) |
| **worker-node-02**| BullMQ Background Jobs & Payroll | 8 | 16 GB | 80 GB | App (`10.10.20.24`) |
| **db-node-01** | Patroni Primary (etcd + PgBouncer) | 8 | 32 GB | 250 GB | Data (`10.10.30.31`) |
| **db-node-02** | Patroni Sync Standby (etcd + PgBouncer)| 8 | 32 GB | 250 GB | Data (`10.10.30.32`) |
| **db-node-03** | Patroni Async Standby (etcd quorum) | 4 | 16 GB | 250 GB | Data (`10.10.30.33`) |
| **cache-node-01**| Valkey Primary + Sentinel | 4 | 8 GB | 60 GB | Data (`10.10.30.35`) |
| **cache-node-02**| Valkey Replica + Sentinel | 4 | 8 GB | 60 GB | Data (`10.10.30.36`) |
| **storage-01** | MinIO Primary S3 Storage | 4 | 16 GB | 1,000 GB | Backup (`10.10.40.41`) |
| **mgmt-01** | OpenBao Vault + Bastion + Forward Proxy| 4 | 8 GB | 100 GB | MGMT (`10.10.50.81`) |
| **TOTAL** | **13 Virtual Machines** | **72** | **192 GB** | **2,410 GB** | Cluster Mesh |

---

## 5. Physical Hypervisor Sizing ($N+1$ Redundancy)

To host the above 13 VMs with $N+1$ host resilience across 3 Proxmox physical hypervisors:
- **Each Physical Server Specification:**
  - **CPU:** Dual AMD EPYC 7302 (32 cores / 64 threads per server) or Intel Xeon Silver 4314 (32 cores / 64 threads). Total cluster: 96 cores / 192 threads.
  - **RAM:** 128 GB ECC DDR4/DDR5 registered per server. Total cluster: 384 GB ECC RAM. (Normal utilization: $\approx 50\%$; during 1 host failure: $\approx 75\%$).
  - **Disk:** $4 \times 1.92\text{ TB}$ Enterprise NVMe SSDs in hardware RAID-10 or ZFS mirror per server. Sustained random 4K write IOPS $> 100,000$.
  - **Network:** Dual 10 GbE SFP+ bonded interfaces (LACP 802.3ad) connecting to redundant top-of-rack switches.
