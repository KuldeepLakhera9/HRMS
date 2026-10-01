-- 0005_outbox_and_audit_maintenance.sql
-- 1. Policies for outbox relay and audit maintenance

-- Allow hrms_owner full access on audit_logs and outbox_events for maintenance
DROP POLICY IF EXISTS audit_logs_owner_policy ON audit_logs;
CREATE POLICY audit_logs_owner_policy ON audit_logs
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS outbox_events_owner_policy ON outbox_events;
CREATE POLICY outbox_events_owner_policy ON outbox_events
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

-- Allow hrms_worker to process outbox events across tenants for background relay
DROP POLICY IF EXISTS outbox_events_worker_policy ON outbox_events;
CREATE POLICY outbox_events_worker_policy ON outbox_events
  FOR ALL TO hrms_worker
  USING (true)
  WITH CHECK (true);

-- 2. Partition Maintenance Procedure for audit_logs
-- Dynamically creates audit_logs monthly partition for any given year and month if not existing
CREATE OR REPLACE FUNCTION create_audit_logs_partition(p_year int, p_month int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partition_name text;
  v_start_date date;
  v_end_date date;
  v_sql text;
BEGIN
  v_partition_name := format('audit_logs_%s_%s', p_year, to_char(p_month, 'FM09'));
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := v_start_date + interval '1 month';

  v_sql := format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L);',
    v_partition_name,
    v_start_date,
    v_end_date
  );

  EXECUTE v_sql;
  RETURN v_partition_name;
END;
$$;

REVOKE ALL ON FUNCTION create_audit_logs_partition(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_audit_logs_partition(int, int) TO hrms_owner, hrms_worker;
