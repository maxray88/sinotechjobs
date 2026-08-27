import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase clients — server-only
// ---------------------------------------------------------------------------
// This module is server-only (enforced by `import "server-only"` as first line).
// Importing it from a Client Component will throw at build time.
// Secrets (SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY) never leak to the browser.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

let adminClient: AnySupabaseClient | null = null;
let publicClient: AnySupabaseClient | null = null;

function resolveUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function resolveSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function resolvePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Returns a Supabase client with elevated privileges (service role / secret key).
 * Requires SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY.
 * Will throw if the secret is missing — never silently falls back to the
 * publishable key in production. Caller expects service_role bypass; using
 * the anon key would hide misconfiguration and subject writes to RLS.
 */
export function getSupabaseAdmin(): AnySupabaseClient {
  if (adminClient) return adminClient;

  const url = resolveUrl();
  if (!url) {
    throw new Error(
      "Missing Supabase URL: set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in env"
    );
  }

  const secret = resolveSecretKey();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) — admin client requires service role key. Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in production."
      );
    }

    // dev-only fallback: allow publishable key outside production so local dev
    // without a secret can still run, but make it explicit that RLS will apply.
    const fallback = resolvePublishableKey();
    if (fallback) {
      console.warn(
        "[Supabase] SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY not set — dev-only fallback to publishable key. RLS will apply. Set a secret key for admin operations."
      );
      adminClient = createClient(url, fallback, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return adminClient;
    }

    throw new Error(
      "Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) — admin client requires service role key"
    );
  }

  adminClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}

/**
 * Returns a Supabase client for anonymous / public reads (RLS-enforced).
 * Uses the publishable / anon key. Suitable for client-side or server-side
 * reads that should respect Row Level Security.
 */
export function getSupabasePublic(): AnySupabaseClient {
  if (publicClient) return publicClient;

  const url = resolveUrl();
  if (!url) {
    throw new Error(
      "Missing Supabase URL: set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in env"
    );
  }

  const anonKey = resolvePublishableKey();
  if (!anonKey) {
    throw new Error(
      "Missing Supabase publishable key: set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in env"
    );
  }

  publicClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return publicClient;
}

// For testing: reset cached singleton clients
export function __resetSupabaseClientsForTest(): void {
  adminClient = null;
  publicClient = null;
}
