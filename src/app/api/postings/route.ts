import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { postingSchema } from "@/lib/validations/posting";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = checkRateLimit(ip, 10, 60_000);
  if (!allowed) {
    const retryAfter = Math.ceil((retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "validation", details: [{ path: "body", message: "Invalid JSON", code: "invalid_json" }] },
      { status: 400 }
    );
  }

  const parsed = postingSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return NextResponse.json({ error: "validation", details }, { status: 400 });
  }

  const data = parsed.data;

  try {
    const supabase = getSupabaseAdmin();
    const { data: inserted, error } = await supabase
      .from("employer_postings")
      .insert({
        user_id: user.id,
        job_title: data.job_title,
        job_title_zh: data.job_title_zh || null,
        company: data.company,
        location: data.location,
        field: data.field,
        language_level: data.language_level,
        employment_type: data.employment_type,
        salary_range: data.salary_range || null,
        description: data.description,
        description_zh: data.description_zh || null,
        requirements: data.requirements || null,
        application_url: data.application_url,
        remote_friendly: data.remote_friendly,
        visa_sponsorship: data.visa_sponsorship,
        tier: data.tier,
        status: "pending",
        payment_status: "unpaid",
        stripe_session_id: null,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("[POST /api/postings] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // Fire-and-forget email notification (non-blocking)
    try {
      if (user.email) {
        void sendEmail({
          to: user.email,
          locale: "en",
          template: "posting_submitted",
          data: { jobTitle: data.job_title, company: data.company },
        }).catch((err) => console.error("[POST /api/postings] email error", err));
      }
    } catch (err) {
      console.error("[POST /api/postings] email error", err);
    }

    return NextResponse.json({ id: inserted.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/postings] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("employer_postings")
      .select("*")
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false });

    if (error) {
      console.error("[GET /api/postings] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/postings] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
