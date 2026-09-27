import "server-only";

import { redirect } from "next/navigation";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type ProfileRole = "admin" | "employer" | "candidate";

/**
 * Returns the current authenticated user, or null if not logged in.
 * Uses the cookie-based server supabase client (anon key, RLS enforced).
 *
 * `null` means exactly "not authenticated" and nothing else. The one error
 * that genuinely means that is AuthSessionMissingError (no session cookie),
 * which is the ordinary anonymous path and is returned as null. Any other
 * error is an infrastructure failure — auth server down, network error, bad
 * env var — and is logged and rethrown so it surfaces as a 500. Swallowing it
 * used to make an outage indistinguishable from a mass logout: requireAuth()
 * saw `user === null` and redirected every visitor to /auth/login, and the
 * real cause never reached the logs.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isAuthSessionMissingError(error)) {
    console.error("[getCurrentUser] auth.getUser() failed", error);
    throw new Error(
      `Unable to resolve the current session: ${error.message}`,
      { cause: error }
    );
  }

  return user ?? null;
}

/**
 * Fetch the role for a given userId from public.profiles.
 * Returns null if no profile row exists or on error.
 */
export async function getProfileRole(
  userId: string
): Promise<ProfileRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  const role = data.role as string | null;
  if (role === "admin" || role === "employer" || role === "candidate") {
    return role;
  }
  return null;
}

/**
 * Require an authenticated session. If not logged in, redirect to /auth/login.
 * Returns the User on success.
 * An auth *infrastructure* failure propagates as a thrown error (500) rather
 * than a redirect — see getCurrentUser. A redirect is reserved for the real
 * "no session" case.
 */
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login");
  }
  return user;
}

/**
 * Require a specific role. Redirects to /auth/login if unauthenticated,
 * and to / if the user does not have the expected role.
 * Admin is considered to pass employer checks? No — strict per spec.
 * An auth infrastructure failure propagates as a thrown error (500).
 */
export async function requireRole(
  role: ProfileRole
): Promise<User> {
  const user = await requireAuth();
  const currentRole = await getProfileRole(user.id);
  if (currentRole !== role) {
    redirect("/");
  }
  return user;
}
