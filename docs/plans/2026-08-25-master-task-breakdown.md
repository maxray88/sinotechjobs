# SinotechJobs — Master Task Breakdown

> **For Hermes:** Execute task-by-task via the 3-role workflow (Plan → Codex Build → Hermes Verify → Claude Code Review → Codex Fix). One dispatch = one task unless marked BATCH.
> **Companion:** [docs/PRD.md](./PRD.md) | **Created:** 2026-08-25
> **Legend:** each task lists Objective / Owner split / Files / Verify (exact commands + expected output) / Commit.

---

## Phase 0 — Foundations (PRD E1) · Milestone M0

### T0.1 Initialize git repository

- **Objective:** Version control baseline; every later change reviewable/reversible.
- **Build (Codex):** Review existing `.gitignore`; extend to cover `node_modules/`, `.next/`, `.env*`, `data/scraped-jobs.json`, `data/scrape-reports.json`, `.vercel/`. Run:
  ```bash
  git init -b main && git add -A && git commit -m "chore: baseline import of MVP + scraper (pre-existing state)"
  ```
- **Verify (Hermes):** `git log --oneline` shows ≥1 commit; `git status` clean; `git check-ignore data/scraped-jobs.json` exits 0; repo size sane (`du -sh .git` < 50MB).
- **Commit:** initial baseline (above).

### T0.2 Create private GitHub remote & push

- **Objective:** Off-machine backup; enables CI.
- **Owner:** Requires user GitHub auth (`gh auth status`) — Hermes confirms before dispatch.
- **Build (Codex):** `gh repo create sinotechjobs --private --source . --push`.
- **Verify (Hermes):** `git remote -v` shows origin; `git ls-remote --heads origin` returns `main`.

### T0.3 Add npm scripts + Vitest scaffold

- **Files:** modify `package.json` (scripts); create `vitest.config.ts`, `tests/setup.ts`, first test dir `tests/unit/`.
- **Steps (Codex):**
  1. `npm i -D vitest @vitest/coverage-v8`
  2. Scripts: `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`, `"test:watch": "vitest"`.
  3. Smoke test `tests/unit/smoke.test.ts`: `expect(1+1).toBe(2)`.
- **Verify (Hermes):** `npm run typecheck` exit 0 · `npm test` → `1 passed`.
- **Commit:** `build: add typecheck script and vitest scaffold`

### T0.4 Unit tests for scraper core logic (BATCH — pure functions, no network)

- **Objective:** Lock in behavior of keyword engine, auto-detection, dedup before touching storage.
- **Files:**
  - `tests/unit/keywords.test.ts` — strong vs weak match classification ("chinesisch"/"mandarin" = strong; "APAC" = weak), empty text, mixed case
  - `tests/unit/detection.test.ts` — field/location/language-level/type/tag inference from raw text fixtures
  - `tests/unit/storage-dedup.test.ts` — dedup by URL, max-500 cap, JSON round-trip using temp dir (`os.tmpdir()`), never touching real `data/`
- **Target:** ≥15 passing tests total.
- **Verify (Hermes):** `npm test` → all green; coverage report lists `src/lib/scraper/keywords.ts` ≥80% lines.
- **Commit:** `test: unit coverage for keywords, detection, storage dedup`

### T0.5 i18n parity test

- **Files:** `tests/unit/i18n.test.ts`
- **Behavior:** assert EN/ZH/DE translation objects share identical key sets (deep walk); fail listing missing keys.
- **Why:** future features will add strings; this makes locale drift a build failure.
- **Verify:** `npm test` green after deliberately removing one DE key in a scratch run (red/green proof), restored afterwards.
- **Commit:** `test: enforce trilingual key parity`

### T0.6 De-Windows docs + AGENTS.md refresh

- **Files:** `README.md`, `AGENTS.md`
- **Changes:** replace `C:\Users\FBMHCA5\...` with `~/01_Coding_Projects/05_Sinotech_Jobboard`; PowerShell→bash blocks; note macOS as dev host; link PRD + this plan; record the 3-role workflow line for other agents.
- **Verify (Hermes):** `grep -rn "C:\\\\" README.md AGENTS.md` → no matches; links resolve.
- **Commit:** `docs: macos paths, agent context, PRD links`

### T0.7 GitHub Actions CI

- **Files:** create `.github/workflows/ci.yml`
- **Content:** on push/PR → node 20 → `npm ci` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run build`.
- **Verify (Hermes):** push to a throwaway branch; Actions run green (or documented failure unrelated to code).
- **Commit:** `ci: typecheck+lint+test+build pipeline`

---

## Phase 1 — Supabase Data Layer (PRD E2) · start of M1

> **Prereq:** user provides Supabase project URL + keys (or PAT `sbp_…` for Management-API automation per skill reference `supabase-credential-setup.md`). Env vars land in `.env.local` (gitignored) + Vercel later.

### T1.1 Write migration SQL

- **Files:** create `db/migrations/001_init.sql` — exact schema from PRD §7 (jobs, scrape_reports, email_subscriptions, employer_postings, profiles + indexes + RLS enable).
- **Apply (Codex, if PAT provided):** curl Management API `POST /v1/projects/{ref}/database/query`; else hand user SQL for dashboard.
- **Verify (Hermes):** query endpoint returns table list incl. all 5 tables; RLS enabled flags true.

### T1.2 Server-only Supabase client + env typing

- **Files:** create `src/lib/db/client.ts` (service-role client, `import "server-only"`), `src/lib/db/types.ts` (row types mirroring schema), extend `.env.example`.
- **Guardrail:** `server-only` package ensures any client-component import breaks the build.
- **Verify (Hermes):** `npm run typecheck` 0; `grep -r "service_role\|SERVICE_ROLE" src/app src/components` → only under `src/lib/db` or route handlers.

### T1.3 Storage adapter behind DATA_STORE flag (TDD)

- **Files:** create `src/lib/db/jobs-repo.ts` (+ `email-repo.ts`, `reports-repo.ts`); modify `src/lib/scraper/storage.ts` to delegate by flag; keep JSON path intact.
- **Interface:** `listJobs(filter?): Promise<Job[]>`, `upsertJobs(jobs: Job[]): Promise<{added:number}>`, `getJob(id)` etc. — async signatures.
- **Tests first (`tests/unit/jobs-repo.test.ts`):** mock Supabase client; assert filter→query mapping (field/location/languageLevel/remote/visa/q/pagination) and upsert dedup on `source_url`.
- **Verify:** red → implement → green; both flag values pass suite.
- **Commit:** `feat(db): supabase-backed job/email/report repos behind DATA_STORE flag`

### T1.4 Make job access async across app

- **Files:** modify `src/lib/all-jobs.ts` (async), `src/app/page.tsx`, `src/app/jobs/page.tsx`, `src/app/jobs/[id]/page.tsx`, `src/app/api/jobs/route.ts` (await + server-side filtering/pagination params per FR-E2-6).
- **Verify (Hermes):** `npm run typecheck` 0 · `npm run build` succeeds · dev-server curls:
  ```bash
  curl -s localhost:3000/api/jobs?field=ai&location=de | jq '.total'
  curl -s localhost:3000/api/jobs?q=python | jq '.items[0].title'
  ```
- **Review focus (Claude Code):** no unhandled promise in server components; pagination math off-by-one.
- **Commit:** `feat: async data access + server-side filtering/pagination`

### T1.5 Seed sample jobs (idempotent)

- **Files:** create `scripts/seed.ts`; mark `src/lib/jobs.ts` export as seed-source only.
- **Logic:** upsert by id; `source='sample'`; re-run adds 0.
- **Verify:** run twice → second run reports `added: 0`; DB count = 32.
- **Commit:** `feat: idempotent sample-job seed`

### T1.6 Fix newsletter capture end-to-end (TDD)

- **Files:** create `src/app/api/subscribe/route.ts` (zod email validation, upsert, duplicate-safe, rate-limit hook stub); modify `src/components/EmailCapture.tsx` (POST + success/error states, trilingual strings via i18n).
- **Tests:** `tests/unit/subscribe.test.ts` — valid/invalid/duplicate payloads against mocked repo.
- **Verify:** `curl -X POST localhost:3000/api/subscribe -d '{"email":"a@b.com"}'` → 200; repeat → 200 `duplicate:true`; `bad` → 400; row count stays 1.
- **Commit:** `feat: newsletter subscribe API wired to EmailCapture`

### T1.7 Admin dashboard reads from Supabase

- **Files:** modify `src/app/admin/page.tsx` + `/api/scrape/route.ts` GET (stats/reports from `scrape_reports`).
- **Verify:** seeded numbers render; scrape history shows migration-era rows.
- **Commit:** `feat: admin stats from supabase`

---

## Phase 2 — Production Deploy & Scraper Verification (PRD E3) · completes M1

### T2.1 Split cron routes

- **Files:** create `src/app/api/scrape-full/route.ts`; modify `src/app/api/scrape/route.ts`; rewrite `vercel.json` crons to two clean paths (no query strings — F6).
- **Auth:** both routes require `Authorization: Bearer ${CRON_SECRET}` when env set; Vercel cron sends it automatically once configured.
- **Verify:** unauthorized POST → 401; authorized dry-run locally executes engine with JSON store.
- **Commit:** `feat: split daily/full cron routes + secret gate`

### T2.2 GitHub push → Vercel auto-deploy

- **Owner split:** Codex pushes `main` to GitHub; user自管 Vercel（已 link GitHub），Vercel 自动构建部署
- **Env vars:** user在 Vercel Dashboard 设置 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`(secret)、`CRON_SECRET`(secret)、`DATA_STORE=supabase`
- **Verify (Hermes):** `git push origin main` 成功；用户确认 Vercel prod URL 返回 200
- **Commit:** n/a（配置由用户在 Vercel 完成），tag `v0.2.0-data-layer`

### T2.3 Puppeteer bundle measurement

- **Task:** deploy includes chromium path; check function size via `vercel logs`/dashboard; document number.
- **Decision gate:** >250MB ⇒ flip the 5 jsRendered sources to scraping-API fallback (E6) or accept fetch-only for launch. Record decision in PRD §10 risk table.
- **Deliverable:** `docs/scraper-health.md` section "bundle".

### T2.4 Prod scrape matrix (the big unknown — F7)

- **Task:** trigger full scrape on prod (authorized POST `/api/scrape-full`); collect per-source results.
- **Output:** `docs/scraper-health.md` matrix: source · mode(fetch/puppeteer) · result · jobs found · error class (anti-bot/selector-drift/network) · verdict (keep/fix/fallback/disable).
- **Success bar:** ≥60% sources succeeding, else fallback plan filed (E6 priority bump).
- **Verify:** scraped jobs visible on prod `/jobs` w/ badge (FR-E3-5); `scrape_reports` row written.
- **Commit:** `docs: production scraper health matrix`

### T2.5 Protect /admin

- **Options (pick at kickoff):** (a) simplest — middleware checking admin cookie issued by a CRON_SECRET-style passphrase form; (b) Supabase Auth role from `profiles`. Choose (a) for speed pre-M2.
- **Files:** create `src/middleware.ts`; modify `src/app/admin/page.tsx` (login gate).
- **Verify:** logged-out visit redirects; wrong passphrase rejected; correct → dashboard.
- **Commit:** `feat: admin route protection`

### T2.6 Demo-job watermark (F10 partial remediation)

- **Task:** badge "Demo/Demo/演示" on `source='sample'` cards + detail pages until replaced; legal disclaimer in footer.
- **Verify:** visual check on prod; strings exist in all 3 locales (parity test enforces).
- **Commit:** `feat: watermark curated demo jobs`

---

## Phase 3 — Employer Portal & Payments (PRD E4) · M2

> Detailed prompts authored at kickoff; task list fixed as follows:

| ID | Task | Key files |
|---|---|---|
| T3.1 | Supabase Auth (magic-link) + profiles trigger + session helpers | `src/lib/auth.ts`, `src/app/auth/*` |
| T3.2 | Rewire /post → `employer_postings` insert w/ zod validation + trilingual errors | `src/app/post/page.tsx`, new `api/postings/route.ts` |
| T3.3 | Employer dashboard (own postings + statuses, RLS-verified) | `src/app/employer/dashboard/page.tsx` |
| T3.4 | Admin approvals queue: approve→publish to jobs, reject w/ reason | `src/app/admin/approvals/page.tsx`, `api/admin/postings/route.ts` |
| T3.5 | Resend integration: confirm/approve/reject templates (locale-aware), `RESEND_API_KEY` | `src/lib/email.ts` |
| T3.6 | Tier selection UI + pricing copy (free/99/199/499) | post form + pricing page |
| T3.7 | Stripe Checkout (test mode) + webhook → `payment_status`, `featured_until`; webhook idempotency key | `api/stripe/checkout/route.ts`, `api/stripe/webhook/route.ts` |
| T3.8 | Rate limiting on public POSTs (subscribe, postings): 10/min/IP → 429 | `src/lib/ratelimit.ts` |

Exit condition: register→post→approve→paid-elevation happy path demonstrable on preview deployment.

## Phase 4 — Candidate Features (PRD E5) · M3

| ID | Task | Key files |
|---|---|---|
| T4.1 | Candidate profile CRUD + visibility toggle | `candidate_profiles` table, `/profile` |
| T4.2 | Saved jobs (bookmark endpoints + optimistic UI + `/saved`) | `saved_jobs`, components |
| T4.3 | Saved filter sets + weekly digest cron (Mon 07:00 UTC, Resend, skip-if-empty) | `saved_filters`, `api/cron/digest` |
| T4.4 | Application tracker statuses | `applications` |
| T4.5 | CV upload (private bucket, ≤5MB PDF, signed URLs owner-only) | Storage policies |

## Phase 5 — Growth Hardening (PRD E6–E8) · M4

| ID | Task | Notes |
|---|---|---|
| T5.1 | Scraping-API fallback chain (flag per source) | Only if T2.3/T2.4 show need |
| T5.2 | Per-source health scores + auto-disable after 5 fails + re-enable button | /admin |
| T5.3 | Sources ToS/compliance doc | `docs/sources-compliance.md` |
| T5.4 | JobPosting JSON-LD + Rich-Results validation | job detail |
| T5.5 | sitemap.ts + robots.txt + hreflang trio | app root |
| T5.6 | Company pages `/companies/[slug]` | generated from jobs |
| T5.7 | Blog skeleton + 2 launch articles | MDX; 配图经 ComfyUI 生成、动效/视频片段经 Hyperframes |
| T5.8 | Plausible analytics + admin metrics events | script + events |
| T5.9 | Scrape watchdog alerting (<40% success or 3× total failure → email) | cron follow-up |
| T5.10 | OG/社交卡片图组（home/jobs/article 三模板），经本地 ComfyUI 生成；如需演示视频经 Hyperframes | 输出 → `public/media/`，随 T5.4/T5.5 上线 |

## Phase 6 — WeChat Track (PRD E9) · parallel, decision-gated

| ID | Task |
|---|---|
| T6.1 | Account/license/ICP decision memo (user inputs required) |
| T6.2 | Mini Program prototype (Taro) against staging API: search/detail/save/share |
| T6.3 | China-access backend plan (ICP 备案 vs domestic proxy, costs/timeline) |

---

## Execution Order & Dispatch Rules

```
T0.x sequential (repo before CI; tests before storage swap)
T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → (T1.6 ∥ T1.7)
T2.1 → T2.2 → T2.3 → T2.4 → (T2.5 ∥ T2.6)
Phases 3+ dispatched at milestone kickoff with full writing-plans detail
```

Per-dispatch contract (every Codex prompt must contain):
1. Exact file paths to create/modify + "modify ONLY these"
2. Relevant type/interface definitions pasted inline
3. Verification commands + expected output
4. "Run `npm run typecheck` before finishing; do NOT commit" (Hermes commits post-review)

Per-task loop: **Codex build → Hermes verify (typecheck/lint/test/build + curls) → Claude Code review (read-only, sonnet) → Codex fixes → re-verify → commit.**
Tool failure at any step ⇒ STOP, report ≤5 lines, ask user. Never improvise direct source edits.
