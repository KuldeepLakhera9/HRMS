# HRMS Database Migration Guide

## 1. Migration Philosophy & Rules (AGENTS.md Section 4)

1. **SQL-First Versioning**:
   - Migrations live in `packages/db/migrations/` as sequenced SQL files (e.g. `0011_sprint_1_4_schema.sql`).
   - Every migration is reviewed, versioned, backward-compatible, and executed solely by the `hrms_owner` role.
   - **Never edit an applied migration.** Once committed, any changes must be made via a new forward migration.

2. **Zero-Downtime Expand-Contract Cycle**:
   - **Expand**: Add new columns (nullable or with default), new tables, or new indexes. Deploy application code that writes to both old and new columns.
   - **Migrate**: Backfill existing rows via background script.
   - **Contract**: Deploy application code that reads only from new schema, then remove old columns in a subsequent release.

3. **Multi-Tenant RLS Mandatory Rules**:
   - Every tenant table **must** enable Row-Level Security:
     ```sql
     ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
     ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;
     ```
   - RLS policy definition using transaction-bound `current_setting`:
     ```sql
     CREATE POLICY <table_name>_tenant_isolation ON <table_name>
       FOR ALL
       USING (company_id = app_company_id())
       WITH CHECK (company_id = app_company_id());
     ```
   - Every tenant table has `UNIQUE (company_id, id)` and uses **composite foreign keys**:
     ```sql
     FOREIGN KEY (company_id, x_id) REFERENCES x(company_id, id) ON DELETE CASCADE
     ```

4. **Index Guidelines**:
   - Every query path must have an index created in the same migration as the feature.
   - All tenant table indexes **must** lead with `company_id`.
   - Use partial indexes for soft-deleted tables: `WHERE deleted_at IS NULL`.
   - Text search uses `pg_trgm` GIN indexes on normalized search keys.

5. **Grants to App Roles**:
   - After creating tables, grants must be explicitly defined:
     ```sql
     GRANT SELECT, INSERT, UPDATE, DELETE ON <table_name> TO hrms_app;
     GRANT SELECT, INSERT, UPDATE, DELETE ON <table_name> TO hrms_worker;
     GRANT SELECT ON <table_name> TO hrms_readonly;
     ```
   - Append-only tables (`audit_logs`, `punches`, `ledgers`) do **not** grant UPDATE or DELETE to `hrms_app`.

---

## 2. Executing Migrations

```bash
# Apply pending migrations against the database
pnpm db:migrate
```

The migration runner in `packages/db/src/migrate.ts` automatically executes pending SQL files in sequence, tracks applied migrations in the `__drizzle_migrations` table, and ensures atomic transactional execution.
