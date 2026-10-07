# ADR 0016: Selection of OpenBao as Production Secrets Management Engine

## Status
Accepted

## Context
Production deployment of OrgHub HRMS requires an enterprise-grade secrets management solution for:
1. Dynamic and static database credential management (`hrms_app`, `hrms_worker`, `hrms_owner`).
2. Centralized application-level AES-256-GCM field encryption key custody (`keyId` versioning).
3. JWT signing keys, MinIO S3 credentials, and TOTP recovery master secrets.
4. Shamir-split unsealing ceremonies to guarantee segregation of duties and prevent single-operator compromise.

In August 2023, HashiCorp shifted Vault from the open-source Mozilla Public License 2.0 (MPL 2.0) to the Business Source License (BSL 1.1), creating commercial licensing ambiguities for enterprise on-premises deployments. In response, the Linux Foundation established **OpenBao**, an open-source, community-governed fork of Vault continuing under MPL 2.0.

## Decision
We select **OpenBao v2.x** as the official secrets management engine for OrgHub HRMS.

Key architecture points:
1. **API & Protocol Compatibility:** OpenBao maintains 100% wire and API compatibility with HashiCorp Vault 1.14+ endpoints (`/v1/auth/approle`, `/v1/secret/data`, `/v1/sys/seal-status`, `/v1/sys/unseal`).
2. **Storage Backend:** 3-node integrated Raft consensus storage (zero external storage dependency).
3. **Authentication:** AppRole authentication for automated service bootstrap (`apps/web`, `apps/worker`), with role IDs delivered via environment and secret IDs delivered via secure volume mount (0400).
4. **Audit Logging:** Dual local JSON file audit device forwarded to Loki with payload hashing.
5. **Key Custody:** 5-share Shamir unseal with a 3-of-5 threshold held by distinct security and operations custodians.
6. **Upgrade Path:** Clean, documented upgrade and migration compatibility with upstream Vault and future OpenBao releases.

## Consequences
- Guarantees 100% OSI-approved open-source compliance (MPL 2.0) without BSL licensing risk or vendor lock-in.
- Uses existing Vault CLI, Vault Agent, and standard HashiCorp client libraries (`node-vault` / `@hashicorp/vault`) with zero code alterations required in `@hrms/config` and `@hrms/core`.
- Requires an automated smoke test spike validating Raft clustering, AppRole authorization, KV v2 secret retrieval, and Shamir unsealing before production deployment.
