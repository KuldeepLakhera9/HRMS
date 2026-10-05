-- Migration: 0016_sprint_2_4_audit_fixes.sql
-- Description: Composite foreign key on biometric_quarantine, and re-create v_effective_punches with is_synthetic

-- 1. Add composite foreign key on biometric_quarantine for resolved_employee_id
ALTER TABLE biometric_quarantine
  DROP CONSTRAINT IF EXISTS fk_biometric_quarantine_resolved_emp;

ALTER TABLE biometric_quarantine
  ADD CONSTRAINT fk_biometric_quarantine_resolved_emp
  FOREIGN KEY (company_id, resolved_employee_id)
  REFERENCES employees(company_id, id)
  ON DELETE SET NULL;

-- 2. Drop and re-create v_effective_punches view to include is_synthetic
DROP VIEW IF EXISTS v_effective_punches CASCADE;

CREATE VIEW v_effective_punches AS
SELECT
  p.id,
  p.company_id,
  p.employee_id,
  p.punch_time,
  p.punch_type,
  p.source,
  p.work_date,
  p.shift_id,
  p.location_id,
  p.location_coords,
  p.gps_accuracy,
  p.is_inside_geofence,
  p.distance_meters,
  p.selfie_file_id,
  p.device_id,
  p.device_model,
  p.is_mock_location,
  p.status as raw_status,
  COALESCE(r.status, p.status) as effective_status,
  p.reason_code,
  p.flag_reasons,
  p.idempotency_key,
  p.created_at,
  r.id as review_id,
  r.workflow_request_id,
  r.reviewer_id,
  r.review_comments,
  r.reviewed_at,
  p.is_synthetic
FROM attendance_punches p
LEFT JOIN attendance_punch_reviews r
  ON r.company_id = p.company_id
 AND r.punch_id = p.id
 AND r.deleted_at IS NULL;

GRANT SELECT ON v_effective_punches TO hrms_app, hrms_worker;
