# SinotechJobs — Project Handover Document

> **Last updated:** 2026-09-27
> **Project location:** `~/01_Coding_Projects/05_Sinotech_Jobboard` (macOS) — **GitHub:** `maxray88/sinotechjobs` (public) — **Vercel:** `sinotechjobs.vercel.app` (`cvetqt9ui` READY) — **Supabase:** `nzlhmjcugibacpbiqtyr`
> **Status:** Phases 0–5 complete. 12-round security/correctness audit finished 2026-09-27 (TSC 0 / LINT 0 / build 0 / 1777 tests). Remaining work is non-code: German legal texts (lawyer) and the SearchAPI quota reset (2026-10-01). WeChat Mini Program still decision-gated.
>
> This file is the authoritative handover doc. Where it conflicts with code, the code wins — verify before acting.

---

## 1. Project Overview

### Concept
A trilingual (EN/ZH/DE) job board connecting Chinese-speaking tech talent with employers in the DACH region (Germany, Austria, Switzerland). Focus areas: Computer Science, AI/ML, Robotics, Drones/UAV, and Remote positions where Chinese language skills are required or valued.

### Value Proposition
- **Candidates:** a portal for DACH tech jobs where Chinese is a filterable criterion — not available on StepStone, Indeed, or LinkedIn
- **Employers:** targeted access to a niche bilingual talent pool
- **Differentiator:** Chinese-language filter + DACH tech focus + bilingual job descriptions

### Data model note
The board serves **real scraped jobs only**. The 32 curated demo jobs are no longer served at runtime (see §11, "Deprecated sample jobs"). Do not document or run sample-data seeding as a routine step.

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.3 (App Router) + React 19.2 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + inline styles for dynamic theming |
| HTML Parsing | cheerio 1.2 |
| JS-Rendered Scraping | Puppeteer 25 + `@sparticuz/chromium` (serverless) |
| Storage | Supabase (Postgres) via `DATA_STORE=supabase`; JSON file fallback via `DATA_STORE=json` (local only) |
| Supabase Client | `@supabase/supabase-js` 2.54, `@supabase/ssr` 0.5, magic-link auth |
| Payments | Stripe 14 (`checkout` + `webhook`) |
| Email | Resend 4 |
| Validation | Zod 3.23 (`src/lib/validations/`) |
| Tests | Vitest 4 — 23 files, 1777 tests |
| Deployment | Vercel (cron configured in `vercel.json`) |
| Package Manager | npm |

---

## 2. Completed Work Summary

### Phase 0–1: MVP
- [x] Next.js 16 scaffold, Tailwind CSS 4
- [x] Trilingual UI (EN/ZH/DE) with instant switching (`LanguageProvider`, localStorage)
- [x] Landing page: hero, live stats, value props, featured jobs, email capture
- [x] Job board `/jobs` with filters (field, location, language level, employment type, visa sponsorship, remote, search)
- [x] Job detail `/jobs/[id]` with bilingual descriptions, requirements, tags, apply
- [x] Employer posting form `/post`
- [x] Dark mode, responsive grid layouts

### Phase 2: Scraping Infrastructure
- [x] `src/lib/scraper/` module: types, engine, storage, keywords, sources, health
- [x] Chinese keyword matcher, strong/weak classification
- [x] Auto-detection of field, language level, location, employment type, tech tags
- [x] Deduplication by URL, storage caps
- [x] `POST /api/scrape` (scrape-all / scrape-one / clear), `GET /api/scrape` (sources + stats + reports)
- [x] Admin dashboard `/admin` (secret-gated, see §4)
- [x] CLI `npm run scrape` / `npm run scrape:verbose`

### Phase 2.5: Puppeteer
- [x] `src/lib/scraper/puppeteer.ts`: auto-detect `@sparticuz/chromium` on Vercel vs local Chrome, auto-scroll, `waitForSelector`, resource blocking, AbortSignal support, one browser reused and closed after the run
- [x] 4 sources marked `jsRendered: true` (Bosch, LinkedIn, XING, Huawei)
- [x] Engine routes `jsRendered` → Puppeteer, else `fetch`

### Phase 3: Employer + Candidate Features
- [x] Supabase magic-link auth (`/auth/login`, `/auth/callback`, `/auth/logout`) + `src/middleware.ts` session refresh
- [x] Candidate profile CRUD + visibility toggle (`/profile`)
- [x] Saved jobs, saved filters, applications, CV upload
- [x] Employer dashboard `/employer/dashboard`, posting submission to `employer_postings` (status `pending`)
- [x] Admin approval queue `/admin/approvals` + `/api/admin/postings` (approve publishes the job; reject rolls back)
- [x] Email notifications on approve/reject

### Phase 4: Matching + Payments
- [x] Weighted match scoring (8 soft scores) in `src/lib/matching.ts`; alert thresholds 85 (immediate) / 70 (digest)
- [x] `POST /api/match` computes and persists scores `>= 70`; degrades gracefully if migration 004 is not applied
- [x] Stripe checkout + webhook for tiers: featured €99, pinned €199, enterprise €499 (30 days each)
- [x] Weekly email digest (`/api/cron/digest`), chunked fan-out
- [x] Rate limiting (`src/lib/ratelimit.ts`) on public write paths

### Phase 5: Growth Hardening
- [x] SEO: metadata, JobPosting structured data, `sitemap.ts` (paged past the 1000-row cap), `robots.ts`
- [x] Blog (`/blog`, `/blog/[slug]`) from `content/blog/*.md`; company profiles (`/companies/[slug]`)
- [x] OG image pipeline (`docs/og-pipeline.md`, `scripts/generate-og.sh`)
- [x] Scraper health matrix (`src/lib/scraper/health.ts`), watchdog (`src/lib/watchdog.ts`) with admin alert email
- [x] Security headers in `next.config.ts`; `safeExternalUrl` rejects `javascript:` / `data:` / `vbscript:` / `file:` URLs

### Audit (2026-09-27) — see §3
- [x] 12 rounds, 3 roles; 92 defects fixed in rounds 1–10, then 2 CRITICAL paths (RLS privilege escalation, live-path stored XSS) in 11–12; suite 1608 → 1777 tests

---

## 3. Audit History

A 12-round audit ran on 2026-09-27 with three rotating roles: **Claude Code** reviewed, **Codex** built the fixes, **Hermes** orchestrated. Each round re-reviewed the diffs of the earlier rounds.

| Round | Commit | Scope | Tests after |
|-------|--------|-------|-------------|
| 1 | `b8fefbe` | security + robustness (scrape route was fully public) | 1615 |
| 2 | `127beb4` | data layer + 28 regression tests | 1673 |
| 3 | `5c32960` | UI hardening incl. `javascript:` XSS sink | 1690 |
| 4 | `51a26c4` | headers, email header injection, fail-closed auth | 1698 |
| 5 | `906b3f4` | regressions introduced by rounds 1–4 | 1748 |
| 6 | `177affe` | sitemap + repo data/SEO path | 1751 |
| 7 | `8285ce7` | public subscribe path | 1751 |
| 8 | `b6b8dd8` | payments + candidate write paths | 1751 |
| 9 | `45f8604` | employer postings + digest | 1762 |
| 10 | `d9adf4f`, `78cafd9` | structured data/SEO + scraper health/CLI | 1770 |
| 11 | `37a321f`, `1c8d5d3`, `df77c72` | **CRITICAL** RLS privilege escalation + auth/types follow-ups | 1776 |
| 12 | `6cf39b8`, `182d05f` | **CRITICAL** live-path stored XSS + matching/ratelimit/middleware/i18n | 1777 |

**Result:** 92 defects fixed in rounds 1–10, then the round 11–12 findings below; suite 1608 → 1777 tests; final state TSC 0 / LINT 0 / `next build` 0.

### Round 11 — CRITICAL: privilege escalation through PostgREST

The most severe finding of the whole campaign, and the first one that no amount of application-code review could reach.

The "users can update own profile" policy in `db/migrations/002_auth_policies.sql` constrained row ownership only — `USING (auth.uid() = id) WITH CHECK (auth.uid() = id)` — and never mentioned the `role` column. There was no column-level GRANT/REVOKE anywhere. Any signed-in user could therefore call PostgREST directly:

```
PATCH /rest/v1/profiles?id=eq.<own-uuid>   {"role":"admin"}
```

No application route is involved, and `getProfileRole()` / `requireRole()` then opened every admin surface, including `/api/admin/postings`. Ten rounds of auditing `src/` missed it because identity was always read through `getCurrentUser()`; the attack path executes entirely below the app.

Fixed by `db/migrations/006_lock_profile_role.sql` (see §5) and by `scripts/promote-admin.ts` (§6), which exists because nothing in the repo ever set `role = 'admin'` — the signup trigger hardcodes `'employer'`, so there was previously no way to grant the role at all.

Two smaller defects in the same commit: `setAdminSecret` validated less than `getAdminSecret`, so a "successful" save silently produced no auth header; the guard missed non-ASCII, which throws at `new Headers({Authorization})` because that constructor requires a ByteString; and `getCurrentUser` discarded the auth error, so an auth-server outage looked like a logout. (`1c8d5d3`)

Also in this round: `types.ts` declared nine fields non-null that the schema leaves nullable, hidden by an `as Job` in `rowToJob` that disabled the only check that would have noticed a coercion being dropped. (`df77c72`)

### Round 12 — CRITICAL: stored XSS on the live validation path

`postingSchema.application_url` was `z.string().url()`, and Zod's `.url()` accepts `javascript:alert(1)` because it only checks that `new URL()` parses. Verified by execution, not inference: `z.string().url().safeParse("javascript:alert(1)")` returns success. The stored value was rendered as a raw `href` in `EmployerDashboardClient.tsx` and `ApprovalsClient.tsx`, neither of which sanitised it, while `JobDetailClient.tsx` already guarded correctly with `safeExternalUrl`. Fixed in `src/lib/validations/posting.ts` by adding a `safeExternalUrl` refine so the schema and the render-side guard cannot drift.

**The trap this exposed is worth more than the bug.** An earlier round had already hardened this same XSS in `src/lib/job-validation.ts` — and that module is **dead code**. Nothing under `src/` imports it; only `tests/` does. The live path is the Zod schema. A green test file was pinning a fix nothing shipped. Before you trust any validation fix here, confirm which module is actually imported.

Also in this round:

- **Matching** (`182d05f`): the language hard filter failed **open** on any requirement it could not parse — `{zh: 'B1'}` and `{en: 'C1+'}` each gated nobody. An open-ended "from €80k" salary was treated as a hard ceiling at the floor. A tagless job was hard-capped at exactly 70, which made the ≥ 85 immediate-alert tier unreachable on **any** untagged job for **any** candidate. `profile_completeness` was unclamped and a NaN source, and NaN fails all three score gates open, so a match could fall through every threshold silently. All of these now fail closed and clamp.
- **Ratelimit**: `limit: 0` blocked an IP permanently and returned a NaN `Retry-After`; the tracking Map was never pruned, an unbounded leak on a long-lived instance. Both fixed, with an LRU cap and a sweep.
- **Middleware**: an unguarded `getUser()` turned any Supabase hiccup into a site-wide 500.
- **i18n**: `zh` and `de` are now typed as `typeof en`, so adding a key to one language is a compile error instead of a silent runtime `undefined`. Verified — an en-only key produces TS2741 in both.

**Three patterns worth preserving:**

1. **Later rounds caught regressions introduced by earlier rounds.** Round 5 exists specifically because rounds 1–4 broke things. Round 6 had to rewrite the expiry test because an earlier test encoded the buggy shape rather than the intended semantics. Treat a fix as unverified until a later round has re-reviewed it.
2. **Suspected vulnerabilities routinely did not hold.** Reviewers regularly investigated a suspected flaw and reported that it was not exploitable as suspected. Those negative results stopped the team from writing wrong-direction fixes and from adding tests that would have locked in a wrong model. When a reviewer reports "not a vulnerability", do not re-open it without new evidence.
3. **Auditing `src/` alone is structurally blind to whole classes of bug.** Round 11's escalation lives in an RLS policy and needs zero application code; round 12's XSS hid in the gap between two copies of the same validation logic, one of which nothing imports. Read the migrations, and trace the import graph of anything you "fix". A passing test suite proves the tested module works, not that it is reachable.

Re-running an audit is cheap relative to the regressions it prevents. If you touch auth, payments, the scraper, or the sitemap, expect to re-review the diff rather than only the new code.

---

## 4. Security Model

This is the part of the codebase most likely to be broken by a well-meaning change. Read before touching any route.

### CRON_SECRET gate
`/api/scrape` (GET and POST) and **all** of `/api/cron/*` (`daily`, `weekly`, `digest`) require `Authorization: Bearer $CRON_SECRET`.

- With `CRON_SECRET` set: the header must match exactly, or the route returns 401 with `Cache-Control: no-store`.
- With `CRON_SECRET` unset: the routes **fail closed in production** (`NODE_ENV === "production"` → 401) and only allow unauthenticated requests in dev, with a console warning. Never invert this — an unauthenticated scrape drains paid quota, and `clear` wipes the jobs table.
- `src/middleware.ts` deliberately does **not** exclude `api/cron` from its matcher. The middleware only refreshes Supabase cookies and never authorises, so excluding cron routes would have advertised them as unprotected. The real gate lives in the routes.

### The `x-vercel-cron` header is not authentication
`/api/cron/digest` explicitly rejects the `x-vercel-cron` header as a credential. That header is client-supplied and trivially forged, so treating it as authorisation would let any anonymous caller trigger the digest fan-out and email every account holding a saved filter. The Bearer token is the only accepted credential. Do not add `x-vercel-cron` as a fallback auth path in any route.

### Stripe webhook fails closed
`/api/stripe/webhook` requires `STRIPE_WEBHOOK_SECRET` and verifies the signature via `stripe.webhooks.constructEvent`. The **only** way to bypass verification is the explicit opt-in `ALLOW_UNVERIFIED_WEBHOOKS=true`, which is for local testing only. Without the secret and without that flag the route returns 400. It does not fall back on a missing env var and does not fall back on `NODE_ENV` — preview deployments and staging boxes are internet-reachable and would otherwise accept forged events that grant paid entitlements. Apply the same fail-closed rule to any new Stripe entry point.

### Admin identity comes from the session
Admin authorisation is read from the Supabase session: `getCurrentUser()` then `getProfileRole(user.id)` (`src/lib/auth.ts`). It is **never** taken from a request field, header, or body parameter. `/api/admin/postings` (approve/reject) additionally rate-limits on the admin's session user id rather than the client IP.

The `/admin` **scraper dashboard** is a different mechanism: the operator pastes `CRON_SECRET` into the browser at runtime, it is held in `localStorage` (`src/lib/admin-auth.ts`), and replayed as a Bearer header. The secret is never baked into the client bundle.

### Other standing rules
- `next.config.ts` deliberately sets **no** `Content-Security-Policy`. Next.js emits inline bootstrap and streamed scripts, so a static CSP breaks every page. A correct CSP needs per-request nonces minted in middleware and threaded through — separate work. Do not "fix" this by adding a static CSP.
- Rate-limit public write paths. Authenticated routes key on the session user id; public routes key on client IP.
- `content/blog` slugs are validated with `path.basename` to reject traversal.
- The `admin` role has no self-service provisioning path in application code — no route, signup trigger, or client can set it; grant it with `npm run promote-admin` (§6). As of `006_lock_profile_role.sql` the `profiles.role` column is immutable to signed-in users, subject to §8.4.

---

## 5. Project Structure

```
sinotechjobs/
├── src/
│   ├── middleware.ts               # Supabase session refresh (not an authz layer)
│   ├── app/
│   │   ├── layout.tsx, page.tsx, HomeClient.tsx, globals.css
│   │   ├── robots.ts, sitemap.ts
│   │   ├── jobs/                   # board (page + JobsClient) and [id] detail
│   │   ├── post/                   # employer posting form
│   │   ├── pricing/                # tier comparison
│   │   ├── profile/                # candidate profile
│   │   ├── saved/                  # saved jobs + filters
│   │   ├── blog/[slug]/            # blog from content/blog/*.md
│   │   ├── companies/[slug]/       # employer pages from scraped data
│   │   ├── employer/dashboard/     # employer posting management
│   │   ├── admin/                  # scraper dashboard
│   │   │   └── approvals/          # posting approval queue
│   │   ├── auth/                   # login, callback, logout
│   │   └── api/                    # see route table below
│   ├── components/                 # LanguageProvider, Navbar, Footer, EmailCapture, …
│   └── lib/
│       ├── types.ts                # core types (Job, JobField, …)
│       ├── jobs.ts                 # DEPRECATED sample array (SAMPLE_MODE=false) — seed input only
│       ├── all-jobs.ts             # DB-aware read path, paged, degrades rather than throws
│       ├── auth.ts                 # getCurrentUser / getProfileRole / requireAuth / requireRole
│       ├── admin-auth.ts           # client-side CRON_SECRET storage + Bearer header builder
│       ├── matching.ts             # weighted scoring
│       ├── match-scores.ts         # match_scores persistence (fault-tolerant)
│       ├── ratelimit.ts, safe-url.ts, job-validation.ts, application-state-machine.ts
│       ├── profile-completeness.ts, taxonomy.ts, analytics.ts, watchdog.ts
│       ├── blog.ts, companies.ts, seo.ts, digest.ts, email.ts, i18n.ts
│       ├── supabase/               # client, server, middleware
│       ├── validations/            # Zod schemas
│       ├── db/                     # client, jobs-repo, reports-repo, email-repo, mappers, types
│       └── scraper/                # types, engine, storage, sources, keywords, health, puppeteer
├── tests/                          # 23 vitest files, 1777 tests
├── scripts/                        # scrape.ts, seed.ts, promote-admin.ts, generate-og.sh, measure-build.sh
├── content/blog/                   # 2 markdown posts (blue-card-visa-guide, dach-salary-benchmarks-2026)
├── db/migrations/                  # 001..006, apply in order
├── docs/                           # PRD.md, build-report.md, sources-compliance.md, og-pipeline.*, legal/, plans/
├── data/                           # JSON fallback ONLY (local). Committed file is empty: {"jobs": []}
├── vercel.json                     # one cron: daily 06:00 UTC → /api/cron/daily
└── package.json
```

### API routes (15 files)
| Route | Methods | Auth |
|-------|---------|------|
| `/api/scrape` | GET, POST | `CRON_SECRET` |
| `/api/cron/daily` | GET | `CRON_SECRET` |
| `/api/cron/weekly` | GET | `CRON_SECRET` |
| `/api/cron/digest` | GET | `CRON_SECRET` (rejects `x-vercel-cron`) |
| `/api/jobs` | GET | public |
| `/api/subscribe` | POST | public + IP rate limit |
| `/api/postings` | GET, POST | session |
| `/api/admin/postings` | POST | session + `admin` role, rate limited |
| `/api/candidate/profile` | GET, PUT | session |
| `/api/saved-jobs` | GET, POST, DELETE | session + IP rate limit |
| `/api/saved-filters` | GET, POST, DELETE | session |
| `/api/applications` | GET, PUT | session + IP rate limit |
| `/api/cvs` | GET, POST, DELETE | session + IP/user rate limit |
| `/api/match` | GET, POST | session (POST) |
| `/api/stripe/checkout` | POST | session |
| `/api/stripe/webhook` | POST | Stripe signature (fails closed) |

### Migrations (`db/migrations/`, apply in order)
| File | Adds |
|------|------|
| `001_init.sql` | Base schema: `jobs`, `scrape_reports`, `email_subscriptions`, `employer_postings`, `profiles` |
| `002_auth_policies.sql` | RLS policies for magic-link auth (public read on `jobs`, service_role full access) + profile trigger |
| `003_candidate_features.sql` | `candidate_profiles`, `saved_jobs`, `saved_filters`, `applications`, `cvs` + policies |
| `004_matching_legal.sql` | `match_scores`, `notifications`, versioned trilingual `legal_documents` (ToS/Privacy seeds are abbreviated placeholders) |
| `005_job_expiry.sql` | `jobs.expires_at` (default +60d) and `jobs.is_expired`; `listJobs` filters expired by default, daily cron flags overdue rows |
| `006_lock_profile_role.sql` | Closes a privilege-escalation path: any signed-in user could set their own `profiles.role` to `admin` via PostgREST directly, because the 002 UPDATE policy constrained row ownership only and never mentioned `role`. Revokes `UPDATE (role)` from `authenticated` and pins the policy's `WITH CHECK` to the stored role |

---

## 6. How to Run

### Development
```bash
cd ~/01_Coding_Projects/05_Sinotech_Jobboard
npm install
cp .env.example .env.local     # then fill in Supabase keys + CRON_SECRET
DATA_STORE=json npm run dev    # http://localhost:3000 — file fallback, no Supabase needed
DATA_STORE=supabase npm run dev
```

### Verification (must be clean before you call anything done)
```bash
npx tsc --noEmit     # 0 errors
npm run lint         # 0 problems
npm test             # 23 files, 1777 tests
npm run build
```

### Scraper (CLI)
```bash
npm run scrape
npm run scrape:verbose
npx tsx scripts/scrape.ts --source=adzuna-chinese-de
```

### Scraper (API) — all require the Bearer header
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/scrape
curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  http://localhost:3000/api/cron/daily
```

### Sample-data seeding — NOT a routine step
`npm run seed` upserts the deprecated `sampleJobs` array from `src/lib/jobs.ts`. Nothing serves them in production. The script refuses to write to a non-local Supabase host unless `SEED_FORCE=1` is set explicitly. There is no reason to run it for an ordinary task; do not put it on a deployment checklist.

### Admin promotion
`npm run promote-admin -- <email>` is the only supported way to grant the `admin` role. It resolves the user by **email lookup** (paging `auth.users`, since `profiles` has no email column) using the service-role key, and can only ever assign `admin`; `--revoke` demotes back to `employer`. It refuses non-local Supabase hosts unless `PROMOTE_ADMIN_FORCE=1` is set explicitly, and supports `--dry-run`.
```bash
npm run promote-admin -- you@example.com --dry-run
npm run promote-admin -- you@example.com
npm run promote-admin -- you@example.com --revoke
```

### Deploy
```bash
npx vercel          # preview
npx vercel --prod   # production (main also auto-deploys on push)
```

---

## 7. Key Configuration

### Environment variables
| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (`https://nzlhmjcugibacpbiqtyr.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Client-safe publishable key |
| `SUPABASE_SECRET_KEY` | Yes (server) | Server-only secret key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Legacy | Still present in `.env.example`; some libs expect the old names |
| `DATA_STORE` | Yes | `supabase` in every deployed environment; `json` for local dev only |
| `CRON_SECRET` | Yes (prod) | Gates `/api/scrape` and `/api/cron/*`; also the `/admin` dashboard login |
| `SCRAPING_API_KEY` | Optional | Managed scraping API, tried first for `scrapingApi: true` sources |
| `SEARCHAPI_KEY` (or `SEARCH_API_KEY`) | Optional | Google Jobs source; currently disabled, see §8 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Yes (if payments live) | Webhook fails closed without the secret |
| `ALLOW_UNVERIFIED_WEBHOOKS` | **Never in prod** | Local-only opt-out of Stripe signature verification |
| `RESEND_API_KEY` | Optional | Email: digest, employer notifications |
| `PUPPETEER_SKIP_DOWNLOAD` | Optional | Leave `false`; `@sparticuz/chromium` supplies the binary on Vercel |

### DATA_STORE handling
`src/lib/scraper/storage.ts` and `src/lib/all-jobs.ts` branch on `process.env.DATA_STORE === "supabase"`.

- **`supabase` is required in production.** The JSON files under `data/` are ephemeral on Vercel serverless — a write there is discarded when the invocation ends, so production scraping would appear to succeed and store nothing.
- `json` mode reads and writes `data/scraped-jobs.json` and `data/scrape-reports.json`. The committed `data/scraped-jobs.json` is `{"jobs": [], "lastUpdated": "2026-08-29"}` — empty, and expected to stay that way.
- `json` mode is a local dev convenience. Never set it in Vercel.
- The switch is read fresh from `process.env` on each access, not cached at module load.

### Scrape sources (`src/lib/scraper/sources.ts`) — 16 total, 11 enabled
| id | type | enabled | notes |
|----|------|---------|-------|
| `stepstone-chinese-de` | rss | no | dead feed |
| `indeed-chinese-de` | rss | no | anti-bot; superseded by Adzuna/Jobware |
| `adzuna-chinese-de` | json-api | yes | |
| `jobware-chinese-de` | html | yes | |
| `bosch-careers-china` | html | yes | `jsRendered`, `scrapingApi` |
| `linkedin-chinese-de` | html | no | `jsRendered`, `scrapingApi`; login-walled |
| `xing-chinese-de` | html | no | `jsRendered`, `scrapingApi`; login-walled |
| `sapprosoftmoms-china` | html | yes | |
| `huawei-europe-china` | html | yes | `jsRendered`, `scrapingApi` |
| `dfki-ai-china` | html | yes | `scrapingApi` |
| `fraunhofer-ai-china` | html | yes | `scrapingApi` |
| `make-it-in-germany` | html | yes | `scrapingApi` |
| `machinelearningjobs-de` | html | yes | `scrapingApi` |
| `remoteok-chinese` | json-api | yes | `scrapingApi` |
| `dronejobs-de` | html | yes | |
| `google-jobs-searchapi` | json-api | **no** | SearchAPI monthly quota exhausted — see §8 |

`scrapingApi: true` sources try the managed API first when `SCRAPING_API_KEY` is set, then fall back to Puppeteer/fetch on failure, on an implausible payload, or on a block/challenge page.

### Adding or editing a source
Edit `src/lib/scraper/sources.ts`. Per-source shape:

```typescript
{
  id: "unique-id", name: "…", nameZh: "…",
  type: "rss" | "html" | "json-api",
  url: "https://…", enabled: true,
  jsRendered: true,              // optional — routes to Puppeteer
  puppeteerOptions: { waitForSelector: "…", waitTimeout: 10000, scrollDelay: 2000, extraWaitMs: 2000 },
  scrapingApi: true,             // optional — try managed API first
  keywords: ["chinesisch", "chinese", "mandarin", "中文"],
  selectors: { jobCard, title, company, location, link, description },  // html only
  defaultField: "ai", defaultLocationCode: "de",
}
```

Test with `npx tsx scripts/scrape.ts --source=<id> --verbose`.

### Vercel cron
`vercel.json` holds exactly one entry — `{ "path": "/api/cron/daily", "schedule": "0 6 * * *" }` — because Vercel Hobby allows a single cron. Do not add a second entry. `/api/cron/weekly` and `/api/cron/digest` exist but are unscheduled; trigger them externally (GitHub Actions) with `Authorization: Bearer $CRON_SECRET`.

`/api/cron/daily` runs tiered by UTC weekday: Monday scrapes all enabled sources, other days scrape only `CHEAP_SOURCE_IDS` = `["google-jobs-searchapi", "remoteok-chinese"]`. Because `google-jobs-searchapi` is currently disabled, non-Monday runs effectively scrape **only** `remoteok-chinese`. That is where Google Jobs lands first on re-enable.

---

## 8. Known Limitations

### Non-code blockers
1. **German legal texts are placeholders.** The `legal_documents` seeds in `004_matching_legal.sql` are abbreviated drafts containing `[PLACEHOLDER]` markers; the tracked checklist is `docs/legal/IMPRINT-PRIVACY-TODO.md`. Outstanding: Impressum (§5 DDG / Art. 5 E-Commerce-RL), Datenschutzerklärung (GDPR Art. 13/14), DPA (AV-Vertrag with Vercel/Supabase), and Cookie policy — which additionally needs a consent banner before analytics are enabled. There are no `/imprint`, `/privacy`, or `/terms` pages yet. **A German IT-Recht lawyer must review the full text before any public launch** (design-doc budget ~€500–1,000 one-off). The §7.1 statement *"Jobbörse, keine Vermittlung — keine Vermittlung von Arbeitsverhältnissen, keine Erlaubnis nach §1 GewO"* must survive verbatim in all three languages; a lawyer's rewrite may not delete it.
2. **`match_scores` is empty** because no candidate has scored ≥ 70 against any job. The table exists, `/api/match` persists correctly, and the read path is sound — there is simply no data above the threshold. Expected behaviour, not a bug. Do not "fix" it by lowering the threshold without first understanding the scoring model.
   - **Open, and not confirmed as intended:** `match_scores` may stay empty for a second reason. `adaptJob` in `src/lib/matching.ts` now derives a default `required_languages` from `job.languageLevel` instead of leaving it empty, so a candidate with no `hsk_level` is hard-filtered out of **every** job rather than merely scoring low. Round 12 made the language filter fail closed on unparseable requirements, which is correct in isolation, but the combination means the board can match nobody until candidates record an HSK level. This is a deliberate product decision that has **not** been confirmed — settle it before treating an empty table as a scoring bug.
3. **Google Jobs stays disabled until 2026-10-01.** `google-jobs-searchapi` was turned off in commit `57fb297` because the SearchAPI monthly quota was exhausted. Re-enable only after 2026-10-01 and keep total monthly calls under 100 — the source fires 4 queries (chinesisch / chinese speaking / mandarin / China Market) with a `google_jobs` → `google` engine fallback, so a naive re-enable can burn the quota within a single daily run.

### Technical limitations
4. **Puppeteer on Vercel:** `@sparticuz/chromium` is ~50MB against the 250MB function limit. Hobby may work; Pro is safer. See `docs/build-report.md` and `scripts/measure-build.sh`.
5. **Anti-bot:** self-hosted Puppeteer does not defeat Cloudflare/PerimeterX. For LinkedIn/Indeed/StepStone a managed scraping API is the realistic path — which is why those three are disabled.
6. **No CSP.** See §4. A static `Content-Security-Policy` breaks every page in this app; it needs per-request nonces.
7. **Digest consent gap.** `/api/cron/digest` treats "has ≥ 1 saved filter" as the send gate because the schema has no opt-in column. A real consent column requires a migration; until then the 100-user per-run cap bounds the blast radius. See the `CONSENT` comment in that route.
8. **Single cron.** Vercel Hobby allows one schedule. Weekly and digest work is unscheduled.
9. **The JSON store is not a production store.** See §7.

---

## 9. Future Work

### Package E: WeChat Mini Program (decision-gated, HIGH for China reach)
- [ ] Register a Mini Program account (requires a Chinese business licence or individual developer status)
- [ ] Mini Program frontend against the existing `/api/*` routes
- [ ] WeChat login (OAuth) mapped to the Supabase user
- [ ] Save jobs, apply via WeChat
- [ ] WeChat push notifications; WeChat Pay if monetising

### Legal / compliance — gates public launch (see §8.1)
- [ ] Lawyer review of Impressum, Privacy, ToS, DPA, Cookie policy
- [ ] Ship `/imprint`, `/privacy`, `/terms` in all three languages, reachable from the footer within 2 clicks
- [ ] Cookie consent banner before enabling analytics
- [ ] Cross-border transfer consent for mainland-China registrations (PIPL)
- [ ] End-to-end delete-right verification

### Product gaps
- [ ] Candidate opt-in column + notification preferences (unblocks honest digest sends)
- [ ] Premium tier differentiation — all three tiers currently differ only in price, not duration or placement
- [ ] CV parsing and recommendation surfaces beyond score ≥ 70
- [ ] Company profile pages beyond what scraped data can derive
- [ ] More DACH employer career pages as sources

### Operational
- [ ] Per-request nonce plumbing for CSP
- [ ] Alert on consecutive scrape failures (`src/lib/watchdog.ts` exists; wiring review pending)
- [ ] Re-enable and re-tune Google Jobs after 2026-10-01 within the 100-call monthly budget

---

## 10. Business Model

| Stream | Description | Pricing |
|--------|-------------|---------|
| Job posting tiers | featured / pinned / enterprise, 30 days | free / €99 / €199 / €499 |
| Recruitment placement | Full-cycle headhunting for bilingual tech roles | €5,000–€15,000 per placement |
| Employer branding | Sponsored company profiles, Chinese-language video interviews | €299–€999/mo |
| Talent pool subscription | Recruiter access to opt-in candidate profiles | €199/mo |
| WeChat advertising | Sponsored posts to Chinese professionals | €99–€499/post |
| Premium content | "How to apply in DACH" courses, interview prep | €29–€99/course |
| Career fairs | Virtual or in-person DACH–China tech job fairs | €500–€5,000/booth |

Only the posting tiers are implemented (Stripe checkout + webhook). Everything else is unbuilt.

**Cost structure (monthly, approximate):** hosting €0–20, Supabase €0–25, domain+email €5–20, scraping API €0–49, email €0–20, marketing €50–1,000.

**Metrics to track:** job postings/month, registered candidates, application conversion rate, time-to-fill, newsletter + WeChat reach, employer repeat rate, scrape success rate, organic traffic.

**Go-to-market:** Chinese students graduating from DACH universities; Chinese professionals already in DACH; Chinese professionals in China needing visa sponsorship. Employer targets: automotive (VW, BMW, Bosch, Continental, ZF), robotics (KUKA, Festo, Pilz, Beckhoff, ABB), drones (Wingcopter, Quantum-Systems), AI/tech (SAP, Celonis, DeepL, Hugging Face), Chinese-in-DACH (Huawei, BYD, NIO, DJI, Xiaomi), research (Fraunhofer, Max Planck, DFKI, ETH Zurich). Channels: WeChat, Xiaohongshu, LinkedIn, TU9 Chinese student associations, Zhihu/V2EX, SEO.

---

## 11. Technical Notes for Continuing Agent

### Architecture decisions
- **Server/client split:** pages needing the DB or `fs` are server components that pass data to a `*Client.tsx` client component. `DATA_STORE` is server-only.
- **Language:** `LanguageProvider` wraps the app; `useLang()` gives `lang`, `setLang()`, `t`. New strings go into all three languages in `src/lib/i18n.ts` (`translations.en` / `.zh` / `.de`) — a missing key is a visible gap, not a silent fallback.
- **Read path:** `getAllJobs()` / `getJobById()` in `src/lib/all-jobs.ts` → Supabase when `DATA_STORE=supabase`, else the JSON file. It pages at 1000 with a hard stop at 20 pages and degrades to a partial or empty list rather than throwing, so the sitemap and detail pages cannot 500 because the DB hiccuped.
- **Expiry:** `listJobs` defaults to `includeExpired=false`; the job detail page still returns expired jobs with a badge. Migration 005 is not applied in every environment, so the repo layer degrades gracefully instead of erroring.
- **Match scores:** persistence degrades to `{ saved: 0, degraded: true }` when migration 004 is absent, instead of throwing.
- **Scraper routing:** `scrapingApi` + `SCRAPING_API_KEY` → managed API; else `jsRendered` → Puppeteer; else `fetch`. Every path is abortable (`AbortSignal`) so the 280s cron timeout actually stops the work and closes Chromium rather than leaving an orphan browser.
- **Validation lives in the Zod schemas**, `src/lib/validations/`. `src/lib/job-validation.ts` is **dead code** — nothing under `src/` imports it, only `tests/` does. Round 12 found an XSS fix that had been made there while the live schema stayed vulnerable. Before you "harden" a validator here, confirm with `grep -rn "<module>" src/` that the module is actually on the request path; a green test file proves nothing about reachability.

### Deprecated sample jobs
`src/lib/jobs.ts` still exports a 32-entry `sampleJobs` array and `SAMPLE_MODE = false`. The array is **not** served: in `supabase` mode `getAllJobs()` returns DB jobs only, and `getJobById` consults a sample id solely as a last-resort fallback. It survives only as the input to `scripts/seed.ts`. Treat it as dead weight — do not restore it to the board, and do not add seeding to any workflow.

### Adding a page
1. Create `src/app/<route>/page.tsx`.
2. Server component if it needs the DB or `fs`; hand off to a `*Client.tsx` if interactive.
3. `"use client"` only when state, effects, or handlers are required.
4. Navbar/Footer are already in the root layout.
5. Add every new i18n key to all three languages.

### Adding an API route
1. Decide the auth model first: public + rate limit, session, session + role, or a secret. Do not default to public.
2. Session-based: `getCurrentUser()`; admin: `getProfileRole(user.id) === "admin"`. Never read identity from the request.
3. Secret-based: mirror the `CRON_SECRET` block exactly, including the production fail-closed branch and the `Cache-Control: no-store` 401.
4. Validate input with the Zod schemas in `src/lib/validations/`.
5. Rate-limit, then add a test under `tests/`.

### Testing
- `npm test` (Vitest, 23 files, 1777 tests), `npm run test:watch`, `npm run test -- --coverage`
- Tests live in `tests/` and `tests/unit/`; `vitest.config.ts` maps `@/` to `src/`
- `npx tsc --noEmit` and `npm run lint` must both be 0
- Prefer tests that assert **semantics** over shape — a shape-encoding test will happily pin a bug (round 6 had to rewrite one for exactly this reason)

### Deployment checklist
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` in Vercel
- [ ] `DATA_STORE=supabase` in Vercel — confirm it is not `json`
- [ ] `CRON_SECRET` set in Vercel to a random value. Without it `/api/scrape` and `/api/cron/*` return 401 in production and nothing scrapes
- [ ] `ALLOW_UNVERIFIED_WEBHOOKS` is **not** set on any deployed environment
- [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` set if payments are live
- [ ] Migrations 001 → 005 applied in order on the Supabase project
- [ ] Cron registered in Vercel Dashboard → Settings → Cron Jobs: one entry, daily 06:00 UTC → `/api/cron/daily`
- [ ] `SCRAPING_API_KEY` set if the `scrapingApi: true` sources should use the managed API
- [ ] Smoke test: `curl -H "Authorization: Bearer $CRON_SECRET" https://sinotechjobs.vercel.app/api/scrape` returns stats, not 401
- [ ] Smoke test: `/api/cron/digest` with only `x-vercel-cron: 1` and no Bearer header returns 401 — this is the regression to watch
- [ ] Do **not** run `npm run seed` against production

---

## 12. Contact & Context

- **Project owner:** user (FBMHCA5)
- **Original concept:** 2026-08-11 · **MVP complete:** 2026-08-11
- **Environment:** macOS, Node 24, npm 11
- **Deploy:** Vercel `sinotechjobs.vercel.app` (auto-deploy from `main`)
- **Database:** Supabase `nzlhmjcugibacpbiqtyr`
- **Repo:** `maxray88/sinotechjobs` (public)
