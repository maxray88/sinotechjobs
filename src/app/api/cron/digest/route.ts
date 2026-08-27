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

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const hasVercelCron = !!request.headers.get("x-vercel-cron");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !hasVercelCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  if (!cronSecret) {
    console.warn("[cron/digest] CRON_SECRET not set — allowing unauthenticated request (dev only)");
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
    const supabase = getSupabaseAdmin();

    // Distinct users who have saved filters
    const { data: rows, error: distinctError } = await supabase.from("saved_filters").select("user_id");

    if (distinctError) {
      console.error("[cron/digest] distinctUsers fetch error", distinctError);
      return NextResponse.json({ error: "internal" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }

    const userIds = [...new Set((rows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean))];
    const totalUsers = userIds.length;

    if (totalUsers === 0) {
      return NextResponse.json({ sent: 0, skipped: 0, totalUsers: 0 }, { headers: { "Cache-Control": "no-store" } });
    }

    let sent = 0;
    let skipped = 0;

    for (const userId of userIds) {
      try {
        // Fetch filters for this user
        const { data: filtersRows, error: filtersError } = await supabase
          .from("saved_filters")
          .select("id, name, filters")
          .eq("user_id", userId);

        if (filtersError) {
          console.error("[cron/digest] filters fetch error for user", userId, filtersError);
          skipped += 1;
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
          skipped += 1;
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
          // Non-blocking: count as skipped, continue
          skipped += 1;
        }
      } catch (innerErr) {
        console.error("[cron/digest] per-user error", userId, innerErr);
        skipped += 1;
      }
    }

    return NextResponse.json({ sent, skipped, totalUsers }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cron/digest] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
