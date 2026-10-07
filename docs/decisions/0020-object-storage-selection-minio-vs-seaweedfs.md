# ADR 0020: Object Storage Selection Spike Conclusion: MinIO & SeaweedFS Dual-Engine Compatibility

## Status
Accepted

## Context
Per `ADR 0017`, the engineering team evaluated **MinIO Distributed** (AGPLv3) and **SeaweedFS S3** (Apache 2.0) against the 12 platform requirements for OrgHub HRMS.

### Spike Findings Summary:
1. **AWS SDK v3 Compatibility:** Both engines pass 100% of standard operations (`@aws-sdk/client-s3` PutObject, GetObject, DeleteObject, ListObjectsV2).
2. **Presigned URLs:** Both engines support presigned PUT/GET URLs generated via `@aws-sdk/s3-request-presigner`.
3. **Object Lock / WORM:** MinIO supports full RFC Object Lock (Governance and Compliance modes) out of the box with `s3:PutObjectLegalHold`. SeaweedFS supports append-only and immutable buckets with versioning, but has fewer enterprise audit integrations for statutory Form 24Q and payslip legal holds.
4. **Licensing:**
   - MinIO is licensed under GNU AGPLv3. For an enterprise hosting the software internally on its own infrastructure for employee access (without providing a multi-tenant commercial SaaS or modifying the MinIO binary), AGPLv3 does not trigger copyleft requirements on external application source code.
   - SeaweedFS is licensed under Apache 2.0, offering zero copyleft implications under all commercial deployment models.

## Decision
We architect the storage tier to support **dual pluggable engines** via Ansible configuration:
1. **Default Deployment:** **MinIO Distributed** (4-node erasure coded `minio-01..04`), providing proven enterprise WORM compliance, lifecycle rules for punch selfies, and native Prometheus telemetry.
2. **Alternative Deployment:** **SeaweedFS Distributed S3**, pre-templated in the Ansible role (`storage_backend: seaweedfs`), enabling immediate zero-code switchover if corporate legal counsel mandates an Apache 2.0 license.
3. Both configurations use the identical S3 endpoint API format and credentials, requiring zero application code adjustments.

## Consequences
- Operations gains the robust WORM and replication tooling of MinIO by default.
- The enterprise has complete license risk protection: if counsel disallows AGPLv3, the storage engine can be flipped to SeaweedFS via an Ansible inventory variable toggle without refactoring the application.
