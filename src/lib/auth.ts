import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type ProfileRole = "admin" | "employer" | "candidate";

/**
 * Returns the current authenticated user, or null if not logged in.
 * Uses the cookie-based server supabase client (anon key, RLS enforced).
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
