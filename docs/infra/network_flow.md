# Network Traffic Flow & Firewall Matrix

This document defines the strict, audited cross-tier traffic rules per Section 3 of `PRODUCTION_INFRA_REFERENCE.md`.

```mermaid
sequenceDiagram
    autonumber
    actor Employee as Employee Mobile / Browser
    participant Edge as Edge Nginx VIP (VLAN 10)
    participant App as App Next.js Node (VLAN 20)
    participant PB as PgBouncer Local (VLAN 20)
    participant HAP as HAProxy VIP (VLAN 30)
    participant PG as PostgreSQL Primary (VLAN 30)
    participant Valkey as Valkey Sentinel (VLAN 30)
    participant S3 as MinIO / SeaweedFS (VLAN 30)
    participant Egress as Squid Egress Proxy (VLAN 50)
    actor FCM as Google FCM / Apple APNs

    Employee->>Edge: HTTPS (443/tcp) - TLS 1.3 / Let's Encrypt
    Note over Edge: Coraza WAF Inspection + Rate Limiting + Static Asset Cache Check
    Edge->>App: HTTP/2 Proxy (3000/tcp)
    Note over App: Auth Token Verified, Context Built, can() Authorization Checked

    rect rgb(240, 248, 255)
        Note over App,Valkey: Fast Path (Session Check / Cache Read)
        App->>Valkey: GET session:tokenHash (6379/tcp)
        Valkey-->>App: Cached Session Payload
    end

    rect rgb(255, 250, 240)
        Note over App,PG: Transactional Data Path
        App->>PB: SQL Query (6432/tcp, hrms_app role)
        PB->>HAP: Multiplexed Connection (5000/tcp)
        HAP->>PG: Routed to Current Patroni Primary (5432/tcp)
        PG-->>App: Row-Level Security Enforced Data
    end

    opt File Upload / Download
        App->>S3: Presigned S3 Request (9000/tcp)
        S3-->>App: Signed WORM Target URL
    end

    opt Push Notification / External Webhook
        App->>Egress: HTTPS Proxy (3128/tcp)
        Note over Egress: Domain Whitelist Filter (fcm.googleapis.com)
        Egress->>FCM: Encrypted External Delivery (443/tcp)
    end
```

### Complete Cross-VLAN Firewall Allow Matrix

| Rule ID | Source Tier | Destination Tier | Destination Port | Protocol | Service / Purpose |
|---|---|---|---|---|---|
| **FW-01** | Any / Internet | Edge VIP (DMZ) | `443/tcp` | TCP | Employee Web & Mobile API Access |
| **FW-02** | Any / Internet | Edge VIP (DMZ) | `80/tcp` | TCP | Immediate HTTP to HTTPS Redirect |
| **FW-03** | Edge (DMZ) | App Tier (APP) | `3000/tcp` | TCP | Next.js Standalone Reverse Proxy |
| **FW-04** | App / Worker | PgBouncer Local | `6432/tcp` | TCP | High-performance Connection Pooling |
| **FW-05** | PgBouncer (APP) | HAProxy VIP (DATA) | `5000/tcp` | TCP | PostgreSQL Primary Read-Write Traffic |
| **FW-06** | PgBouncer (APP) | HAProxy VIP (DATA) | `5001/tcp` | TCP | PostgreSQL Standby Read-Only Traffic |
| **FW-07** | HAProxy (DATA) | PostgreSQL Nodes | `5432/tcp` | TCP | Direct PostgreSQL Backend Connection |
| **FW-08** | HAProxy (DATA) | PostgreSQL Nodes | `8008/tcp` | TCP | Patroni REST API Health Check (`/primary`, `/replica`) |
| **FW-09** | PostgreSQL Nodes | PostgreSQL Nodes | `5432/tcp` | TCP | Streaming Physical WAL Replication |
| **FW-10** | PostgreSQL Nodes | etcd Cluster | `2379/tcp` | TCP | Patroni Distributed Consensus (DCS) Lease |
| **FW-11** | etcd Nodes | etcd Nodes | `2380/tcp` | TCP | etcd Raft Peer Replication |
| **FW-12** | App / Worker | Valkey Cluster | `6379/tcp` | TCP | Redis-compatible Cache & BullMQ Queues |
| **FW-13** | App / Worker | Valkey Sentinels | `26379/tcp` | TCP | Sentinel Master Health & Topology Discovery |
| **FW-14** | App / Worker | Object Storage | `9000/tcp` | TCP | S3 Storage (Documents, Selfies, Payslips) |
| **FW-15** | App / Worker | OpenBao Vault | `8200/tcp` | TCP | Secrets, Token Decryption, AppRole Auth |
| **FW-16** | Standby PG Node | Backup Server | `pgBackRest TLS` | TCP | Dedicated Continuous WAL Archiving |
| **FW-17** | Backup Server | Offsite Target | `443/tcp` / SSH | TCP | Offsite Encrypted Mirroring (Client-side AES-256) |
| **FW-18** | App / Worker | Egress Proxy (MGMT)| `3128/tcp` | TCP | Whitelisted Outbound Forward Proxy |
| **FW-19** | Egress Proxy | External Services | `443, 587/tcp` | TCP | Outbound FCM, APNs, Attestation, SMTP Relay |
| **FW-20** | Bastion (MGMT) | All Server Nodes | `22/tcp` | TCP | Out-of-band SSH Administration (Key only) |
| **FW-21** | Prometheus (MGMT)| All Nodes | `9100-9187/tcp` | TCP | Prometheus Metrics Exporter Scrapes |
| **FW-22** | All Nodes | Loki (MGMT) | `3100/tcp` | TCP | Promtail Structured Log Forwarding |

> **Default Rule:** Any packet not matching an explicit rule above is dropped immediately (`policy drop`). Direct access from Internet to DATA, BACKUP, or MGMT VLANs is physically and logically blocked.
