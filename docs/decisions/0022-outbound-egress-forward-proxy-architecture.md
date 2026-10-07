# ADR 0022: Outbound Egress Forward Proxy Architecture

## Status
Accepted

## Context
Per `AGENTS.md` and `PRODUCTION_INFRA_REFERENCE.md` Section 3, all infrastructure tiers (APP, DATA, BACKUP, MGMT) operate under a **strict default-deny outbound network policy**. However, certain core application features require internet access:
1. Mobile push notifications (Google Firebase Cloud Messaging / Apple Push Notification service).
2. Mobile device attestation and integrity verification (Google Play Integrity API).
3. Corporate email delivery (outbound SMTP relay / Microsoft 365 / Google Workspace).
4. Automated TLS certificate issuance via ACME DNS-01 API calls.
5. OS security updates from verified package repositories.

Direct unmonitored NAT or direct gateway egress from application nodes introduces risks of data exfiltration, command-and-control callbacks, and lateral movement.

## Decision
We deploy a **Dedicated Forward Proxy (Squid with SSL Bumping & Domain Whitelisting)** on the **MGMT VLAN**:

1. **Network Routing:**
   - App and worker nodes have zero direct default route to the external internet.
   - All outbound HTTP/HTTPS requests from `apps/web` and `apps/worker` must route explicitly through the forward proxy on port 3128 (`http_proxy=http://egress-proxy.mgmt.internal:3128`).
2. **Strict Domain Whitelist:**
   - The forward proxy maintains an explicit, audited whitelist:
     - `fcm.googleapis.com` (Android push)
     - `api.push.apple.com` (iOS push)
     - `playintegrity.googleapis.com` (Device attestation)
     - Approved corporate mail relay endpoints (e.g. `smtp.office365.com` / corporate relay)
     - Verified OS package mirrors (Debian/Ubuntu/Alpine security mirrors)
   - All requests to non-whitelisted destinations are dropped immediately and logged to Loki with security alert triggers.
3. **Audit & Review:**
   - Outbound egress logs are reviewed quarterly by the Security Officer.

## Consequences
- Prevents rogue data exfiltration and SSRF attacks against external malicious destinations.
- Simplifies firewall management: edge firewall only permits outbound 443/587 from the single static IP of the forward proxy node.
- Services requiring outbound connectivity must be configured with proxy environment variables.
