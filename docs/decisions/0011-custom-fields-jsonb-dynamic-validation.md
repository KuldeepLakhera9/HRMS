# ADR 0011: Custom Fields Extensibility via JSONB and Dynamic Zod Validation

## Status
Accepted

## Context
Self-hosted multi-tenant HRMS instances frequently need organization-specific employee attributes (e.g. badge IDs, t-shirt sizes, emergency contact relations, dietary preferences) without altering PostgreSQL table DDL or breaking query plans.

## Decision
1. **Schema Design**:
   - Created `custom_field_definitions` table with composite key `(company_id, entity, key)`.
   - Stores supported types: `text`, `number`, `date`, `select`, `boolean`, `json`.
   - Includes validation options (allowed choices for `select`, `required` flag, sort order, display section).
   - Values are stored in `employees.custom_fields` as indexed `jsonb`.

2. **Redis Caching with Invalidation**:
   - Cache key: `cf:{companyId}:{entity}` with 5-minute TTL.
   - Cache is explicitly invalidated on create, update, and soft-delete operations.
   - Cache miss or Redis outage falls back transparently to PostgreSQL with zero downtime.

3. **Dynamic Zod Schema Compilation**:
   - Created `buildDynamicValidator(definitions: CustomFieldDefinitionRecord[])`.
   - Transforms runtime field definitions into a strict Zod schema on demand.
   - Used uniformly in Employee create, Employee update, Employee change requests, and Bulk Import validation.

## Consequences
- High read throughput: Profile and directory reads parse cached definitions in sub-millisecond time.
- No DDL migrations required when HR administrators configure new attributes.
- Type safety: Strict validation prevents corrupt or non-conformant data in JSONB columns.
