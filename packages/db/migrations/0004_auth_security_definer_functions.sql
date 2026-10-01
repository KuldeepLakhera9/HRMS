-- 0004_auth_security_definer_functions.sql
-- Security Definer functions for unauthenticated token lookups (Sessions and Single-use Auth Tokens)
-- These allow hrms_app and hrms_worker to look up/consume 256-bit hashed tokens before tenant context is known,
-- while preserving strict FORCE ROW LEVEL SECURITY on the tables for all direct queries.

-- Allow hrms_owner access for security definer functions while FORCE ROW LEVEL SECURITY remains active
DROP POLICY IF EXISTS sessions_owner_policy ON sessions;
CREATE POLICY sessions_owner_policy ON sessions
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS auth_tokens_owner_policy ON auth_tokens;
CREATE POLICY auth_tokens_owner_policy ON auth_tokens
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION lookup_session_by_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  user_id uuid,
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
  SELECT id, company_id, user_id, client_type, ip, user_agent, mfa_verified_at, step_up_until, idle_expires_at, absolute_expires_at
  FROM sessions
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND idle_expires_at > now()
    AND absolute_expires_at > now();
$$;

REVOKE ALL ON FUNCTION lookup_session_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_session_by_hash(text) TO hrms_app, hrms_worker;

CREATE OR REPLACE FUNCTION touch_session_by_id(p_session_id uuid, p_new_idle_expires_at timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE sessions
  SET last_seen_at = now(),
      idle_expires_at = p_new_idle_expires_at
  WHERE id = p_session_id
    AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION touch_session_by_id(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_session_by_id(uuid, timestamptz) TO hrms_app, hrms_worker;

CREATE OR REPLACE FUNCTION revoke_session_by_hash(p_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE sessions
  SET revoked_at = now()
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION revoke_session_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_session_by_hash(text) TO hrms_app, hrms_worker;

CREATE OR REPLACE FUNCTION consume_auth_token_by_hash(p_token_hash text, p_type text)
RETURNS TABLE (
  company_id uuid,
  user_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE auth_tokens
  SET used_at = now()
  WHERE token_hash = p_token_hash
    AND type = p_type
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING company_id, user_id;
$$;

REVOKE ALL ON FUNCTION consume_auth_token_by_hash(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_auth_token_by_hash(text, text) TO hrms_app, hrms_worker;
