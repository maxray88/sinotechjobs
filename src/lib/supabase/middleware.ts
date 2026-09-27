import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function resolveUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function resolveAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const url = resolveUrl();
  const anonKey = resolveAnonKey();

  // DELIBERATELY different from src/lib/supabase/server.ts, which hard-throws
  // on the same missing env. This file runs on EVERY request, including public
  // unauthenticated pages, so throwing here would turn one missing env var into
  // a site-wide outage. Keep the graceful pass-through — but say so in the log.
  // A silent skip gives an operator zero signal that a deploy is misconfigured.
  if (!url || !anonKey) {
    const missing: string[] = [];
    if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
    if (!anonKey)
      missing.push(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
      );
    console.error(
      `[middleware] Supabase env missing (${missing.join(", ")}) — ` +
        "serving the request WITHOUT session refresh. Authed pages will behave " +
        "as signed-out. Fix the environment; this is not a supported state.",
    );
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]
      ) {
        cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(
          ({
            name,
            value,
            options,
          }: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              options as Parameters<typeof supabaseResponse.cookies.set>[2]
            )
        );
      },
    },
  });

  // IMPORTANT: Do not add logic between createServerClient and getUser()
  // getUser() refreshes the session and re-validates the auth cookie.
  //
  // DELIBERATELY fail-OPEN for availability. This is the exact opposite of the
  // fail-closed posture in §4 of AGENTS.md (CRON_SECRET, Stripe webhook, admin
  // role) and that inversion is intentional: those are AUTHORISATION decisions
  // where denying is the safe default, whereas this is a session REFRESH, which
  // grants nothing. An unguarded rejection here (Supabase network blip, DNS
  // failure, a non-empty but bogus URL/key) propagates out of updateSession and
  // Next.js 500s EVERY request, public pages included — a total outage caused
  // by a third party. Log loudly and continue without a session: a
  // degraded-but-serving site beats that. Do NOT "fix" this into a throw.
  try {
    await supabase.auth.getUser();
  } catch (err) {
    console.error(
      "[middleware] supabase.auth.getUser() failed — continuing WITHOUT a " +
        "refreshed session (fail-open, availability over strictness):",
      err,
    );
  }

  return supabaseResponse;
}
