/**
 * Promote a single user to the `admin` role by email lookup, or demote with
 * --revoke. This is the only supported way to grant `admin`: nothing in the
 * application assigns it (002_auth_policies.sql's signup trigger hardcodes
 * 'employer'), and since 006_lock_profile_role.sql a user can no longer write
 * their own `role` column, so the Supabase SQL editor is no longer a routine
 * provisioning step.
 *
 * Deliberately NOT a generic "set any role" tool. The target role is chosen by
 * flag, never by argument: only 'admin' is ever granted, and demotion always
 * restores 'employer' (the signup trigger's default).
 *
 * Usage:
 *   npx tsx scripts/promote-admin.ts you@example.com
 *   npx tsx scripts/promote-admin.ts you@example.com --dry-run
 *   npx tsx scripts/promote-admin.ts you@example.com --revoke
 *   npm run promote-admin -- you@example.com
 *   npm run promote-admin -- you@example.com --revoke
 *
 * Safety: refuses to run against a non-local Supabase host unless
 * PROMOTE_ADMIN_FORCE=1 is set explicitly, so a shell carrying production env
 * vars cannot silently hand out admin. The service-role key bypasses RLS, so
 * that guard is the only thing between a typo and a production admin grant.
 *
 * Uses PROMOTE_ADMIN_FORCE, NOT scripts/seed.ts's SEED_FORCE: sharing one force
 * flag would mean setting SEED_FORCE once for seeding silently also authorises
 * admin grants.
 */
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

const LOCAL_SUPABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "host.docker.internal",
]);

/** The only role this script may ever grant. */
const PROMOTE_ROLE = "admin";
/** Where --revoke lands: the role 002_auth_policies.sql's trigger assigns. */
const DEMOTE_ROLE = "employer";

const USAGE_HINT =
  "[promote-admin] Usage: npm run promote-admin -- <email> [--dry-run] [--revoke]";

/** listUsers() page size and hard cap, so a huge project cannot spin forever. */
const PER_PAGE = 100;
const MAX_PAGES = 100;

interface ProfileRow {
  id: string;
  role: string | null;
  display_name: string | null;
  created_at: string | null;
}

/**
 * The only slice of the admin client this script needs. Declared structurally
 * so it does not depend on supabase-js's generic schema defaults.
 */
interface UserLister {
  auth: {
    admin: {
      listUsers(params: { page: number; perPage: number }): Promise<{
        data?: { users?: User[] };
        error: { message?: string } | null;
      }>;
    };
  };
}

function parseArgs(argv: string[]): {
  email: string | null;
  dryRun: boolean;
  revoke: boolean;
  help: boolean;
  unknown: string[];
} {
  const unknown: string[] = [];
  const positional: string[] = [];
  let dryRun = false;
  let revoke = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--revoke") revoke = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("-")) unknown.push(arg);
    else positional.push(arg);
  }
  if (positional.length > 1) unknown.push(...positional.slice(1));
  return { email: positional[0] ?? null, dryRun, revoke, help, unknown };
}

/**
 * Extract the host from a Supabase URL and decide whether it is a local/dev target.
 */
function isLocalSupabaseUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOCAL_SUPABASE_HOSTS.has(host)) return true;
  // e.g. <ref>.supabase.co is a real (remote) project — anything ending in
  // .localhost / .local / .test is treated as a local dev instance.
  return /\.(localhost|local|test|internal)$/.test(host);
}

function describe(p: ProfileRow): string {
  const name = p.display_name ?? "(null)";
  return `id=${p.id} role=${p.role ?? "(null)"} display_name=${name}`;
}

/**
 * Find every auth user whose email matches, paging through listUsers().
 * profiles has no email column, so auth.users is the only place to look.
 * Returns every match so the caller can refuse an ambiguous email.
 */
async function findUsersByEmail(
  supabase: UserLister,
  email: string
): Promise<User[]> {
  const wanted = email.trim().toLowerCase();
  const matches: User[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (res.error) throw res.error;
    const users: User[] = res.data?.users ?? [];
    for (const u of users) {
      if (u.email && u.email.toLowerCase() === wanted) matches.push(u);
    }
    if (users.length < PER_PAGE) break;
    if (page === MAX_PAGES) {
      console.warn(
        `[promote-admin] WARNING: stopped after ${MAX_PAGES} pages; a match past page ${MAX_PAGES} would be missed.`
      );
    }
  }

  return matches;
}

async function main(): Promise<void> {
  const { email, dryRun, revoke, help, unknown } = parseArgs(process.argv.slice(2));

  if (unknown.length > 0) {
    console.error(`[promote-admin] Unknown argument(s): ${unknown.join(", ")}`);
    console.error(USAGE_HINT);
    process.exit(1);
  }
  if (help) {
    console.log(USAGE_HINT);
    console.log("[promote-admin] Flags: --dry-run (report, write nothing), --revoke (admin -> employer)");
    console.log("[promote-admin] Env: PROMOTE_ADMIN_FORCE=1 to allow a remote (non-local) Supabase project.");
    return;
  }
  if (!email) {
    console.error("[promote-admin] REFUSING to run: no email given.");
    console.error(USAGE_HINT);
    process.exit(1);
  }

  const targetRole = revoke ? DEMOTE_ROLE : PROMOTE_ROLE;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("[promote-admin] Failed to create Supabase admin client: Missing Supabase URL or secret key");
    console.error("[promote-admin] Ensure Supabase env vars are set: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL and SUPABASE_SECRET_KEY");
    process.exit(1);
  }

  // Production guard: the service-role key bypasses RLS, so refuse to point this
  // at a live project unless the operator explicitly opts in.
  const force = process.env.PROMOTE_ADMIN_FORCE === "1";
  if (!isLocalSupabaseUrl(supabaseUrl)) {
    if (!force) {
      console.error(`[promote-admin] REFUSING to run: Supabase URL host is not a local/dev host: ${supabaseUrl}`);
      console.error("[promote-admin] This script uses the RLS-bypassing service-role key.");
      console.error("[promote-admin] To proceed against a remote project anyway, set PROMOTE_ADMIN_FORCE=1 explicitly.");
      process.exit(1);
    }
    console.warn(`[promote-admin] PROMOTE_ADMIN_FORCE=1 set — proceeding against remote Supabase: ${supabaseUrl}`);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const matches = await findUsersByEmail(supabase, email);

    if (matches.length === 0) {
      console.error(`[promote-admin] REFUSING to run: no auth user has email "${email.trim()}".`);
      console.error("[promote-admin] Sign the user up via magic link first so the 002_auth_policies.sql trigger creates their profiles row.");
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`[promote-admin] REFUSING to run: ${matches.length} auth users share email "${email.trim()}":`);
      for (const m of matches) console.error(`[promote-admin]   id=${m.id} created_at=${m.created_at}`);
      console.error("[promote-admin] Resolve the duplicate by id in the Supabase dashboard, then re-run.");
      process.exit(1);
    }

    const user = matches[0];
    const userId = user.id;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, display_name, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      console.error(`[promote-admin] REFUSING to run: auth user ${userId} (${user.email}) has no profiles row.`);
      console.error("[promote-admin] The on_auth_user_created trigger in 002_auth_policies.sql should have created one.");
      process.exit(1);
    }

    const row = profile as ProfileRow;
    console.log(`[promote-admin] Target auth user: id=${userId} email=${user.email ?? "(null)"}`);
    console.log(`[promote-admin] Current profiles row: ${describe(row)}`);

    if (row.role === targetRole) {
      console.log(`[promote-admin] No change needed — role is already '${targetRole}'.`);
      return;
    }

    if (dryRun) {
      console.log(`[promote-admin] DRY RUN: would set role=${targetRole} on ${describe(row)}; nothing written.`);
      return;
    }

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ role: targetRole })
      .eq("id", userId)
      .select("id, role, display_name, created_at")
      .single();

    if (updateError) throw updateError;
    if (!updated) {
      console.error("[promote-admin] Update matched no row — the profiles row may have been deleted mid-run.");
      process.exit(1);
    }

    const after = updated as ProfileRow;
    console.log(`[promote-admin] Changed exactly 1 row: ${describe(row)} -> ${describe(after)}`);
    console.log(
      revoke
        ? '[promote-admin] Demoted. This user no longer passes requireRole("admin").'
        : '[promote-admin] Promoted. This user now passes requireRole("admin").'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const details = err && typeof err === "object" && "code" in err ? ` (code: ${(err as { code: unknown }).code})` : "";
    console.error(`[promote-admin] Failed: ${message}${details}`);
    if (/relation.*does not exist|table.*not found|42P01/i.test(message)) {
      console.error("[promote-admin] Hint: profiles table does not exist — apply db/migrations/001_init.sql in Supabase first.");
    }
    if (/row-level security|permission denied|42501/i.test(message)) {
      console.error("[promote-admin] Hint: the service-role key is not bypassing RLS — check SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY.");
    }
    process.exit(1);
  }
}

main()
  .then(() => {
    // success — exit 0
    process.exit(0);
  })
  .catch((err) => {
    console.error("[promote-admin] Unhandled error:", err);
    process.exit(1);
  });
