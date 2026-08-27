import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";

export const dynamic = "force-dynamic";

// Zod schemas for filters
const filterSchema = z
  .object({
    field: z.enum(["ai", "cs", "robotics", "drone", "remote"]).optional(),
    location: z.enum(["de", "at", "ch", "remote"]).optional(),
    languageLevel: z.enum(["nice-to-have", "required", "fluent"]).optional(),
    employmentType: z.enum(["full-time", "part-time", "internship", "contract"]).optional(),
    remote: z.boolean().optional(),
    visa: z.boolean().optional(),
    q: z.string().max(100).optional(),
  })
  .strict();

const postBodySchema = z.object({
  name: z.string().min(2).max(40),
  filters: filterSchema,
});

// GET: list saved filters for current user
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("saved_filters")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/saved-filters] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/saved-filters] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

// POST: create a saved filter
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

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    return NextResponse.json({ error: "validation", details }, { status: 400 });
  }

  const { name, filters } = parsed.data;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("saved_filters")
      .insert({
        user_id: user.id,
        name: name.trim(),
        filters,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[POST /api/saved-filters] insert error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/saved-filters] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

// DELETE: remove saved filter, supports ?id= and body {id}
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let idRaw: string | null = request.nextUrl.searchParams.get("id");

  if (!idRaw) {
    try {
      const body = await request.json();
      const bId = (body as { id?: unknown })?.id;
      if (bId !== undefined && bId !== null) {
        idRaw = String(bId);
      }
    } catch {
      // no body or invalid json -> keep idRaw as is
    }
  }

  if (!idRaw || idRaw.trim().length === 0) {
    return NextResponse.json({ error: "validation", details: "id required" }, { status: 400 });
  }

  const trimmed = idRaw.trim();

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("saved_filters").delete().eq("id", trimmed).eq("user_id", user.id);

    if (error) {
      console.error("[DELETE /api/saved-filters] delete error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/saved-filters] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
