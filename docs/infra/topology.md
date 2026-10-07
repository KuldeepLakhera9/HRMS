# Production Infrastructure Topology Diagram

This document renders the physical and virtual topology as code for the OrgHub HRMS enterprise deployment across 5 network tiers.

```mermaid
graph TD
    subgraph Internet_Users ["External Internet & Employee Devices"]
        MobileUsers["Employee Mobile Devices (GPS Geofenced)"]
        WebUsers["Employee & HR Workstations"]
        ISP_A["Primary ISP Link A"]
        ISP_B["Secondary ISP Link B (Failover)"]
    end

    MobileUsers --> ISP_A
    WebUsers --> ISP_B
    ISP_A --> EdgeFW["Edge Firewall (Default Deny, Port 443 only)"]
    ISP_B --> EdgeFW

    subgraph DMZ_VLAN ["DMZ VLAN (VLAN 10)"]
        VIP["Keepalived Virtual IP (VIP)"]
        EdgeFW --> VIP
        VIP --> Edge01["edge-01 (Nginx + Coraza WAF + Static Cache)"]
        VIP --> Edge02["edge-02 (Nginx + Coraza WAF + Static Cache)"]
    end

    subgraph APP_VLAN ["APP VLAN (VLAN 20)"]
        Edge01 -->|HTTP/2, Port 3000| App01["app-01 (Next.js Standalone, UID 1001)"]
        Edge02 -->|HTTP/2, Port 3000| App02["app-02 (Next.js Standalone, UID 1001)"]
        Worker01["worker-01 (BullMQ Daemons, UID 1001)"]
        Worker02["worker-02 (BullMQ Daemons, UID 1001)"]
        PB01["PgBouncer Local (Port 6432)"]
        PB02["PgBouncer Local (Port 6432)"]
        App01 --> PB01
        App02 --> PB02
        Worker01 --> PB01
        Worker02 --> PB02
    end

    subgraph DATA_VLAN ["DATA VLAN (VLAN 30) - Private"]
        HAP_VIP["HAProxy DB VIP (Port 5000 RW / 5001 RO)"]
        PB01 --> HAP_VIP
        PB02 --> HAP_VIP

        HAP_VIP -->|Port 5432| PG01["pg-01 (Patroni Leader / PostgreSQL 16)"]
        HAP_VIP -->|Port 5432| PG02["pg-02 (Patroni Synchronous Standby)"]
        HAP_VIP -->|Port 5432| PG03["pg-03 (Patroni Async Standby)"]

        PG01 <== Synchronous Streaming Replication ==> PG02
        PG01 --- Asynchronous Streaming Replication ---> PG03

        subgraph DCS ["Distributed Consensus Store (DCS)"]
            ETCD01["etcd-01 (mTLS)"]
            ETCD02["etcd-02 (mTLS)"]
            ETCD03["etcd-03 (mTLS)"]
        end
        PG01 <--> DCS
        PG02 <--> DCS
        PG03 <--> DCS

        subgraph Cache_Queue ["Valkey Sentinel Cluster"]
            Valkey01["valkey-01 (Primary, Port 6379)"]
            Valkey02["valkey-02 (Replica, Port 6379)"]
            Sentinel["Sentinel Quorum (x3, Port 26379)"]
        end
        App01 --> Valkey01
        Worker01 --> Valkey01

        subgraph Object_Store ["MinIO / SeaweedFS S3 (WORM Lock)"]
            Minio01["minio-01 (Erasure Coded)"]
            Minio02["minio-02 (Erasure Coded)"]
            Minio03["minio-03 (Erasure Coded)"]
            Minio04["minio-04 (Erasure Coded)"]
        end
        App01 --> Minio01
        Worker01 --> Minio01

        subgraph Secrets_Engine ["OpenBao 3-Node Raft Cluster"]
            Bao01["openbao-01 (Port 8200)"]
            Bao02["openbao-02"]
            Bao03["openbao-03"]
        end
        App01 --> Bao01
        Worker01 --> Bao01
    end

    subgraph BACKUP_VLAN ["BACKUP VLAN (VLAN 40)"]
        PG02 -->|Continuous WAL & Diff Backups| Backup01["backup-01 (pgBackRest Repo1, AES-256)"]
        Minio01 -->|Object Replication| Backup01
        Backup01 -->|Encrypted Mirroring| OffsiteRepo["Offsite Target (pgBackRest Repo2, Encrypted Only)"]
    end

    subgraph MGMT_VLAN ["MANAGEMENT VLAN (VLAN 50)"]
        Bastion["Bastion Host + WireGuard VPN (Port 22/51820)"]
        EgressProxy["Squid Forward Proxy (Port 3128 Whitelist)"]
        Monitor["Prometheus + Alertmanager + Grafana + Loki"]
        Tang["Tang Server Pair (LUKS Network Unlock)"]
        InternalCA["Internal Root CA (Cluster mTLS)"]
    end

    App01 -->|Outbound Push / Attestation| EgressProxy
    Worker01 -->|Outbound SMTP Relay| EgressProxy
    Monitor -.->|Scrape Metrics & Logs| Edge01
    Monitor -.->|Scrape Metrics & Logs| App01
    Monitor -.->|Scrape Metrics & Logs| PG01
    Monitor -.->|Scrape Metrics & Logs| Valkey01
```
