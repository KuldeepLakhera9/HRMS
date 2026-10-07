# ADR 0017: Object Storage Evaluation Spike - MinIO vs. SeaweedFS

## Status
Accepted

## Context
OrgHub HRMS requires high-durability, self-hosted S3-compatible object storage for:
1. Employee document vault (Aadhaar, PAN, passports, signed agreements, certificates).
2. Biometric punch selfie storage (with automated lifecycle retention rules).
3. Generated payslip PDF archives and bank payment advice files.
4. Compliance audit log dumps and report CSV streaming exports.
5. Statutory WORM (Write Once, Read Many) object lock compliance.

While **MinIO** is widely adopted, its **AGPLv3** license imposes strict network copyleft terms. For private enterprise on-premises use where the software is not modified or re-distributed as a cloud service, AGPLv3 is commonly acceptable, but corporate counsel must make the final determination. **SeaweedFS** provides an Apache 2.0-licensed alternative with native S3 compatibility and high-throughput small file handling.

## Decision
We conduct a time-boxed technical and operational comparison spike between **MinIO Distributed** and **SeaweedFS Distributed S3** against the following 12 concrete application requirements:

1. **AWS SDK v3 Compatibility:** Zero client-side workarounds when using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
2. **Presigned Uploads (POST/PUT):** Exact enforcement of content-type, magic bytes, and max size policies.
3. **Presigned Downloads (GET):** Time-bounded pre-signed URLs (15-minute expiration) with step-up verification.
4. **Versioning:** Immutable version history for document replacements.
5. **Object Lock / WORM:** Governance and compliance retention modes for statutory filings and payslips.
6. **Lifecycle Rules:** Automated purge/transition rules for temporary punch selfies after the retention window.
7. **Server-Side Encryption:** Integration with OpenBao/Vault transit keys or KMS SSE-S3.
8. **Offsite Replication:** Active-passive asynchronous bucket mirroring to an offsite secondary repository.
9. **Erasure Coding Durability:** Multi-disk and multi-node fault tolerance (surviving $N/2$ drive losses).
10. **Metrics & Observability:** Native Prometheus `/metrics` exposition for storage capacity, latency, and error counts.
11. **Operational Maturity:** Ease of deployment via Ansible, health monitoring, and disk replacement procedures.
12. **Licensing Clarity:** Unambiguous legal standing for internal enterprise hosting.

If both fail to meet requirements, Ceph RADOS Gateway (RGW) will be evaluated as the enterprise fallback.

## Consequences
- The engineering team will deliver a structured benchmark and matrix comparing both solutions on staging.
- Production Ansible roles will be templated such that switching between MinIO and SeaweedFS requires only an inventory flag change without modifying application code.
