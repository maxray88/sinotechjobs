import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db/client";
import { buildDigestForUser } from "@/lib/digest";
import { sendEmail } from "@/lib/email";

// Do NOT add a second cron entry in vercel.json — Vercel Hobby allows only one cron.
// This digest route is intended to be triggered via chaining from /api/cron/daily
// (or via GitHub Actions on Mon 07:00 UTC). Keeping vercel.json with single daily cron
// avoids Hobby BLOCK. If you need scheduled weekly digest, chain it inside daily route
// or schedule an external trigger (e.g., GitHub Actions) that calls this endpoint with
// Authorization: Bearer $CRON_SECRET.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Per-user work below is sequential: three awaits (filters, auth lookup, digest
// build) plus one send, for every user. With maxDuration at 300s a large table
// is cut off mid-loop, so the fan-out is chunked per invocation and the
// remainder is reported rather than silently dropped.
const MAX_USERS_PER_RUN = 100;
// One row per saved filter, so a user holding several filters yields several rows.
const USER_SCAN_ROW_LIMIT = MAX_USERS_PER_RUN * 5;

export async function GET(request: NextRequest) {
  // Auth: Vercel Cron sends `authorization: Bearer ${CRON_SECRET}` when the
  // secret is configured. The Bearer token is the only accepted credential —
  // `x-vercel-cron` is client-supplied and trivially forged, so it is never
  // treated as authorisation. A forged header must not reach the fan-out below.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    // Fail closed: with no secret there is no way to tell a cron invocation from
    // an anonymous caller, and this route emails every account. Only dev runs
    // unauthenticated. Mirrors /api/cron/daily.
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/digest] CRON_SECRET not set — refusing unauthenticated request in production");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    console.warn("[cron/digest] CRON_SECRET not set — allowing unauthenticated request (dev only)");
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
    const supabase = getSupabaseAdmin();

    // Distinct users who have saved filters.
    //
    // CONSENT: "has >= 1 saved filter" is the only gate today, so saving a filter
    // is indistinguishable from opting into a weekly email. There is no opt-in or
    // notification-preference column in the schema (db/migrations/001..005 and
    // src/lib/db/types.ts), and sendEmail has no suppression list, so nothing
    // downstream can veto a send. An explicit opt-in column requires a migration
    // before this gate can be tightened; until then the batch cap below is what
    // bounds the blast radius of a single invocation.
    const { data: rows, error: distinctError } = await supabase
      .from("saved_filters")
      .select("user_id")
      .limit(USER_SCAN_ROW_LIMIT);

    if (distinctError) {
      console.error("[cron/digest] distinctUsers fetch error", distinctError);
      return NextResponse.json({ error: "internal" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }

    const userIds = [...new Set((rows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean))];
    const totalUsers = userIds.length;

    if (totalUsers === 0) {
      return NextResponse.json(
        { sent: 0, skipped: 0, failed: 0, totalUsers: 0, processed: 0, deferred: 0, truncated: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Chunk the fan-out: process a bounded prefix, report the remainder.
    const batch = userIds.slice(0, MAX_USERS_PER_RUN);
    const deferred = totalUsers - batch.length;
    if (deferred > 0) {
      console.warn(
        `[cron/digest] batch cap reached — processing ${batch.length} of ${totalUsers} users this run, ${deferred} deferred to the next invocation`
      );
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const userId of batch) {
      try {
        // Fetch filters for this user
        const { data: filtersRows, error: filtersError } = await supabase
          .from("saved_filters")
          .select("id, name, filters")
          .eq("user_id", userId);

        if (filtersError) {
          console.error("[cron/digest] filters fetch error for user", userId, filtersError);
          failed += 1;
          continue;
        }

        const filterEntries = (filtersRows ?? []) as { id: number | string; name: string; filters: Record<string, unknown> }[];
        if (filterEntries.length === 0) {
          skipped += 1;
          continue;
        }

        const filters = filterEntries.map((r) => r.filters) as Parameters<typeof buildDigestForUser>[1];
        const filterNames = filterEntries.map((r) => r.name);

        // Fetch user email via admin API
        const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);

        if (userError) {
          console.error("[cron/digest] getUserById error", userId, userError);
          failed += 1;
          continue;
        }

        const email = userData?.user?.email;
        if (!email) {
          skipped += 1;
          continue;
        }

        // Build digest (jobs matching any filter, deduped)
        const matches = await buildDigestForUser(userId, filters, sevenDaysAgo);

        if (matches.length === 0) {
          skipped += 1;
          continue;
        }

        // Slice to 10 for email
        const jobsToSend = matches.slice(0, 10);
        const count = matches.length;

        try {
          await sendEmail({
            to: email,
            locale: "en",
            template: "weekly_digest",
            data: {
              jobs: jobsToSend,
              count,
              filterNames,
            },
          });
          sent += 1;
        } catch (sendErr) {
          console.error("[cron/digest] sendEmail failed for", email, sendErr);
          // Non-blocking: count as a failure, continue
          failed += 1;
        }
      } catch (innerErr) {
        console.error("[cron/digest] per-user error", userId, innerErr);
        failed += 1;
      }
    }

    // Every branch above increments exactly one counter, so this sum is the number
    // of users actually attempted — logged so a partial run is visible, not silent.
    const processed = sent + skipped + failed;
    console.log(
      `[cron/digest] processed ${processed}/${batch.length} users this run — sent=${sent} skipped=${skipped} failed=${failed} deferred=${deferred} totalUsers=${totalUsers}`
    );

    return NextResponse.json(
      { sent, skipped, failed, totalUsers, processed, deferred, truncated: deferred > 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[cron/digest] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
