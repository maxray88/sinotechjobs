import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { rowToJob } from "@/lib/db/mappers";
import SavedClient from "./SavedClient";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login?next=/saved");
  }

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("saved_jobs")
    .select("job_id,saved_at")
    .eq("user_id", user.id)
    .order("saved_at", { ascending: false });

  if (error) {
    console.error("[GET /saved] DB error", error);
    return <SavedClient items={[]} />;
  }

  if (!rows || rows.length === 0) {
    return <SavedClient items={[]} />;
  }

  const jobIds = rows.map((r: { job_id: string }) => r.job_id);
  const { data: jobRows } = await supabase.from("jobs").select("*").in("id", jobIds);

  const mapped = (jobRows || []).map((r: unknown) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rowToJob(r as any);
    } catch {
      return r;
    }
  }) as import("@/lib/types").Job[];

  const byId = new Map<string, import("@/lib/types").Job>();
  for (const j of mapped) byId.set(j.id, j);
  const ordered = jobIds.map((id: string) => byId.get(id)).filter(Boolean) as import("@/lib/types").Job[];

  return <SavedClient items={ordered} />;
}
