import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { candidateProfileSchema } from "@/lib/validations/candidate";

export const dynamic = "force-dynamic";

// Columns returned to the client. user_id is the row key the UI already knows,
// created_at/updated_at are shown as profile metadata; nothing else is exposed.
const PROFILE_COLUMNS =
  "user_id,display_name,headline,bio,skills,languages,preferred_locations,preferred_fields,visible,created_at,updated_at";

const PROFILE_TEXT_FIELDS = ["display_name", "headline", "bio"] as const;
const PROFILE_ARRAY_FIELDS = [
  "skills",
  "languages",
  "preferred_locations",
  "preferred_fields",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// An explicit null means "clear this field" and is normalised to the empty value
// the schema accepts, so it survives validation and still clears the column.
function normaliseExplicitClears(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const field of PROFILE_TEXT_FIELDS) {
    if (out[field] === null) out[field] = "";
  }
  for (const field of PROFILE_ARRAY_FIELDS) {
    if (out[field] === null) out[field] = [];
  }
  if (out.visible === null) out.visible = false;
  return out;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("candidate_profiles")
      .select(PROFILE_COLUMNS)
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

  // The schema applies .default() to every optional field, so `parsed.data`
  // cannot tell "omitted" from "sent as the default". Presence must be read
  // from the raw body instead.
  const raw = isPlainObject(body) ? body : {};
  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;

  const parsed = candidateProfileSchema.safeParse(normaliseExplicitClears(raw));
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return NextResponse.json({ error: "validation", details }, { status: 400 });
  }

  const data = parsed.data;

  // Build the upsert payload from present keys only. An absent key is omitted
  // from the payload, so on an existing row PostgREST's ON CONFLICT DO UPDATE
  // leaves that column untouched; on a brand-new row the column falls back to
  // its DB default, so a first-time PUT still creates the row.
  const payload: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  for (const field of PROFILE_TEXT_FIELDS) {
    if (!has(field)) continue;
    const value = data[field];
    payload[field] = typeof value === "string" && value.length > 0 ? value : null;
  }
  for (const field of PROFILE_ARRAY_FIELDS) {
    if (!has(field)) continue;
    payload[field] = data[field] ?? [];
  }
  if (has("visible")) {
    payload.visible = data.visible ?? false;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: profile, error } = await supabase
      .from("candidate_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select(PROFILE_COLUMNS)
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
