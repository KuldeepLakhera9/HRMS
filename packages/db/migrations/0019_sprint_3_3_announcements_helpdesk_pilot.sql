-- Migration: 0019_sprint_3_3_announcements_helpdesk_pilot.sql
-- Description: Announcements, Helpdesk-Lite, Feature Flags, Feedback Submissions, and Data Migration Batches with RLS

-- 1. Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  content_md text NOT NULL,
  audience_type text DEFAULT 'all' NOT NULL CHECK (audience_type IN ('all', 'department', 'location')),
  target_dept_id uuid,
  target_loc_id uuid,
  is_pinned boolean DEFAULT false NOT NULL,
  published_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_announcements_company_id_id UNIQUE (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements (company_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements (company_id, is_pinned);

-- 2. Announcement Reads
CREATE TABLE IF NOT EXISTS announcement_reads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_announcement_reads_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_announcement_reads_user UNIQUE (company_id, announcement_id, user_id),
  CONSTRAINT fk_announcement_reads_post FOREIGN KEY (company_id, announcement_id) REFERENCES announcements(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_lookup ON announcement_reads (company_id, user_id, announcement_id);

-- 3. Helpdesk Categories
CREATE TABLE IF NOT EXISTS helpdesk_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  default_assignee_role text DEFAULT 'hr_manager' NOT NULL,
  sla_hours integer DEFAULT 48 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_helpdesk_categories_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_helpdesk_categories_code UNIQUE (company_id, code)
);

-- 4. Helpdesk Tickets
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ticket_number text NOT NULL,
  category_id uuid NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  priority text DEFAULT 'medium' NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  creator_user_id uuid NOT NULL,
  assignee_user_id uuid,
  sla_due_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_helpdesk_tickets_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_helpdesk_tickets_number UNIQUE (company_id, ticket_number),
  CONSTRAINT fk_helpdesk_tickets_category FOREIGN KEY (company_id, category_id) REFERENCES helpdesk_categories(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_status ON helpdesk_tickets (company_id, status);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_creator ON helpdesk_tickets (company_id, creator_user_id);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_assignee ON helpdesk_tickets (company_id, assignee_user_id);

-- 5. Helpdesk Comments
CREATE TABLE IF NOT EXISTS helpdesk_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL,
  user_id uuid NOT NULL,
  comment_md text NOT NULL,
  is_internal boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_helpdesk_comments_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_helpdesk_comments_ticket FOREIGN KEY (company_id, ticket_id) REFERENCES helpdesk_tickets(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_comments_ticket ON helpdesk_comments (company_id, ticket_id, created_at ASC);

-- 6. Feature Flags
CREATE TABLE IF NOT EXISTS feature_flags (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  is_enabled boolean DEFAULT false NOT NULL,
  rules jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_feature_flags_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_feature_flags_key UNIQUE (company_id, key)
);

-- 7. Feedback Submissions
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  category text DEFAULT 'general' NOT NULL,
  page_context text,
  message text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_feedback_submissions_company_id_id UNIQUE (company_id, id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user ON feedback_submissions (company_id, user_id);

-- 8. Data Migration Batches
CREATE TABLE IF NOT EXISTS data_migration_batches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('leave_balances', 'attendance_punches')),
  status text DEFAULT 'preview' NOT NULL CHECK (status IN ('preview', 'confirmed', 'completed', 'reverted', 'failed')),
  total_rows integer DEFAULT 0 NOT NULL,
  valid_rows integer DEFAULT 0 NOT NULL,
  error_rows integer DEFAULT 0 NOT NULL,
  errors_json jsonb DEFAULT '[]'::jsonb NOT NULL,
  summary_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  confirmed_by uuid,
  reverted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_data_migration_batches_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_data_migration_batches_idempotency UNIQUE (company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_data_migration_batches_type ON data_migration_batches (company_id, type, status);

-- Enable RLS and Force RLS
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'announcements',
    'announcement_reads',
    'helpdesk_categories',
    'helpdesk_tickets',
    'helpdesk_comments',
    'feature_flags',
    'feedback_submissions',
    'data_migration_batches'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I
       FOR ALL
       USING (company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid)
       WITH CHECK (company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid);',
      tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_owner_bypass ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_owner_bypass ON %I
       FOR ALL
       TO hrms_owner
       USING (true)
       WITH CHECK (true);',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Permissions grant
GRANT SELECT, INSERT, UPDATE, DELETE ON
  announcements,
  announcement_reads,
  helpdesk_categories,
  helpdesk_tickets,
  helpdesk_comments,
  feature_flags,
  feedback_submissions,
  data_migration_batches
TO hrms_app, hrms_worker;
