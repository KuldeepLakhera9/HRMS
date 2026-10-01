-- 0007_auth_lookup_user.sql
-- Security Definer function to look up user credentials by email during login
-- before tenant context is established, preserving strict RLS for normal queries.

-- Allow hrms_owner access for security definer lookup functions
DROP POLICY IF EXISTS users_owner_policy ON users;
CREATE POLICY users_owner_policy ON users
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION lookup_user_by_email(p_email citext)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  email citext,
  password_hash text,
  status text,
  mfa_enabled boolean,
  mfa_secret_enc text,
  failed_attempts integer,
  locked_until timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.company_id, u.email, u.password_hash, u.status,
         u.mfa_enabled, u.mfa_secret_enc, u.failed_attempts, u.locked_until
  FROM users u
  WHERE u.email = p_email
    AND u.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION lookup_user_by_email(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_user_by_email(citext) TO hrms_app, hrms_worker;

-- Also allow updating password after reset via security definer function
CREATE OR REPLACE FUNCTION reset_user_password_by_id(p_user_id uuid, p_company_id uuid, p_new_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE users
  SET password_hash = p_new_hash,
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE id = p_user_id AND company_id = p_company_id AND deleted_at IS NULL
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION reset_user_password_by_id(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_password_by_id(uuid, uuid, text) TO hrms_app, hrms_worker;
