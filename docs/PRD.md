# SinotechJobs — Product Requirements Document (PRD)

> **Version:** 1.0 | **Date:** 2026-08-25 | **Status:** Draft for execution
> **Owner:** Hermes (PM/orchestrator) | **Companion doc:** [docs/plans/2026-08-25-master-task-breakdown.md](./2026-08-25-master-task-breakdown.md)
> **Project root:** `~/01_Coding_Projects/05_Sinotech_Jobboard`

---

## 0. Executive Summary

SinotechJobs is a trilingual (EN/ZH/DE) job board connecting Chinese-speaking tech talent with employers in the DACH region (Germany, Austria, Switzerland), focused on CS, AI/ML, Robotics, Drones/UAV, and remote roles where Chinese language skills are an asset.

The MVP (curated board, filters, job detail, trilingual UI) and scraping infrastructure (13 sources, keyword engine, Puppeteer) are **code-complete but unverified in production**. This PRD covers taking the platform from "works locally" to "launched and monetizable": database migration, production deployment, employer portal with payments, candidate features, SEO, analytics, and eventually a WeChat Mini Program.

---

## 1. Problem Statement

| Stakeholder | Pain today |
|---|---|
| Chinese-speaking tech talent in/heading to DACH | No job board lets them filter jobs where Chinese is valued; StepStone/Indeed/LinkedIn have no "Chinese language" criterion; info about visa sponsorship is scattered |
| DACH employers hiring Chinese-speaking engineers | Cannot target this niche pool on general boards; agencies charge 15–25% placement fees |
| Platform operator | Curating manually doesn't scale; no funnel for employer revenue |

**Differentiator:** the only DACH tech job board with (a) Chinese-language-requirement filtering, (b) bilingual EN/ZH job descriptions, (c) automated aggregation from 13 regional sources.

---

## 2. Goals & Non-Goals

### Goals (this PRD cycle)
G1. Production launch on Vercel with persistent storage (Supabase) — no data loss between requests
G2. Automated job ingestion running daily with ≥60% source success rate, measured
G3. Employer self-serve posting with admin approval workflow and paid premium tiers
G4. Candidate retention features: accounts, saved jobs, email alerts
G5. Organic acquisition: full SEO (JobPosting structured data, sitemap, hreflang)
G6. Measurable operations: analytics, scrape monitoring, alerting

### Non-Goals (explicitly out of scope)
- Native iOS/Android apps
- In-platform chatting / video interviews
- Resume AI-parsing or ranking algorithms
- Regions beyond DACH
- Multi-currency payment (EUR only)
- Job-seeker recruitment agency services (placement fees)

---

## 3. Personas

**P1 — Wei, 29, ML Engineer (Candidate)**
Master's in Germany or planning to relocate; reads ZH, works in EN, learning DE. Wants: filter by field/city/visa-sponsorship/remote, see if Mandarin is a plus, apply fast, get alerted when matching jobs appear.

**P2 — Lena, Talent Acquisition at a Munich robotics SME (Employer)**
Needs 2 ROS engineers "ideally with Chinese market exposure". Wants: post a job in minutes, bilingual description, pay once for visibility, see posting status.

**P3 — Operator (Admin, the founder)**
Wants: one dashboard showing scrape health, queue of employer submissions to approve/reject, revenue view. Trusts automation but needs failure alerts.

---

## 4. Success Metrics (KPIs)

| Metric | Baseline (today) | Target +90 days post-launch |
|---|---|---|
| Live jobs on board | 32 (sample) + 0 scraped | ≥300 (≥50% scraped) |
| Scrape source success rate | 0% (unverified) | ≥60% weekly |
| Weekly active candidates | 0 | 500 |
| Newsletter subscribers | 0 (signups currently lost — no API) | 250 |
| Employer postings submitted | 0 | 20 |
| Approved employer postings | 0 | 12 |
| Paid premium postings | 0 | ≥3 |
| LCP on /jobs (p75) | unmeasured | < 2.5s |
| Scrape-failure alert latency | none | < 24h |

---

## 5. Current State Audit (verified 2026-08-25)

Code-complete and working:
- Next.js 16.3 + React 19.2 + TS 5 + Tailwind 4; `tsc --noEmit` passes clean
- Pages: home, /jobs (filters), /jobs/[id], /post (form), /admin (scrape dashboard)
- Trilingual i18n provider with localStorage persistence
- Scraper module: 13 sources, strong/weak Chinese-keyword engine, Puppeteer routing, JSON storage w/ dedup (max 500), CLI + API + Vercel cron config
- 32 curated sample jobs in `src/lib/jobs.ts` (1053 lines)

Gaps and defects found by inspection (drive Phase 0–2 priorities):

| # | Finding | Impact |
|---|---|---|
| F1 | **No git repository** — zero version control; only a stale zip backup | Critical data-loss risk; blocks CI/code review |
| F2 | `/post` employer form does **not persist** anywhere (no matching API route) | Core employer funnel broken |
| F3 | `EmailCapture` has **no subscribe API** — newsletter signups silently discarded | Growth funnel broken |
| F4 | `/admin` has **no authentication** (no middleware.ts in project) | Anyone can trigger scrapes / clear data |
| F5 | Storage is JSON-on-disk → **ephemeral on Vercel serverless** | Scraped jobs vanish between invocations |
| F6 | `vercel.json` cron path uses query string `?mode=full` | Query strings in Vercel cron paths are unsupported/unreliable → weekly full scrape may never differ from daily |
| F7 | Scraping never verified off the blocked dev network (last report: 0/N sources) | Unknown whether Puppeteer works serverless; unknown per-source health |
| F8 | Zero tests; no CI | Every change risks silent regression |
| F9 | Docs reference Windows paths (`C:\Users\FBMHCA5`) | Stale onboarding for agents/humans |
| F10 | Sample jobs use real company names (Bosch, SAP, BMW…) with **fabricated descriptions** | Legal/trust risk if launched publicly |

---

## 6. Epic Breakdown & Functional Requirements

Priority legend: P0 = launch blocker, P1 = fast-follow, P2 = growth, P3 = strategic bet.

### E1 — Engineering Foundations (P0)
Re-establish basic engineering hygiene so everything else is reviewable and reversible.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E1-1 | Git repo initialized at project root, meaningful initial commit | `git log` shows baseline commit incl. all current source; `.gitignore` excludes `node_modules`, `.next`, `.env*`, `data/` |
| FR-E1-2 | Remote on GitHub (private), pushed | `git push` succeeds; branch protection on `main` (optional, single-dev) |
| FR-E1-3 | Scripts: `typecheck`, `lint`, `test`, `build` all runnable | `npm run typecheck` exits 0 |
| FR-E1-4 | Docs de-Windows-ified (README, AGENTS.md paths) | No `C:\` references remain |
| FR-E1-5 | Test framework (Vitest) wired with ≥15 passing unit tests covering keywords, detection, dedup, i18n key parity | `npm test` green in CI |

### E2 — Data Layer Migration to Supabase (P0)
Replace JSON file storage with PostgreSQL. This is the prerequisite for everything multi-user.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E2-1 | Tables: `jobs`, `scrape_reports`, `email_subscriptions`, `employer_postings` (schema §7) created via migration SQL kept in-repo | `db/migrations/001_init.sql` applied to project; tables visible in Supabase |
| FR-E2-2 | Server-side Supabase client module (`src/lib/db/client.ts`), service-role key server-only | No secret appears in client bundle (`npm run build` + grep) |
| FR-E2-3 | Storage adapter rewritten: same logical interface, async, backed by Supabase; JSON mode retained behind `DATA_STORE=json|supabase` env flag for local dev/rollback | Switching flag changes storage without code edits; both modes pass tests |
| FR-E2-4 | `getAllJobs()`/`getJobById()` become async; all server components awaited | Pages render identical content pre/post switch |
| FR-E2-5 | 32 sample jobs seeded into `jobs` table (`source='sample'`); `src/lib/jobs.ts` remains as seed source only | Seed script idempotent (re-run ≠ duplicates) |
| FR-E2-6 | `/api/jobs` supports `field`, `location`, `languageLevel`, `employmentType`, `remote`, `visa`, `q`, `page`, `pageSize` params server-side | curl with filters returns filtered/paginated JSON |
| FR-E2-7 | **EmailCapture fixed:** `POST /api/subscribe` validates + upserts into `email_subscriptions`; component calls it; duplicate-safe | Submitting same email twice → 1 row; invalid email → 400 |
| FR-E2-8 | `/admin` stats read from Supabase | Dashboard reflects seeded counts |

### E3 — Production Deployment & Scraper Verification (P0)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E3-1 | Cron split into two real routes: `/api/scrape` (daily incremental) and `/api/scrape-full` (weekly full); both honor `CRON_SECRET` bearer | `vercel.json` contains no query strings; unauthorized POST → 401 |
| FR-E3-2 | App deployed on Vercel (preview + prod) with all env vars set | Prod URL serves home/jobs/detail pages HTTP 200 |
| FR-E3-3 | Manual full scrape triggered against prod; **per-source result matrix recorded** (success/fail/why) | Matrix committed to `docs/scraper-health.md`; ≥60% sources succeed or failures explained (anti-bot vs bug) |
| FR-E3-4 | Puppeteer/@sparticuz/chromium verified serverless; function bundle ≤ plan limit | Scrape of a `jsRendered:true` source returns >0 jobs; function size logged |
| FR-E3-5 | Scraped jobs appear on prod /jobs with "Scraped" badge | End-to-end: scrape → visible listing |
| FR-E3-6 | `/admin` protected (Supabase Auth role `admin` or CRON_SECRET-style gate) | Unauthenticated visitor → redirect/401 |

### E4 — Employer Portal & Approval Workflow (P1, Sprint 2)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E4-1 | Employer auth via Supabase Auth (email magic link); `profiles` table with `role: employer|admin` | Register → login → session persists |
| FR-E4-2 | `/post` form rewired: submits validated payload to `employer_postings` (status `pending`), tied to authed user; bilingual validation (EN required, ZH optional-but-encouraged) | Submission appears in DB; missing EN title/description → inline errors |
| FR-E4-3 | `/employer/dashboard`: list own postings + status (pending/approved/rejected + reason) | Employer sees only own rows (RLS enforced) |
| FR-E4-4 | `/admin/approvals`: review queue, approve → publishes into `jobs` (`source='manual'`), reject with reason | Approved job visible on /jobs within 60s |
| FR-E4-5 | Transactional email via Resend: submission confirmation, approval, rejection(+reason) | Emails received; templates trilingual-aware (send in poster's locale) |
| FR-E4-6 | Premium tiers: `featured €99` (top slot + highlight, 30d), `pinned €199` (category top, 30d), `enterprise €499/mo` (N posts + featured) | Tier selectable at submission; free tier always available |
| FR-E4-7 | Stripe Checkout + webhook: paying marks posting `paid`, sets `featured_until` | Test-mode purchase elevates a posting; webhook idempotent |
| FR-E4-8 | Rate limiting on public POST endpoints (subscribe, posting submit) | >10 req/min/IP → 429 |

### E5 — Candidate Features (P1, Sprint 3)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E5-1 | Candidate auth (same Supabase Auth), `candidate_profiles` (skills, languages, preferred locations, visibility toggle) | Profile editable; invisible when toggled off |
| FR-E5-2 | Saved jobs: bookmark on listing/detail; `/saved` page | Persisted per user; works logged-out → prompt to login |
| FR-E5-3 | Job alerts: saved filter sets → weekly digest email (Resend) of new matching jobs | Digest cron runs Monday 07:00 UTC; only sent when ≥1 match |
| FR-E5-4 | Application tracking (applied→screening→interview→offer) per saved job | Status updates persist |
| FR-E5-5 | CV upload to Supabase Storage (private bucket, PDF ≤5MB), opt-in recruiter visibility | File downloadable only by owner; admin cannot browse without cause |

### E6 — Scraping Reliability (P2)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E6-1 | Managed scraping-API fallback chain: scraping API → Puppeteer → fetch, per-source opt-in flag | Source with flag still returns jobs when direct fetch blocked |
| FR-E6-2 | Per-source health scoring (7-day rolling success rate) surfaced in /admin | Dashboard shows % per source |
| FR-E6-3 | Auto-disable sources failing 5 consecutive runs (with re-enable button) | Disabled source skipped by engine; logged |
| FR-E6-4 | ToS/legal review notes per source in `docs/sources-compliance.md` (which allow scraping, which must use official APIs/RSS only) | LinkedIn/Indeed flagged appropriately; no source scraped against explicit ToS |

### E7 — SEO & Content (P2)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E7-1 | JobPosting JSON-LD on every job detail page | Rich Results Test passes on a prod URL |
| FR-E7-2 | `sitemap.ts` (home, jobs, each job, statics) + robots.txt allowing crawlers except /admin,/api | Sitemap reachable at /sitemap.xml |
| FR-E7-3 | Per-page metadata + OG/Twitter cards; hreflang trio (en/zh/de) on public pages | View-source shows alternates |
| FR-E7-4 | Company profile pages `/companies/[slug]` generated from jobs data | Page lists company's open jobs |
| FR-E7-5 | Blog skeleton (`/blog`, MDX) with 2 launch articles (Blue Card visa guide; DACH salary benchmarks) | Articles render trilingual UI chrome |

### E8 — Analytics & Monitoring (P2)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E8-1 | Privacy-friendly analytics (Plausible) on public pages | Dashboard records pageviews |
| FR-E8-2 | Admin metrics: views per job, search/filter usage, application clicks | Visible in /admin |
| FR-E8-3 | Scrape watchdog: after each scheduled run, if success rate <40% or 3 consecutive total failures → email alert (Resend) | Simulated failure triggers exactly 1 alert |

### E9 — WeChat Mini Program (P3, parallel track)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-E9-1 | Account strategy resolved (individual vs business license; WeChat Pay merchant prerequisites documented) | Decision memo in docs |
| FR-E9-2 | Mini Program (native or Taro) consuming existing APIs: search, detail, save, share | Runs in WeChat DevTools against staging API |
| FR-E9-3 | China-accessibility plan for backend (ICP 备案 vs domestic proxy) — **hard dependency, long lead time** | Written plan with costs/timeline |

Note: FR-E9 depends on user-side registrations (business license, domains). Agent work is blocked on FR-E9-1 decision.

---

## 7. Target Data Model

```sql
-- Migration 001 (authoritative copy lives in db/migrations/001_init.sql)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, title_zh TEXT,
  company TEXT NOT NULL, company_zh TEXT,
  field TEXT CHECK (field IN ('ai','cs','robotics','drone','remote')),
  location TEXT, location_code TEXT CHECK (location_code IN ('de','at','ch','remote')),
  language_level TEXT CHECK (language_level IN ('nice-to-have','required','fluent')),
  employment_type TEXT CHECK (employment_type IN ('full-time','part-time','internship','contract')),
  salary_range TEXT,
  description TEXT NOT NULL, description_zh TEXT,
  requirements TEXT[] DEFAULT '{}', requirements_zh TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  application_url TEXT NOT NULL,
  source_url TEXT UNIQUE,                      -- dedup anchor for scraped jobs
  posted_date DATE,
  remote_friendly BOOLEAN DEFAULT FALSE,
  visa_sponsorship BOOLEAN DEFAULT FALSE,
  featured BOOLEAN DEFAULT FALSE,
  featured_until TIMESTAMPTZ,                  -- paid placement expiry
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free','featured','pinned','enterprise')),
  source TEXT DEFAULT 'scraped' CHECK (source IN ('sample','scraped','manual')),
  source_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_jobs_field ON jobs(field);
CREATE INDEX idx_jobs_location ON jobs(location_code);
CREATE INDEX idx_jobs_posted ON jobs(posted_date DESC);
CREATE INDEX idx_jobs_source ON jobs(source);

CREATE TABLE scrape_reports (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  mode TEXT DEFAULT 'incremental',             -- incremental | full
  total_sources INT, successful_sources INT,
  total_jobs_found INT, total_jobs_filtered INT, new_jobs_added INT,
  report JSONB
);

CREATE TABLE email_subscriptions (
  email TEXT PRIMARY KEY,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  language TEXT DEFAULT 'en',
  confirmed BOOLEAN DEFAULT FALSE              -- double opt-in for GDPR
);

CREATE TABLE employer_postings (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  job_title TEXT NOT NULL, job_title_zh TEXT,
  company TEXT NOT NULL, location TEXT,
  field TEXT, language_level TEXT, employment_type TEXT, salary_range TEXT,
  description TEXT, description_zh TEXT,
  requirements TEXT, application_url TEXT,
  remote_friendly BOOLEAN DEFAULT FALSE,
  visa_sponsorship BOOLEAN DEFAULT FALSE,
  tier TEXT DEFAULT 'free', payment_status TEXT DEFAULT 'unpaid',
  stripe_session_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT DEFAULT 'employer' CHECK (role IN ('employer','admin','candidate')),
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Phase 5 additions: candidate_profiles, saved_filters, saved_jobs, applications (defined at Sprint 3 kickoff)

-- RLS: enable on all; service role (server routes only) bypasses;
-- employer_postings: SELECT/INSERT own rows; jobs: public SELECT via anon key read policy.
```

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | LCP <2.5s p75 on /jobs; jobs list server-paginated (default 20); images lazy |
| i18n | All three locales complete for every user-facing string; CI test fails on missing keys; date formats localized |
| Security | Service-role key never shipped to client; all admin mutations behind auth; zod validation on every API input; secrets only in env vars; dependency audit in CI |
| Privacy/GDPR | Double opt-in newsletter; privacy policy page (EN/ZH/DE); cookieless analytics; data-deletion request path (email → admin action) documented |
| Reliability | Scraper failures never crash the site (jobs page serves last-good data); DB connection via pooled (port 6543 / pgBouncer) for serverless |
| Compliance | No scraping of sources whose ToS forbid it (E6-FR4 governs); fabricated sample jobs removed or clearly watermarked "Demo" before public launch (F10) |
| Maintainability | All schema in versioned migrations; docs (README/AGENTS.md) updated with every milestone |

---

## 9. Dependencies & Integrations

| Service | Used for | Plan/tier |
|---|---|---|
| Supabase | Postgres, Auth, Storage | Free → Pro when >500MB or RLS-heavy traffic |
| Vercel | Hosting, cron | User-managed（`git push` → Vercel 自动部署）；**Chromium 函数若超 250MB 需 Pro plan（用户决策）** |
| Resend | Transactional email | Free tier (3k emails/mo) initially |
| Stripe | Premium postings | Test mode first; live needs business entity details |
| Plausible | Analytics | ~€9/mo or self-host later |
| ScrapingBee/ScraperAPI (optional) | Blocked sources fallback | Only after FR-E3-3 matrix shows need |
| GitHub | Repo + Actions CI | Private repo, free |

### 9.1 Local Design & Media Production Stack（已装于本机，零 SaaS 成本）

按工作类型固定分工，所有 UI 设计与视觉资产生产走本地工具：

| 工具 | 负责范围 | 在工作流中的位置 |
|---|---|---|
| **Open Design.app** | 全部 UI 设计类工作：页面原型、布局探索、设计 token、组件视觉方向 | Plan 之后插入 **Design 阶段**：Hermes 写屏幕设计简报 → Open Design.app 生成 HTML/CSS 原型 → 评审确认 → 提取 token → Codex 按原型实现真实组件。调用细节见技能 `open-design` |
| **Hyperframes** | 图片与视频类工作（分镜帧、动效视频资产） | 产品演示视频、功能解说动画、营销片段 |
| **ComfyUI** | 扩散模型图像生成管线（见技能 `comfyui`） | 博客/SEO 内容配图、OG/社交卡片图、品牌资产变体 |

规则：
- 设计产物（原型 HTML、token）保存到 `docs/prototypes/`；**原型不替代代码实现** —— 实现仍由 Codex 完成。
- 媒体资产输出到 `public/media/`，与所属功能一起提交。
- 这些工具只作用于 Design 步骤，不改变 Build → Verify → Review 主链路。

User-side actions required (agent cannot do): Supabase project creation (or provide PAT for Management API automation), Vercel account linking, Resend domain, Stripe account, WeChat registration.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Puppeteer+Chromium exceeds Vercel function limit | Medium | High (jsRendered sources dead) | Measure early (FR-E3-4); fallback = managed scraping API for those 5 sources |
| LinkedIn/Indeed anti-bot yields ~0 jobs regardless | High | Medium | Accept partial coverage; prioritize RSS/API-friendly sources; document honest expectations in scraper-health.md |
| Legal exposure from fabricated sample jobs (F10) | Medium | High | Watermark "Demo" pre-launch; replace progressively with approved postings |
| GDPR misstep on newsletter/analytics | Medium | High | Double opt-in + cookieless analytics from day 1 (FR-E2-7, FR-E8-1) |
| Vercel cron quirks (timezone, overlap) | Low | Low | Two distinct routes; watchdog alerts |
| Single-developer bottleneck (all coding via agent workflow) | Medium | Medium | Strict 3-role workflow; small reversible commits; CI gates |
| WeChat track stalls on license/ICP | High | Low (strategic bet) | Run as parallel documentation track; no engineering blocked |

---

## 11. Milestones

| Milestone | Scope | Exit condition |
|---|---|---|
| **M0 — Foundations** (~2 days) | E1 complete | Git + GitHub + CI scaffold green; typecheck/lint/test/build all runnable |
| **M1 — Data + Launch** (weeks 1–2) | E2 + E3 | Site live on Vercel, Supabase-backed, daily scrape producing jobs, scraper-health matrix committed |
| **M2 — Employers & Money** (weeks 3–4) | E4 | Employer can register → post → admin approves → Stripe test purchase elevates posting |
| **M3 — Candidates** (weeks 5–6) | E5 | Accounts, saved jobs, weekly digest email delivered |
| **M4 — Growth Hardening** (weeks 7–8) | E6 + E7 + E8 | SEO validated in Search Console; watchdog alerting live; fallback scraping chain for ≥1 blocked source |
| **M5 — WeChat Track** (parallel, decision-gated) | E9 | Go/no-go memo; if go, DevTools prototype |

Public-launch gate: M1 done + F10 remediated + privacy policy live + admin route protected.

---

## 12. Open Questions

1. Final brand/domain? ("sinotechjobs" placeholder everywhere)
2. Does the founder have/want a German business entity for Stripe live mode? (blocks real payments, not test mode)
3. Supabase: create project manually, or provide Personal Access Token (`sbp_…`) for Management API automation?
4. Sample jobs: watermark as demo, or strip before launch?
5. WeChat: individual developer account acceptable for v1, or wait for business license?

---

## Appendix A — Execution Protocol (binding)

All engineering work follows the strict 3-role workflow (`skill_view(name='3-role-workflow')`, stored in Mnemory):
1. **Plan** — Hermes decomposes task, writes dispatch prompt with exact files + verification commands
2. **Design**（仅 UI 类任务）— Open Design.app 生成 HTML/CSS 原型 → Hermes 评审 → 提取设计 token；媒体资产按需经 ComfyUI / Hyperframes 本地生成（见 §9.1）。原型存 `docs/prototypes/`，实现仍归 Codex
3. **Build** — Codex CLI implements (`codex exec --sandbox workspace-write`; probe with `echo hello` first)
4. **Verify** — Hermes runs `npm run typecheck && npm run lint && npm test && npm run build` + targeted curls
5. **Review** — Claude Code reviews changed files (sonnet, read-only)
6. **Fix** — Codex addresses confirmed findings; loop until clean
7. **Report + commit** per task

Tool failure ⇒ STOP and ask the user. Never improvise direct source edits.
