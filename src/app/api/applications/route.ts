import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(["saved", "applied", "screening", "interview", "offer", "rejected"]),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("user_id", user.id);

    if (error) {
      console.error("[GET /api/applications] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/applications] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rate limit 20/min
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = checkRateLimit(ip, 20, 60_000);
  if (!allowed) {
    const retryAfter = Math.ceil((retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "validation", details: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return NextResponse.json({ error: "validation", details }, { status: 400 });
  }

  const { jobId, status } = parsed.data;

  try {
    const supabase = getSupabaseAdmin();

    // check job exists
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      const code = (jobErr as { code?: string })?.code;
      if (code === "PGRST116" || !job) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      console.error("[PUT /api/applications] job check error", jobErr);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    const { data: application, error } = await supabase
      .from("applications")
      .upsert(
        {
          user_id: user.id,
          job_id: jobId,
          status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,job_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[PUT /api/applications] upsert error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ application }, { status: 200 });
  } catch (err) {
    console.error("[PUT /api/applications] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
