# HRMS Ansible Infrastructure Automation Runbook

## 1. Directory Structure

```
infra/ansible/
├── ansible.cfg                    # Configuration: pipelining, ssh hardening, roles_path
├── inventories/
│   ├── staging/                   # Staging environment (local simulation / testbed)
│   │   ├── hosts.yml              # Node inventory mapping
│   │   └── group_vars/all.yml     # Staging variables & overrides
│   └── production/                # Production environment (Tier-3 colocation cluster)
│       ├── hosts.yml              # Production node topology
│       └── group_vars/all.yml     # Production hardened defaults
├── playbooks/
│   └── site.yml                   # Master cluster convergence playbook
└── roles/
    ├── 01_base_hardening          # Kernel sysctl, sshd, chrony NTP, auditd
    ├── 02_firewall_nftables       # Default-deny nftables 22-tier cross matrix
    ├── 03_docker_engine           # Docker CE daemon security & logging
    ├── 04_internal_pki            # Internal Root & Intermediate CA mTLS
    ├── 05_edge_nginx              # Nginx HTTP/2, Keepalived VRRP, Coraza WAF
    ├── 06_app_node                # Next.js standalone systemd unit & sandboxing
    ├── 07_worker_node             # BullMQ background worker systemd unit
    ├── 08_etcd_cluster            # 3-node etcd consensus mTLS cluster
    ├── 09_postgres_patroni        # PostgreSQL 16 + PostGIS + Patroni sync HA
    ├── 10_haproxy_db              # TCP routing (5000 RW, 5001 RO, 7000 stats)
    ├── 11_pgbouncer_pooler        # PgBouncer transaction-mode pooler (6432)
    ├── 12_valkey_sentinel         # Valkey primary/replica + 3 Sentinels (AOF)
    ├── 13_object_storage          # MinIO/SeaweedFS S3 storage with WORM lock
    ├── 14_openbao_vault           # OpenBao Raft secrets engine & AppRole
    ├── 15_backup_pgbackrest       # pgBackRest local NVMe + offsite encrypted S3
    └── 17_bastion_vpn             # WireGuard VPN & hardened SSH bastion
```

---

## 2. Prerequisites & Setup

1. Install Ansible (version 2.15+) on the management workstation or deployment runner:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install ansible
   ```
2. Verify Ansible configuration:
   ```bash
   cd infra/ansible
   ansible-config dump --only-changed
   ```

---

## 3. Provisioning Workflows

### Staging Cluster Convergence
To run syntax verification and dry-run:
```bash
ansible-playbook -i inventories/staging/hosts.yml playbooks/site.yml --syntax-check
ansible-playbook -i inventories/staging/hosts.yml playbooks/site.yml --check
```

To execute full cluster deployment against staging:
```bash
ansible-playbook -i inventories/staging/hosts.yml playbooks/site.yml
```

### Targeted Role Execution
When updating only a specific layer (e.g. edge proxy or firewall):
```bash
# Update edge Nginx configuration and reload
ansible-playbook -i inventories/staging/hosts.yml playbooks/site.yml --tags edge

# Update nftables firewall rules
ansible-playbook -i inventories/staging/hosts.yml playbooks/site.yml --tags firewall
```

---

## 4. Operational Health & Troubleshooting Commands

### PostgreSQL & Patroni Cluster Status
SSH to any database node and run:
```bash
patronictl -c /etc/patroni/patroni.yml list
patronictl -c /etc/patroni/patroni.yml topology
```

### OpenBao Secrets Engine Status & Unseal
```bash
export BAO_ADDR="http://127.0.0.1:8200"
bao status
# To unseal during maintenance (requires 3 of 5 custodian keys):
bao operator unseal <KEY_SHARE_1>
bao operator unseal <KEY_SHARE_2>
bao operator unseal <KEY_SHARE_3>
```

### PgBouncer Admin Console
```bash
psql -p 6432 -h 127.0.0.1 -U pgbouncer pgbouncer
# In admin console:
SHOW POOLS;
SHOW CLIENTS;
SHOW STATS;
```

### pgBackRest Backup Status & Verification
```bash
pgbackrest --stanza=hrms info
pgbackrest --stanza=hrms check
# Run immediate manual diff backup:
pgbackrest --stanza=hrms --type=diff backup
```
