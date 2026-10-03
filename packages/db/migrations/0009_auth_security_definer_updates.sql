-- ==============================================================================
-- 0009_auth_security_definer_updates.sql
-- Security Definer updates for Session Management, Token Rotation & Step-Up Auth
-- ==============================================================================

-- 1. Drop existing lookup_session_by_hash to allow adding family_id to returned table
DROP FUNCTION IF EXISTS lookup_session_by_hash(text);

CREATE OR REPLACE FUNCTION lookup_session_by_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  user_id uuid,
  family_id uuid,
  client_type text,
  ip inet,
  user_agent text,
  mfa_verified_at timestamptz,
  step_up_until timestamptz,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.company_id, s.user_id, s.family_id, s.client_type, s.ip, s.user_agent,
         s.mfa_verified_at, s.step_up_until, s.idle_expires_at, s.absolute_expires_at
  FROM sessions s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.idle_expires_at > now()
    AND s.absolute_expires_at > now();
$$;

REVOKE ALL ON FUNCTION lookup_session_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_session_by_hash(text) TO hrms_app, hrms_worker;

-- 2. Security definer function for rotating session tokens (bypasses unauthenticated RLS barrier)
CREATE OR REPLACE FUNCTION rotate_session_tokens(
  p_session_id uuid,
  p_new_token_hash text,
  p_new_refresh_hash text,
  p_new_idle_expires_at timestamptz,
  p_ip inet,
  p_user_agent text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE sessions
  SET token_hash = p_new_token_hash,
       refresh_hash = p_new_refresh_hash,
       last_seen_at = now(),
       idle_expires_at = p_new_idle_expires_at,
       ip = coalesce(p_ip, ip),
       user_agent = coalesce(p_user_agent, user_agent)
  WHERE id = p_session_id
    AND revoked_at IS NULL
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION rotate_session_tokens(uuid, text, text, timestamptz, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotate_session_tokens(uuid, text, text, timestamptz, inet, text) TO hrms_app, hrms_worker;

-- 3. Security definer function for step-up privilege elevation
CREATE OR REPLACE FUNCTION set_session_step_up_by_id(
  p_session_id uuid,
  p_step_up_until timestamptz
)
RETURNS TABLE (token_hash text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE sessions
  SET step_up_until = p_step_up_until
  WHERE id = p_session_id
    AND revoked_at IS NULL
  RETURNING token_hash;
$$;

REVOKE ALL ON FUNCTION set_session_step_up_by_id(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_session_step_up_by_id(uuid, timestamptz) TO hrms_app, hrms_worker;

-- 4. Re-ensure revoke_session_family returns token_hash for all sessions in that family
CREATE OR REPLACE FUNCTION revoke_session_family(p_family_id uuid)
RETURNS TABLE (
  token_hash text,
  session_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE sessions
  SET revoked_at = now()
  WHERE family_id = p_family_id AND revoked_at IS NULL
  RETURNING token_hash, id;
$$;

REVOKE ALL ON FUNCTION revoke_session_family(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_session_family(uuid) TO hrms_app, hrms_worker;
