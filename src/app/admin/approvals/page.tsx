import { redirect } from "next/navigation";
import { getCurrentUser, getProfileRole } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import ApprovalsClient from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function AdminApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login?next=/admin/approvals");
  }

  const role = await getProfileRole(user.id);
  if (role !== "admin") {
    redirect("/");
  }

  let pending: unknown[] = [];
  let recent: unknown[] = [];

  try {
    const supabase = getSupabaseAdmin();

    const { data: pendingData, error: pendingError } = await supabase
      .from("employer_postings")
      .select("*")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (!pendingError && pendingData) {
      pending = pendingData;
    } else if (pendingError) {
      console.error("[AdminApprovals] pending fetch error", pendingError);
    }

    const { data: recentData, error: recentError } = await supabase
      .from("employer_postings")
      .select("*")
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false })
      .limit(20);

    if (!recentError && recentData) {
      recent = recentData;
    } else if (recentError) {
      console.error("[AdminApprovals] recent fetch error", recentError);
    }
  } catch (err) {
    console.error("[AdminApprovals] unexpected error", err);
  }

  return <ApprovalsClient pending={pending as never} recent={recent as never} />;
}
