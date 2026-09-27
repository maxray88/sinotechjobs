import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `api/cron` is intentionally NOT excluded. The middleware only refreshes
  // Supabase cookies and never authorises, so excluding cron routes advertised
  // them as unprotected; the real gate is the CRON_SECRET check in the routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
