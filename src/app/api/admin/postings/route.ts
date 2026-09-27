import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getProfileRole } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { sendEmail, isValidRecipient } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";

// Ordered fallback fields, most authoritative first.
const FALLBACK_EMAIL_FIELDS = ["contact_email", "email", "applicant_email"] as const;

// This route only carries an id, an action and a <=500 char reason.
const MAX_BODY_BYTES = 8_192;

/**
 * Pick the first candidate that is actually deliverable.
 *
 * `??` only falls through on null/undefined, so a present-but-invalid value
 * (e.g. "n/a") used to short-circuit the chain and mask a valid address later
 * in it. Each rejected candidate is logged, because a drop here is otherwise
 * invisible: the posting is approved but the employer is never notified.
 */
function pickRecipientEmail(
  posting: Record<string, unknown>,
  postingId: unknown
): string | null {
  for (const field of FALLBACK_EMAIL_FIELDS) {
    const value = posting[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    if (isValidRecipient(value)) return value;
    console.warn(
      `[POST /api/admin/postings] ${field} for posting ${String(postingId)} is not a valid email address — trying the next candidate`
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  // Auth: require admin role
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = await getProfileRole(user.id);
  if (role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Approve/reject is the highest-value write in the app (it publishes a job), so
  // it is rate limited too. Keyed on the admin's session user id rather than the
  // client IP: this route is only reachable by an authenticated admin, and IP
  // keying would let one admin exhaust the budget for everyone behind the same NAT.
  const { allowed, retryAfterMs } = checkRateLimit(`admin-postings:${user.id}`, 60, 60_000);
  if (!allowed) {
    const retryAfter = Math.ceil((retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: unknown;
  try {
    // Reject oversized bodies before they are buffered. App Router handlers impose
    // no default body cap, so an absent Content-Length (chunked) is caught by the
    // length check on the buffered text below instead.
    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const id = payload.id;
  const action = payload.action;
  const reason = payload.reason as string | undefined;

  // Validate id
  if (typeof id !== "number" || !Number.isInteger(id)) {
    return NextResponse.json({ error: "id must be a number" }, { status: 400 });
  }

  // Validate action
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  // Validate reason if reject
  if (action === "reject") {
    if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500) {
      return NextResponse.json(
        { error: "reason must be 5-500 characters" },
        { status: 400 }
      );
    }
  }

  try {
    const supabase = getSupabaseAdmin();

    // Fetch posting
    const { data: posting, error: fetchError } = await supabase
      .from("employer_postings")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !posting) {
      // Supabase returns error code PGRST116 when not found with single()
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Check status pending else 409
    if (posting.status !== "pending") {
      return NextResponse.json({ error: "conflict: already reviewed" }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const today = nowIso.split("T")[0];

    if (action === "approve") {
      // Map posting fields to jobs row
      const tier = (posting.tier as string) ?? "free";
      const isFeatured = tier !== "free";
      const featuredUntil = isFeatured
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const requirementsArray: string[] = (() => {
        const raw = posting.requirements as string | null;
        if (!raw || typeof raw !== "string") return [];
        return raw
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
      })();

      const jobId = `manual-${posting.id}`;

      const jobRow = {
        id: jobId,
        title: posting.job_title,
        title_zh: posting.job_title_zh ?? null,
        company: posting.company,
        company_zh: null,
        field: (posting.field as string) ?? null,
        location: posting.location ?? null,
        location_code: null,
        language_level: (posting.language_level as string) ?? null,
        employment_type: (posting.employment_type as string) ?? null,
        salary_range: posting.salary_range ?? null,
        description: posting.description ?? "",
        description_zh: posting.description_zh ?? null,
        requirements: requirementsArray,
        requirements_zh: [],
        tags: [] as string[],
        application_url: posting.application_url as string,
        source_url: null,
        posted_date: today,
        remote_friendly: posting.remote_friendly ?? false,
        visa_sponsorship: posting.visa_sponsorship ?? false,
        featured: isFeatured,
        featured_until: featuredUntil,
        tier: tier,
        source: "manual",
        source_id: String(posting.id),
        created_at: nowIso,
        updated_at: nowIso,
      };

      // 1. Claim the posting atomically FIRST. The `status = 'pending'` predicate
      //    is what makes this safe under concurrency: the read at the top of this
      //    handler is advisory only, so whichever request updates the row first
      //    wins and the loser updates zero rows and must not publish anything.
      const { data: claimed, error: claimError } = await supabase
        .from("employer_postings")
        .update({
          status: "approved",
          reviewed_at: nowIso,
          rejection_reason: null,
        })
        .eq("id", posting.id)
        .eq("status", "pending")
        .select("id");

      if (claimError) {
        console.error("[POST /api/admin/postings] approve update error", claimError, "posting", posting.id);
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }

      // PostgREST returns the rows the UPDATE actually touched when .select() is
      // chained. An empty array means the `status = 'pending'` guard matched
      // nothing: a concurrent request already handled this posting.
      //
      // Fail closed. `Array.isArray(claimed) && claimed.length === 0` only
      // catches a *present but empty* array, so any payload that is absent or
      // null fell through the guard and the posting was published anyway. We
      // cannot prove rows were claimed, so we must assume they were not.
      if ((claimed?.length ?? 0) === 0) {
        console.warn("[POST /api/admin/postings] approve lost race — posting", posting.id, "was already reviewed");
        return NextResponse.json({ error: "conflict: already reviewed", ok: false }, { status: 409 });
      }

      // 2. Only now publish. Inserting after the claim means a failure here is
      //    recoverable: the posting is rolled back to pending below so a retry
      //    starts from a clean state, rather than leaving a published jobs row
      //    behind a still-pending posting and colliding with the `manual-<id>`
      //    primary key on every subsequent retry.
      const { error: insertError } = await supabase.from("jobs").insert(jobRow);

      if (insertError) {
        console.error(
          "[POST /api/admin/postings] jobs insert error — rolling posting back to pending",
          insertError,
          "posting",
          posting.id,
          "jobId",
          jobId
        );
        // Best effort. A stuck row here needs manual repair, so say so loudly
        // rather than reporting a clean 500.
        try {
          const { error: rollbackError } = await supabase
            .from("employer_postings")
            .update({ status: "pending", reviewed_at: null })
            .eq("id", posting.id)
            .eq("status", "approved");
          if (rollbackError) {
            console.error(
              "[POST /api/admin/postings] rollback FAILED — posting",
              posting.id,
              "is left approved with no jobs row and needs manual repair",
              rollbackError
            );
          }
        } catch (rollbackErr) {
          console.error(
            "[POST /api/admin/postings] rollback threw — posting",
            posting.id,
            "is left approved with no jobs row and needs manual repair",
            rollbackErr
          );
        }
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }

      // Fire-and-forget approval email (non-blocking)
      try {
        let recipientEmail: string | null = null;
        try {
          if (posting.user_id) {
            const { data: authData } = await getSupabaseAdmin().auth.admin.getUserById(
              posting.user_id as string
            );
            if (authData?.user?.email) recipientEmail = authData.user.email;
          }
        } catch {}
        if (!recipientEmail) {
          const maybe = posting as Record<string, unknown>;
          recipientEmail = pickRecipientEmail(maybe, posting.id);
        }
        if (recipientEmail) {
          void sendEmail({
            to: recipientEmail,
            locale: "en",
            template: "posting_approved",
            data: { jobTitle: posting.job_title as string, company: posting.company as string, jobId },
          }).catch((err) => console.error("[POST /api/admin/postings] email error", err));
        }
      } catch (err) {
        console.error("[POST /api/admin/postings] email error", err);
      }

      return NextResponse.json({ ok: true, jobId }, { status: 200 });
    } else {
      // REJECT
      const trimmedReason = (reason as string).trim();
      // Same atomic guard as the approve branch: re-assert `pending` in the
      // UPDATE so a concurrent approve cannot be overwritten to rejected after
      // the job has already gone live.
      const { data: claimed, error: updateError } = await supabase
        .from("employer_postings")
        .update({
          status: "rejected",
          rejection_reason: trimmedReason,
          reviewed_at: nowIso,
        })
        .eq("id", posting.id)
        .eq("status", "pending")
        .select("id");

      if (updateError) {
        console.error("[POST /api/admin/postings] reject update error", updateError, "posting", posting.id);
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }

      // Same fail-closed reasoning as the approve branch: a rejected posting
      // must never overwrite an approve that already went live.
      if ((claimed?.length ?? 0) === 0) {
        console.warn("[POST /api/admin/postings] reject lost race — posting", posting.id, "was already reviewed");
        return NextResponse.json({ error: "conflict: already reviewed", ok: false }, { status: 409 });
      }

      // Fire-and-forget rejection email (non-blocking)
      try {
        let recipientEmail: string | null = null;
        try {
          if (posting.user_id) {
            const { data: authData } = await getSupabaseAdmin().auth.admin.getUserById(
              posting.user_id as string
            );
            if (authData?.user?.email) recipientEmail = authData.user.email;
          }
        } catch {}
        if (!recipientEmail) {
          const maybe = posting as Record<string, unknown>;
          recipientEmail = pickRecipientEmail(maybe, posting.id);
        }
        if (recipientEmail) {
          void sendEmail({
            to: recipientEmail,
            locale: "en",
            template: "posting_rejected",
            data: {
              jobTitle: posting.job_title as string,
              company: posting.company as string,
              reason: trimmedReason,
            },
          }).catch((err) => console.error("[POST /api/admin/postings] email error", err));
        }
      } catch (err) {
        console.error("[POST /api/admin/postings] email error", err);
      }

      return NextResponse.json({ ok: true }, { status: 200 });
    }
  } catch (err) {
    console.error("[POST /api/admin/postings] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
