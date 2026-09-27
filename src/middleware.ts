import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `api/cron` is intentionally NOT excluded. The middleware only refreshes
  // Supabase cookies and never authorises, so excluding cron routes advertised
  // them as unprotected; the real gate is the CRON_SECRET check in the routes.
  // `updateSession` awaits `supabase.auth.getUser()`, i.e. a network round trip
  // to the Supabase auth endpoint. Running it for every static asset under
  // /public (and the generated /robots.txt, /sitemap.xml) is pure overhead, so
  // common static extensions are excluded too. Page routes carry no file
  // extension and /api routes are extensionless, so neither is excluded.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|css|js|mjs|map|mp4|webm|mp3|wav|ogg|txt|xml|webmanifest)$).*)",
  ],
};
