import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import { redirect } from "next/navigation";
import EmployerDashboardClient from "./EmployerDashboardClient";

export const dynamic = "force-dynamic";

export default async function EmployerDashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login?next=/employer/dashboard");
  }

  let items: unknown[] = [];
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("employer_postings")
      .select("*")
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false });

    if (!error && data) {
      items = data;
    } else if (error) {
      console.error("[EmployerDashboard] fetch error", error);
      items = [];
    }
  } catch (err) {
    console.error("[EmployerDashboard] unexpected error", err);
    items = [];
  }

  // Cast to expected shape for client; client handles any shape gracefully
  return <EmployerDashboardClient items={items as never} />;
}
