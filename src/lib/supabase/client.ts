"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

function resolveUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) {
    throw new Error(
      "Missing Supabase URL: set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in env"
    );
  }
  return url;
}

function resolveAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "Missing Supabase publishable key: set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in env"
    );
  }
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

let browserClient: AnySupabaseClient | null = null;

export function createClient(): AnySupabaseClient {
  if (browserClient) return browserClient as AnySupabaseClient;
  const url = resolveUrl();
  const anonKey = resolveAnonKey();
  browserClient = createBrowserClient(url, anonKey) as unknown as AnySupabaseClient;
  return browserClient as AnySupabaseClient;
}
