# ADR 0023: LUKS Data Volume Encryption & Remote Unlocking

## Status
Accepted

## Context
Per `PRODUCTION_INFRA_REFERENCE.md` Section 4, all persistent data volumes storing employee PII, attendance punches, payroll runs, documents, backups, and audit logs must use **LUKS (Linux Unified Key Setup) full volume encryption**.

However, in headless data center environments, requiring physical console interaction or manual keyboard input to enter a passphrase after every server reboot causes unacceptable downtime and complicates automated maintenance windows.

## Decision
We deploy a **Dual-Layer LUKS Management Model**:

1. **Automated Reboots via Clevis / Tang (Network-Bound Disk Encryption - NBDE):**
   - A redundant pair of **Tang servers** is deployed on the isolated **MGMT VLAN**.
   - Data disks on `pg-*`, `minio-*`, `backup-*`, and `app-*` nodes are bound to Tang keys using **Clevis** (`clevis-luks-bind`).
   - During normal reboots, nodes automatically acquire key decryption tokens from Tang over the local trusted network without human intervention.
   - If an unauthorized actor physically removes a hard drive or moves a server out of the private data center, the Tang server is unreachable, and the drive remains permanently locked.
2. **Emergency Remote Unlock via Dropbear SSH in Initramfs:**
   - Every host includes a hardened, lightweight Dropbear SSH daemon listening on a dedicated port in the pre-boot initramfs environment.
   - Authorized operators with dedicated administrative SSH keys can remotely log in during pre-boot to execute `cryptsetup-unlock` with the emergency master passphrase.
3. **Master Key Custody:**
   - The LUKS master keys and Tang recovery passphrases are sealed in physical tamper-evident envelopes under the custody of the Infrastructure Lead and Security Officer.

## Consequences
- Enables automated, zero-downtime rolling host patching and rebooting within the private data center.
- Provides cryptographic protection against physical drive theft or unauthorized hardware tampering.
- Ensures a reliable out-of-band unlock mechanism via initramfs SSH if network Tang servers are temporarily unavailable.
