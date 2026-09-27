import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const BUCKET = "cvs";
const MAX_CVS_PER_USER = 5;
const MAX_FILE_NAME = 200;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const CV_PUBLIC_COLUMNS = "id,file_name,file_size,mime_type,uploaded_at";

// Storage keys are UUID-based; the client filename is only ever stored as a
// display label. Basename only (no path separators), no control characters,
// length-capped.
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_FILE_NAME) || "resume.pdf";
}

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
      .select(`storage_path,${CV_PUBLIC_COLUMNS}`)
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

    // storage_path is internal — strip it from the payload the client receives.
    const { storage_path: storagePath, ...publicRow } = row as Record<string, unknown>;

    const { data: signedData, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(String(storagePath), 3600);

    if (signedError || !signedData) {
      console.error("[GET /api/cvs] signedUrl error", signedError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    return NextResponse.json({ cv: publicRow, signedUrl: signedData.signedUrl }, { status: 200 });
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

  // Rate limit 5/min for POST — enforced per IP *and* per session user so one
  // account cannot rotate IPs to keep uploading.
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(ip, 5, 60_000);
  const userLimit = checkRateLimit(`cv:user:${user.id}`, 5, 60_000);
  if (!ipLimit.allowed || !userLimit.allowed) {
    const retryAfter = Math.ceil(
      Math.max(ipLimit.retryAfterMs ?? 0, userLimit.retryAfterMs ?? 0) / 1000
    );
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

  // file.type is client-asserted, so verify the %PDF- magic number in the bytes
  // before anything is written to the bucket.
  let isPdf = false;
  try {
    const header = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
    isPdf = header.length === PDF_MAGIC.length && PDF_MAGIC.every((b, i) => header[i] === b);
  } catch {
    isPdf = false;
  }
  if (!isPdf) {
    return NextResponse.json({ error: "invalid_type", details: "Not a PDF file" }, { status: 400 });
  }

  // Storage key is UUID-based: the client-supplied name never reaches the path.
  const storage_path = `${user.id}/${crypto.randomUUID()}.pdf`;
  const file_name = sanitizeFileName(file.name);

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
        file_name,
        file_size: file.size,
        mime_type: file.type,
        // Set explicitly: the column has a DB default, but relying on it makes
        // "latest CV" ordering depend on server clock vs. transaction time.
        uploaded_at: new Date().toISOString(),
      })
      .select(CV_PUBLIC_COLUMNS)
      .single();

    if (insertError || !inserted) {
      console.error("[POST /api/cvs] DB insert error", insertError);
      // best-effort cleanup of uploaded object on DB failure
      try {
        await supabase.storage.from(BUCKET).remove([storage_path]);
      } catch {}
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // Enforce the per-user cap: delete both the row and the storage object for
    // every CV beyond it, so we never orphan a file in the bucket.
    try {
      const { data: older } = await supabase
        .from("cvs")
        .select("id,storage_path")
        .eq("user_id", user.id)
        .order("uploaded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(MAX_CVS_PER_USER, MAX_CVS_PER_USER + 99);

      const stale = (older ?? []) as { id: number; storage_path: string }[];
      if (stale.length > 0) {
        const { error: removeError } = await supabase.storage
          .from(BUCKET)
          .remove(stale.map((r) => r.storage_path).filter(Boolean));
        if (removeError) {
          console.error("[POST /api/cvs] prune storage remove error", removeError);
        }
        const { error: deleteError } = await supabase
          .from("cvs")
          .delete()
          .eq("user_id", user.id)
          .in(
            "id",
            stale.map((r) => r.id)
          );
        if (deleteError) {
          console.error("[POST /api/cvs] prune row delete error", deleteError);
        }
      }
    } catch (pruneErr) {
      // Pruning is best-effort; the upload itself already succeeded.
      console.error("[POST /api/cvs] prune unexpected error", pruneErr);
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
      .select("id,storage_path")
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
