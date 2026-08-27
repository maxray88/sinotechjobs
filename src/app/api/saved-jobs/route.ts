import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";
import { rowToJob } from "@/lib/db/mappers";

export const dynamic = "force-dynamic";

// GET: list saved jobs for current user
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from("saved_jobs")
      .select("job_id,saved_at")
      .eq("user_id", user.id)
      .order("saved_at", { ascending: false });

    if (error) {
      console.error("[GET /api/saved-jobs] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ items: [], saved: [] }, { status: 200 });
    }

    const jobIds = rows.map((r: { job_id: string }) => r.job_id);

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .in("id", jobIds);

    if (jobError) {
      console.error("[GET /api/saved-jobs] jobs fetch error", jobError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // Map rows to domain Jobs, preserve order by saved_at (rows order)
    const mapped = (jobRows || []).map((r: unknown) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return rowToJob(r as any);
      } catch {
        return r;
      }
    });

    // Reorder items to match saved order: map jobIds order
    const byId = new Map<string, unknown>();
    for (const j of mapped as { id: string }[]) {
      byId.set(j.id, j);
    }
    const ordered = jobIds
      .map((id: string) => byId.get(id))
      .filter(Boolean);

    return NextResponse.json({ items: ordered, saved: rows }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/saved-jobs] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

// POST: save a job
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "validation", details: "Invalid JSON" }, { status: 400 });
  }

  const jobId = (body as { jobId?: unknown })?.jobId;
  if (typeof jobId !== "string" || jobId.trim().length === 0) {
    return NextResponse.json({ error: "validation", details: "jobId required" }, { status: 400 });
  }
  const trimmed = jobId.trim();

  const supabase = getSupabaseAdmin();

  // Check job exists
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", trimmed)
    .single();

  if (jobErr || !job) {
    const code = (jobErr as { code?: string })?.code;
    if (code === "PGRST116" || !job) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[POST /api/saved-jobs] job check error", jobErr);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Rate limit: 20 per minute
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = checkRateLimit(ip, 20, 60_000);
  if (!allowed) {
    const retryAfter = Math.ceil((retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // Check if already saved to return 200
  const { data: existing } = await supabase
    .from("saved_jobs")
    .select("job_id")
    .eq("user_id", user.id)
    .eq("job_id", trimmed)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ saved: true }, { status: 200 });
  }

  const { error: insertError } = await supabase
    .from("saved_jobs")
    .insert({ user_id: user.id, job_id: trimmed })
    // use upsert fallback if needed: but insert with primary key conflict handling
    // supabase-js supports .upsert with onConflict; we use insert and handle duplicate
    ;

  if (insertError) {
    // duplicate primary key -> treat as already exists
    const code = (insertError as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ saved: true }, { status: 200 });
    }
    console.error("[POST /api/saved-jobs] insert error", insertError);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return NextResponse.json({ saved: true }, { status: 201 });
}

// DELETE: remove saved job, supports ?jobId= and body {jobId}
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let jobId: string | null = request.nextUrl.searchParams.get("jobId") || request.nextUrl.searchParams.get("job_id");

  if (!jobId) {
    try {
      const body = await request.json();
      const bJobId = (body as { jobId?: unknown })?.jobId || (body as { job_id?: unknown })?.job_id;
      if (typeof bJobId === "string" && bJobId.trim()) {
        jobId = bJobId.trim();
      }
    } catch {
      // no body or invalid json -> keep jobId as is
    }
  }

  if (!jobId || jobId.trim().length === 0) {
    return NextResponse.json({ error: "validation", details: "jobId required" }, { status: 400 });
  }

  const trimmed = jobId.trim();

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("saved_jobs")
    .delete()
    .eq("user_id", user.id)
    .eq("job_id", trimmed);

  if (error) {
    console.error("[DELETE /api/saved-jobs] delete error", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return NextResponse.json({ removed: true }, { status: 200 });
}
