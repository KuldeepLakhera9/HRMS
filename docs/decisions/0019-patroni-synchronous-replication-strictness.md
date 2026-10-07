# ADR 0019: Patroni Synchronous Replication Mode (Strict vs. Non-Strict)

## Status
Accepted

## Context
In our 3-node PostgreSQL high-availability architecture (`pg-01` primary, `pg-02` synchronous standby, `pg-03` asynchronous replica), Patroni orchestrates failover via etcd distributed consensus.

When `synchronous_mode` is enabled, Patroni dynamically manages `synchronous_standby_names` to ensure zero committed-data loss by requiring transactions to be written to WAL on at least one standby before acknowledging commit to the client.

Patroni offers a configuration flag: `synchronous_mode_strict`.
- If `synchronous_mode_strict: true`: If the synchronous standby node becomes unreachable (e.g. host reboot, transient network partition between data nodes), Patroni refuses to demote synchronous replication. All client write transactions block indefinitely or fail with timeouts until a standby re-establishes connection. This guarantees 100% durability ($RPO = 0$), but causes a complete system write outage ($RTO > 0$).
- If `synchronous_mode_strict: false`: Patroni requires synchronous commit whenever at least one standby is connected. If all standbys are lost, Patroni temporarily relaxes `synchronous_standby_names` to allow writes on the primary to proceed, while immediately emitting a critical warning.

## Decision
We select **`synchronous_mode_strict: false`** paired with **instantaneous Prometheus P1 Alerting** (`PostgresSyncStandbyMissing`).

Rationale:
1. In enterprise HRMS operations, biometric check-in punches, live attendance events, and employee self-service must not experience catastrophic system-wide locking due to a transient hypervisor network hiccup or reboot of a single standby host.
2. In our 3-node topology, under normal operation, `pg-02` is synchronous and `pg-03` is a candidate standby. The primary will only degrade to asynchronous mode if *both* secondary nodes fail simultaneously.
3. If both standbys fail simultaneously, `synchronous_mode_strict: false` permits operations to continue on the surviving primary while Alertmanager triggers an immediate P1 page (`severity: critical`, `owner: dba-oncall`) to restore replica quorum.

## Consequences
- Single-node standby failures will never cause cascading write outages across the organization.
- If an unprecedented disaster destroys both standbys and the primary crashes before WAL catches up, a small window of un-replicated transactions could exist ($RPO \le \text{few seconds}$).
- To mitigate this, `maximum_lag_on_failover` is set to 1MB, and `pg_rewind` is strictly enforced on all nodes.
