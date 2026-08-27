import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getProfileRole } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";

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

  let body: unknown;
  try {
    body = await request.json();
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

      const { error: insertError } = await supabase.from("jobs").insert(jobRow);

      if (insertError) {
        console.error("[POST /api/admin/postings] jobs insert error", insertError);
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }

      const { error: updateError } = await supabase
        .from("employer_postings")
        .update({
          status: "approved",
          reviewed_at: nowIso,
          rejection_reason: null,
        })
        .eq("id", posting.id);

      if (updateError) {
        console.error("[POST /api/admin/postings] posting update error", updateError);
        // Attempt to rollback? Keep job inserted but report error
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, jobId }, { status: 200 });
    } else {
      // REJECT
      const trimmedReason = (reason as string).trim();
      const { error: updateError } = await supabase
        .from("employer_postings")
        .update({
          status: "rejected",
          rejection_reason: trimmedReason,
          reviewed_at: nowIso,
        })
        .eq("id", posting.id);

      if (updateError) {
        console.error("[POST /api/admin/postings] reject update error", updateError);
        return NextResponse.json({ error: "internal" }, { status: 500 });
      }

      return NextResponse.json({ ok: true }, { status: 200 });
    }
  } catch (err) {
    console.error("[POST /api/admin/postings] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
