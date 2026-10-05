-- Migration: 0020_announcements_composite_fks.sql
-- Description: Composite foreign keys on announcements table for department and location

DO $$
BEGIN
  -- 1. Clean up any invalid or orphan department/location references prior to constraint addition
  UPDATE announcements
  SET target_dept_id = NULL
  WHERE target_dept_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM departments d
      WHERE d.company_id = announcements.company_id AND d.id = announcements.target_dept_id
    );

  UPDATE announcements
  SET target_loc_id = NULL
  WHERE target_loc_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM work_locations w
      WHERE w.company_id = announcements.company_id AND w.id = announcements.target_loc_id
    );

  -- 2. Add composite foreign keys
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_announcements_target_dept'
  ) THEN
    ALTER TABLE announcements
      ADD CONSTRAINT fk_announcements_target_dept
      FOREIGN KEY (company_id, target_dept_id)
      REFERENCES departments(company_id, id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_announcements_target_loc'
  ) THEN
    ALTER TABLE announcements
      ADD CONSTRAINT fk_announcements_target_loc
      FOREIGN KEY (company_id, target_loc_id)
      REFERENCES work_locations(company_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;
