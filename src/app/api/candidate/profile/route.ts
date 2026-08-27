import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { candidateProfileSchema } from "@/lib/validations/candidate";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error) {
      // PGRST116 = no rows found
      const code = (error as { code?: string }).code;
      if (code === "PGRST116") {
        return NextResponse.json({ profile: null }, { status: 200 });
      }
      console.error("[GET /api/candidate/profile] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ profile: data }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/candidate/profile] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
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

  const parsed = candidateProfileSchema.safeParse(body);
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
    const { data: profile, error } = await supabase
      .from("candidate_profiles")
      .upsert(
        {
          user_id: user.id,
          display_name: data.display_name || null,
          headline: data.headline || null,
          bio: data.bio || null,
          skills: data.skills ?? [],
          languages: data.languages ?? [],
          preferred_locations: data.preferred_locations ?? [],
          preferred_fields: data.preferred_fields ?? [],
          visible: data.visible ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[PUT /api/candidate/profile] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ profile }, { status: 200 });
  } catch (err) {
    console.error("[PUT /api/candidate/profile] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
