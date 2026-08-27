import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const BUCKET = "cvs";

// GET: return latest CV with signed URL (owner-only)
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from("cvs")
      .select("*")
      .eq("user_id", user.id)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST116") {
        return NextResponse.json({ cv: null }, { status: 200 });
      }
      console.error("[GET /api/cvs] DB error", error);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ cv: null }, { status: 200 });
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 3600);

    if (signedError || !signedData) {
      console.error("[GET /api/cvs] signedUrl error", signedError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ cv: row, signedUrl: signedData.signedUrl }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/cvs] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

// POST: upload PDF ≤5MB to private bucket, signed URLs owner-only
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rate limit 5/min for POST
  const ip = getClientIp(req);
  const { allowed, retryAfterMs } = checkRateLimit(ip, 5, 60_000);
  if (!allowed) {
    const retryAfter = Math.ceil((retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "validation", details: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;

  if (!file || !(file instanceof File) || typeof file.name !== "string") {
    return NextResponse.json({ error: "validation", details: "file required" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "validation", details: "empty file" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "too_large", max: "5MB" }, { status: 400 });
  }

  const storage_path = `${user.id}/${Date.now()}-${file.name}`;

  try {
    const supabase = getSupabaseAdmin();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storage_path, file, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("[POST /api/cvs] upload error", uploadError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("cvs")
      .insert({
        user_id: user.id,
        storage_path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      })
      .select()
      .single();

    if (insertError || !inserted) {
      console.error("[POST /api/cvs] DB insert error", insertError);
      // best-effort cleanup of uploaded object on DB failure
      try {
        await supabase.storage.from(BUCKET).remove([storage_path]);
      } catch {}
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ cv: inserted }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/cvs] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

// DELETE: remove CV row + storage object (owner-only), query ?id=
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");

  if (!id || id.trim().length === 0) {
    return NextResponse.json({ error: "validation", details: "id required" }, { status: 400 });
  }

  const trimmedId = id.trim();

  try {
    const supabase = getSupabaseAdmin();

    // Fetch row to get storage_path and verify ownership
    const { data: row, error: fetchError } = await supabase
      .from("cvs")
      .select("*")
      .eq("id", trimmedId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !row) {
      const code = (fetchError as { code?: string })?.code;
      if (code === "PGRST116" || !row) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      console.error("[DELETE /api/cvs] fetch error", fetchError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    const storagePath = (row as { storage_path: string }).storage_path;

    // Remove storage object (best-effort)
    try {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (removeError) {
        console.error("[DELETE /api/cvs] storage remove error", removeError);
      }
    } catch (e) {
      console.error("[DELETE /api/cvs] storage remove exception", e);
    }

    const { error: deleteError } = await supabase
      .from("cvs")
      .delete()
      .eq("id", trimmedId)
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("[DELETE /api/cvs] DB delete error", deleteError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/cvs] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
