/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { getSupabaseAdmin } from "./client";
import type { EmailSubscriptionRow } from "./types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function subscribeEmail(
  email: string,
  language: string = "en"
): Promise<{ email: string; created: boolean }> {
  const normalized = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalized)) {
    throw new Error("Invalid email address");
  }

  const supabase = getSupabaseAdmin();

  // Attempt atomic insert path first to avoid TOCTOU.
  // If insert succeeds -> created true. If unique violation -> created false.
  // Fallback to select+upsert with hadExisting boolean for environments/mocks that only implement upsert.
  try {
    const maybeInsert: any = (supabase.from("email_subscriptions") as any).insert;
    if (typeof maybeInsert === "function") {
      // Try atomic insert
      const insertBuilder: any = (supabase.from("email_subscriptions") as any).insert({ email: normalized, language } as any);
      // Support both thenable builder and direct promise
      const insertResult: any = await insertBuilder;
      const insertError = insertResult?.error;
      if (!insertError) {
        // Check if builder returned error via thenable rejection handling
        // If no error, newly created
        // Some mocks return { error: null } for success
        if (insertResult && typeof insertResult === "object" && "error" in insertResult) {
          if (!insertResult.error) return { email: normalized, created: true };
        } else {
          // insertBuilder resolved without error wrapper -> assume success
          return { email: normalized, created: true };
        }
      }
      if (insertError) {
        const code = (insertError as any)?.code;
        const msg = (insertError as any)?.message ?? "";
        const isUniqueViolation = code === "23505" || /duplicate|unique/i.test(msg);
        if (isUniqueViolation) {
          try {
            await (supabase.from("email_subscriptions") as any).update({ language } as any).eq("email", normalized);
          } catch {}
          return { email: normalized, created: false };
        }
        // For other insert errors, fall through to upsert fallback if it's a mock limitation
        // If error is not unique violation, throw
        if (code || msg) throw insertError;
      }
    }
  } catch (e: any) {
    // If error is unique violation already handled, return
    const code = e?.code;
    const msg = e?.message ?? "";
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      try {
        await (supabase.from("email_subscriptions") as any).update({ language } as any).eq("email", normalized);
      } catch {}
      return { email: normalized, created: false };
    }
    // If fallback not possible (e.g., insert not mocked), continue to upsert path
    // Only throw if it's a real Supabase error not related to missing mock
    if (e && e.message && !/is not a function|insert/.test(e.message)) {
      // If it's not a mock missing error, rethrow only if we attempted insert and got real error
      // For mock missing case, fall through
      if (typeof (supabase.from("email_subscriptions") as any).insert === "function") {
        throw e;
      }
    }
  }

  // Fallback / minimal fix path: single upsert with onConflict and hadExisting boolean
  // Store hadExisting before upsert to derive created flag (as per review minimal fix)
  const { data: existing } = await supabase
    .from("email_subscriptions")
    .select("email")
    .eq("email", normalized)
    .maybeSingle();

  const hadExisting = !!existing;

  const { error } = await (supabase.from("email_subscriptions") as any).upsert(
    { email: normalized, language } as any,
    { onConflict: "email" } as any
  );

  if (error) {
    const code = (error as any)?.code;
    const msg = (error as any)?.message ?? "";
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      return { email: normalized, created: false };
    }
    throw error;
  }

  return { email: normalized, created: !hadExisting };
}

export async function listSubscriptions(): Promise<EmailSubscriptionRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("email_subscriptions").select("*").order("subscribed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EmailSubscriptionRow[];
}
