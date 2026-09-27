-- Migration: 006_lock_profile_role
-- Date: 2026-09-27
-- Description: Make profiles.role immutable to the `authenticated` role.
-- Impact: closes a privilege-escalation path. Before this, any signed-in user
--   could call PostgREST directly with no application route involved:
--     PATCH /rest/v1/profiles?id=eq.<own-uuid>  {"role":"admin"}
--   Both clauses of "Users can update own profile" (002_auth_policies) passed,
--   because they constrain ROW OWNERSHIP only and never mention `role`.
--   getProfileRole() then returned "admin" and requireRole("admin") opened
--   every admin surface, including /api/admin/postings (approve/reject jobs
--   and read employer submissions).
-- Dependencies: 001_init.sql (profiles), 002_auth_policies.sql (policies)
-- Idempotent: DROP POLICY IF EXISTS / CREATE POLICY. The REVOKE is a no-op
--   once the column ACL already omits the privilege, so re-running is safe.
--
-- Two independent layers, deliberately both applied:
--
--   (a) REVOKE UPDATE (role) — the primary mechanism. Column privileges live
--       in pg_attribute.attacl and are AUTHORITATIVE for that column: when a
--       column ACL entry exists, the table-level privilege in pg_class.relacl
--       is not consulted for that column. Postgres handles the revoke against
--       a table-level GRANT by synthesising the column ACL from the table ACL
--       minus the revoked privilege, which is what makes this bite here. It
--       matters that the migrations contain no GRANTs at all, so `profiles`
--       carries Supabase's default table-level ALL for `authenticated`.
--
--   (b) WITH CHECK pinned to the stored (pre-update) role — defence in depth,
--       so `role` stays immutable even if a grant is later widened (for
--       example a blanket GRANT re-applied by a later migration). The scalar
--       subquery is evaluated with the UPDATE's statement snapshot, under
--       which the in-flight new row version is not yet visible, so it reads
--       the row's stored pre-update role. Note the subquery is itself subject
--       to the SELECT policy on profiles; that policy does not reference
--       profiles again, so there is no policy-recursion error.
--
-- Deliberately NOT changed:
--   * USING is left as row ownership only. Pinning USING would add nothing —
--     WITH CHECK is the clause that guards the new row.
--   * The SELECT policy is untouched: users must still be able to read their
--     own role, and getProfileRole() depends on it.
--   * service_role keeps its table-level UPDATE, so the SECURITY DEFINER
--     signup trigger and scripts/promote-admin.ts keep working. Only
--     `authenticated` is revoked from.

-- (a) Column-level privilege — `role` is no longer writable by any signed-in
--     user. Ownership updates (display_name) are unaffected; only the `role`
--     column is taken away.
REVOKE UPDATE (role) ON public.profiles FROM authenticated;

-- (b) Policy guard — the new row must still carry the role the row already had.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  );
