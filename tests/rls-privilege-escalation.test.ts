import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Static guard over the RLS migrations that protect `profiles.role`.
//
// Round 11 of the audit found the most severe defect in the project: 002's
// UPDATE policy on `profiles` was
//
//   USING (auth.uid() = id) WITH CHECK (auth.uid() = id)
//
// which constrains ROW OWNERSHIP only and never mentions `role`. Any signed-in
// user could therefore call PostgREST directly, with no application route
// involved:
//
//   PATCH /rest/v1/profiles?id=eq.<own-uuid>   {"role":"admin"}
//
// getProfileRole() then returned "admin" and requireRole("admin") opened every
// admin surface, including /api/admin/postings. Ten rounds of auditing src/
// missed it because the attack path executes entirely below the app.
//
// There is no live database in CI, and this project applies migrations BY HAND
// in the Supabase SQL editor, so the file existing does not mean it was
// applied. THIS FILE IS THE ONLY AUTOMATED PROTECTION. It asserts on the SQL
// text: structure rather than exact bytes, tolerant of whitespace, comments,
// quoting and policy ordering.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "db", "migrations");
const MIGRATION_002 = path.join(MIGRATIONS_DIR, "002_auth_policies.sql");
const MIGRATION_006 = path.join(MIGRATIONS_DIR, "006_lock_profile_role.sql");
const PROMOTE_ADMIN_SCRIPT = path.join(REPO_ROOT, "scripts", "promote-admin.ts");

interface Policy {
  /** The migration file the statement was read from. */
  file: string;
  name: string;
  /** Table name with any schema qualification removed. */
  table: string;
  /** SELECT | INSERT | UPDATE | DELETE | ALL */
  command: string;
  /** Roles listed after TO; empty means PUBLIC (i.e. every role). */
  roles: string[];
  /** Body of USING (...), or null when the clause is absent. */
  using: string | null;
  /** Body of WITH CHECK (...), or null when the clause is absent. */
  withCheck: string | null;
}

/** Migrations in apply order. Later files win, because they DROP then CREATE. */
function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Collapse whitespace so assertions survive reformatting. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

// Strip line comments and block comments so that prose can never satisfy (or
// trip) a structural assertion. 006's header discusses `role` in prose and
// even explains why USING was left alone; none of that may be mistaken for
// policy text.
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Read a balanced parenthesised expression starting at `open`, the index of the
 * opening paren. Returns the inner text and the index just past the match.
 * Tolerates newlines and nesting.
 */
function readParen(src: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return { body: src.slice(open + 1), end: src.length };
}

/** Locate a clause keyword and return the body of the paren that follows it. */
function readClause(src: string, keyword: string): string | null {
  const re = new RegExp(`\\b${keyword}\\s*\\(`, "i");
  const m = re.exec(src);
  if (!m) return null;
  return readParen(src, m.index + m[0].length - 1).body;
}

/**
 * Split the comment-stripped file into statements on semicolons and return
 * every CREATE POLICY. Policy bodies never contain a semicolon, and the
 * dollar-quoted body of 002's SECURITY DEFINER signup trigger is skipped by
 * the CREATE POLICY filter. That filter is precisely what keeps the trigger's
 * hardcoded 'employer' from ever being read as a policy.
 */
function extractPolicies(sql: string, file: string): Policy[] {
  const out: Policy[] = [];
  for (const raw of stripComments(sql).split(";")) {
    const stmt = normalize(raw);
    if (!/^CREATE\s+POLICY\b/i.test(stmt)) continue;

    const name = stmt.match(/^CREATE\s+POLICY\s+(?:"([^"]+)"|([A-Za-z0-9_]+))/i);
    const table = stmt.match(/\bON\s+([A-Za-z0-9_."]+)/i);
    const command = stmt.match(/\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i);
    if (!name || !table || !command) continue;

    const to = stmt.match(
      /\bTO\s+((?:[A-Za-z0-9_]+|"[^"]+")\s*(?:,\s*(?:[A-Za-z0-9_]+|"[^"]+")\s*)*?)(?=\bUSING\b|\bWITH\s+CHECK\b|$)/i,
    );
    const roles = to
      ? to[1]
          .split(",")
          .map((r) => normalize(r).replace(/"/g, "").toLowerCase())
          .filter(Boolean)
      : [];

    out.push({
      file,
      name: name[1] ?? name[2],
      table: table[1].replace(/"/g, "").split(".").pop()!,
      command: command[1].toUpperCase(),
      roles,
      using: readClause(stmt, "USING"),
      withCheck: readClause(stmt, "WITH\\s+CHECK"),
    });
  }
  return out;
}

/** Policies a non-service_role caller (anon, authenticated, PUBLIC) is subject to. */
function isUserFacing(policy: Policy): boolean {
  if (policy.roles.length === 0) return true; // no TO clause means PUBLIC
  return policy.roles.some((r) => r === "authenticated" || r === "anon" || r === "public");
}

/**
 * Row-ownership clause, i.e. `auth.uid() = id` in any spacing or quoting.
 * auth.uid() is masked first so the `id` inside `uid` cannot satisfy the
 * column check.
 */
function hasOwnership(clause: string | null): boolean {
  if (!clause) return false;
  const masked = clause.replace(/auth\s*\.\s*uid\s*\(\s*\)/gi, " AUTHUID ");
  return /authuid/i.test(masked) && /\bid\b/i.test(masked);
}

/**
 * True when the clause references the `role` column. Word-boundary matching
 * accepts both `role` and `p.role` and rejects `employer`, which has no word
 * boundary before "role".
 */
function referencesRole(clause: string | null): boolean {
  if (!clause) return false;
  return /\brole\b/i.test(clause);
}

/**
 * Protection layer (a) from 006: a REVOKE of UPDATE on the `role` column, or on
 * the whole table, from `authenticated` or `public`. Covers the column-level
 * and table-level forms.
 */
function revokesRoleUpdate(sql: string): boolean {
  const s = normalize(stripComments(sql));
  return /REVOKE\s+(?:UPDATE|ALL)(?:\s*\(\s*"?role"?\s*\))?\s+ON\s+(?:"?public"?\s*\.\s*)?"?profiles"?\s+FROM\s+(?:"?authenticated"?\s*(?:,\s*"?public"?)?|"?public"?\s*(?:,\s*"?authenticated"?)?)/i.test(
    s,
  );
}

/** Every user-facing INSERT or UPDATE policy on `profiles`, across migrations. */
function profilesWritePolicies(): Policy[] {
  const out: Policy[] = [];
  for (const file of listMigrations()) {
    for (const p of extractPolicies(read(path.join(MIGRATIONS_DIR, file)), file)) {
      if (p.table === "profiles" && (p.command === "UPDATE" || p.command === "INSERT")) {
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * The UPDATE policy actually in force, honouring DROP POLICY. 002 creates
 * "Users can update own profile"; 006 drops and recreates it, so T1 and T2 must
 * assert on 006's version. The buggy 002 text is still in the repo by design
 * (migrations are append-only and applied in order) and must not fail here.
 */
function effectiveProfilesUpdatePolicy(): Policy | null {
  let current: Policy | null = null;
  for (const file of listMigrations()) {
    const clean = stripComments(read(path.join(MIGRATIONS_DIR, file)));
    for (const raw of clean.split(";")) {
      const stmt = normalize(raw);
      if (/^DROP\s+POLICY\b/i.test(stmt) && /\bON\s+(?:"?public"?\s*\.\s*)?"?profiles"?\b/i.test(stmt)) {
        current = null;
        continue;
      }
      for (const p of extractPolicies(`${stmt};`, file)) {
        if (p.table === "profiles" && p.command === "UPDATE" && p.roles.includes("authenticated")) {
          current = p;
        }
      }
    }
  }
  return current;
}

/**
 * Throw with a plain-language message instead of a bare assertion diff. A
 * security regression failing as "expected false to be true" costs a reader an
 * hour; this costs them ten seconds.
 */
function guard(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  expect(condition).toBe(true);
}

const ESCALATION_MESSAGE = [
  "PRIVILEGE ESCALATION: `profiles.role` is writable by any signed-in user.",
  "A signed-in user could set themselves to admin by calling PostgREST directly:",
  'PATCH /rest/v1/profiles?id=eq.<own-uuid>   {"role":"admin"}',
  "No application route, validation or rate limit is involved.",
  'getProfileRole() would then return "admin" and requireRole("admin") would open every',
  "admin surface, including /api/admin/postings (approve/reject jobs, read employer",
  "submissions). Expected: the effective UPDATE policy's WITH CHECK to reference `role`,",
  "OR 006 to REVOKE UPDATE (role) ON public.profiles FROM authenticated. Neither layer is present.",
].join(" ");

const OWNERSHIP_MESSAGE = [
  "ROW-OWNERSHIP REGRESSION: the UPDATE policy on `profiles` no longer constrains row",
  "ownership (`auth.uid() = id`) in its USING and/or its WITH CHECK.",
  "This is the opposite failure to the role leak and is just as serious: with no ownership",
  "constraint, ANY signed-in user could edit ANY profile row rather than only their own.",
  "The role escalation must never be fixed by loosening the policy. 006 documents the",
  "intent deliberately: USING stays row-ownership only, WITH CHECK guards the new row.",
].join(" ");

describe("RLS: profiles.role privilege escalation (round 11)", () => {
  it("the UPDATE policy on profiles constrains role, or a REVOKE blocks it", () => {
    const sql006 = read(MIGRATION_006);
    const policy = effectiveProfilesUpdatePolicy();

    guard(
      policy !== null,
      "No UPDATE policy on `profiles` for the `authenticated` role exists in any migration, so nothing constrains it. Expected 002 (row ownership) plus 006 (role pinned). " +
        ESCALATION_MESSAGE,
    );

    const pinnedByPolicy = referencesRole(policy!.withCheck);
    const pinnedByRevoke = revokesRoleUpdate(sql006);

    guard(
      pinnedByPolicy || pinnedByRevoke,
      `${ESCALATION_MESSAGE} In force: ${policy!.file} "${policy!.name}" — USING(${normalize(
        policy!.using ?? "<absent>",
      )}) WITH CHECK(${normalize(policy!.withCheck ?? "<absent>")}).`,
    );

    // Tolerant of whitespace and comments, but confirm the parser saw a real
    // policy rather than silently matching nothing.
    expect(policy!.table).toBe("profiles");
    expect(policy!.command).toBe("UPDATE");
    expect(policy!.withCheck).not.toBeNull();
  });

  it("the UPDATE policy still constrains row ownership", () => {
    const policy = effectiveProfilesUpdatePolicy();

    guard(
      policy !== null,
      "No UPDATE policy on `profiles` for `authenticated` exists, so row ownership is unconstrained. " +
        OWNERSHIP_MESSAGE,
    );

    guard(
      hasOwnership(policy!.using),
      `${OWNERSHIP_MESSAGE} USING was: (${normalize(policy!.using ?? "<absent>")})`,
    );
    guard(
      hasOwnership(policy!.withCheck),
      `${OWNERSHIP_MESSAGE} WITH CHECK was: (${normalize(policy!.withCheck ?? "<absent>")})`,
    );
  });

  it("no policy lets a user choose a role value", () => {
    const writePolicies = profilesWritePolicies();
    expect(writePolicies.length).toBeGreaterThan(0);

    for (const policy of writePolicies.filter(isUserFacing)) {
      const label = `${policy.file} "${policy.name}" (${policy.command}, TO ${policy.roles.join(", ") || "PUBLIC"})`;

      if (policy.command === "UPDATE") {
        // A user-chosen role is either a role the policy compares against a
        // literal or list, a caller-supplied value, or a JWT claim. Note 006's
        // legitimate pin is `role = (SELECT p.role ...)`, which opens with a paren
        // and so is not matched by the literal form.
        const offersAChoice =
          /\brole\b\s*(?:=|\bIN\b)\s*'?[a-z_]+'?/i.test(policy.withCheck ?? "") ||
          /\bnew\s*\.\s*"?role"?\b/i.test(policy.withCheck ?? "") ||
          /current_setting|jwt\s*\(|request\s*\.\s*body/i.test(policy.withCheck ?? "");

        guard(
          !offersAChoice,
          `POLICY LETS A USER CHOOSE A ROLE: ${label} — WITH CHECK (${normalize(
            policy.withCheck ?? "<absent>",
          )}) accepts or compares a caller-supplied role value. ${ESCALATION_MESSAGE}`,
        );
      } else {
        // An INSERT policy on `profiles` reachable by a user would take `role`
        // straight from the request body unless WITH CHECK pins it. 002 has no
        // such policy, since the row is created by the SECURITY DEFINER
        // trigger, so this guards a future edit rather than an existing hole.
        guard(
          policy.withCheck !== null,
          `INSERT policy on \`profiles\` reachable by a user with no WITH CHECK: ${label}. A signed-in user could insert a profiles row with any role, including admin. ` +
            ESCALATION_MESSAGE,
        );
      }
    }

    // 002's signup trigger is SECURITY DEFINER and hardcodes 'employer'. It is
    // not a policy and the parser above never sees it as one, so assert that
    // safety directly rather than leaving it incidental: role must come from a
    // literal, never from the caller, JWT or user metadata.
    const triggerSql = normalize(stripComments(read(MIGRATION_002)));
    const triggerInsert = triggerSql.match(
      /INSERT\s+INTO\s+(?:"?public"?\s*\.\s*)?"?profiles"?([\s\S]*?)(?=\s*ON\s+CONFLICT)/i,
    );
    expect(triggerInsert).not.toBeNull();
    const triggerBody = triggerInsert![1];
    expect(triggerBody).toMatch(/"?role"?/i);
    expect(triggerBody).toMatch(/'employer'/i);
    expect(triggerBody).not.toMatch(/NEW\s*\.\s*"?role"?\b/i);
    expect(triggerBody).not.toMatch(/raw_user_meta_data\s*->>?\s*'?role/i);
    expect(triggerBody).not.toMatch(/jwt\s*\(/i);
  });

  it("at least one of the two protection layers is present", () => {
    // Layer (a), `REVOKE UPDATE (role) ... FROM authenticated`, is the
    // load-bearing one: column privileges in pg_attribute.attacl are
    // AUTHORITATIVE for that column, so the revoke is what actually removes
    // the write. Layer (b), the WITH CHECK pin, is defence in depth: it keeps
    // `role` immutable even if a later migration re-applies a blanket GRANT.
    // Requiring both would be wrong. Dropping the revoke is acceptable as long
    // as the WITH CHECK still pins role, and vice versa. Require one.
    const sql006 = read(MIGRATION_006);
    const policy = effectiveProfilesUpdatePolicy();
    const policyPins = policy !== null && referencesRole(policy.withCheck) && hasOwnership(policy.withCheck);
    const revoke = revokesRoleUpdate(sql006);

    guard(
      policyPins || revoke,
      "NO PROTECTION LAYER AT ALL: neither `REVOKE UPDATE (role) ... FROM authenticated` nor a WITH CHECK pinning `role` to its stored value is present in 006_lock_profile_role.sql. " +
        ESCALATION_MESSAGE,
    );
  });

  it("promote-admin can only ever assign admin", () => {
    const src = read(PROMOTE_ADMIN_SCRIPT);

    // 1. The promote-side literal is "admin", as a constant rather than a value
    // derived from an argument, env var or the target user.
    expect(src).toMatch(/const\s+PROMOTE_ROLE\s*=\s*"admin"/);
    expect(src).toMatch(/const\s+DEMOTE_ROLE\s*=\s*"employer"/);

    // 2. Every identifier that looks like a role constant is assigned one of
    // those two literals. This is the cheap mass-assignment guard: were the
    // script ever generalised into "set any role", a ROLE-named constant with a
    // third literal would surface here.
    const roleConstants = [...src.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_]*ROLE[A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g)];
    expect(roleConstants.length).toBeGreaterThan(0);
    const assignable = new Map(roleConstants.map((m) => [m[1], m[2]]));
    for (const [name, value] of assignable) {
      expect(["admin", "employer"], `${name} is assigned "${value}"`).toContain(value);
    }
    expect(assignable.get("PROMOTE_ROLE")).toBe("admin");

    // 3. The value written to the row is the promote/demote ternary, never a
    // caller-supplied expression.
    expect(src).toMatch(/targetRole\s*=\s*revoke\s*\?\s*DEMOTE_ROLE\s*:\s*PROMOTE_ROLE/);
    expect(src).toMatch(/\.update\(\s*\{\s*role:\s*targetRole\s*\}\s*\)/);

    // 4. No flag may carry a role through. `--role=x` is the obvious way this
    // would be generalised, so assert the accepted flag set stays closed.
    const flags = new Set([...src.matchAll(/(?<![A-Za-z0-9_])--([a-z][a-z-]*)/g)].map((m) => `--${m[1]}`));
    for (const flag of flags) {
      expect(["--dry-run", "--revoke", "--help"], `unexpected flag ${flag}`).toContain(flag);
    }

    // 5. The role never comes from the process, the email argument, or the
    // target row.
    const roleWrite = src.match(/\.update\(\s*\{\s*role:\s*([^}]+?)\s*\}\s*\)/);
    expect(roleWrite).not.toBeNull();
    expect(roleWrite![1]).not.toMatch(/argv|process\.|email|env|user\.|json|payload/i);
  });
});
