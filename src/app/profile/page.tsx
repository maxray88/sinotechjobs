import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/db/client";
import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login?next=/profile");
  }

  let profile: unknown = null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!error && data) {
      profile = data;
    } else if (error) {
      const code = (error as { code?: string }).code;
      if (code !== "PGRST116") {
        console.error("[ProfilePage] fetch error", error);
      }
      profile = null;
    }
  } catch (err) {
    console.error("[ProfilePage] unexpected error", err);
    profile = null;
  }

  return <ProfileClient initialProfile={profile as never} userEmail={user.email ?? ""} />;
}
