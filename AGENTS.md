# SinotechJobs — Project Handover Document

> **Last updated:** 2026-08-11
> **Project location:** `C:\Users\FBMHCA5\sinotechjobs`
> **Status:** MVP complete, ready for deployment

---

## 1. Project Overview

### Concept
A trilingual (EN/ZH/DE) job board platform connecting Chinese-speaking tech talent with employers in the DACH region (Germany, Austria, Switzerland). Focus areas: Computer Science, AI/ML, Robotics, Drones/UAV, and Remote positions where Chinese language skills are required or valued.

### Value Proposition
- **For candidates:** Centralized portal for DACH tech jobs where Chinese language is an asset — not available on StepStone, Indeed, or LinkedIn as a filterable criterion
- **For employers:** Targeted access to a niche talent pool that general job boards cannot filter for
- **Key differentiator:** Chinese-language filter + DACH tech focus + bilingual job descriptions

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + inline styles for dynamic theming |
| HTML Parsing | cheerio 1.2 |
| JS-Rendered Scraping | Puppeteer 25 + @sparticuz/chromium (serverless) |
| Storage | JSON file-based (`data/scraped-jobs.json`) — designed to be replaced by Supabase |
| Deployment | Vercel (cron jobs configured) |
| Package Manager | npm |

---

## 2. Completed Work Summary

### Phase 0–1: MVP (DONE)
- [x] Next.js 16 project scaffold with Tailwind CSS 4
- [x] Trilingual UI (EN/ZH/DE) with instant language switching (localStorage persistence)
- [x] Landing page: hero section, live stats, value props, featured jobs preview, email capture
- [x] Job board page (`/jobs`) with full filtering: field, location, language level, employment type, visa sponsorship, remote-friendly + search
- [x] Job detail pages (`/jobs/[id]`) with bilingual descriptions, requirements, tags, apply button
- [x] Employer job posting form (`/post`) with bilingual fields
- [x] 32 curated sample jobs (real DACH companies: Bosch, BMW, KUKA, SAP, DeepL, NIO, BYD, Huawei, Siemens, etc.)
- [x] Dark mode (automatic via `prefers-color-scheme`)
- [x] Fully responsive (CSS grid auto-fit layouts)

### Phase 2: Scraping Infrastructure (DONE)
- [x] Scraper architecture: `src/lib/scraper/` module with types, engine, storage, keywords, sources
- [x] 13 configurable sources: StepStone RSS, Indeed HTML, LinkedIn, XING, Bosch, SAP, Huawei, DFKI, Fraunhofer, RemoteOK JSON API, DroneJobs, MachineLearningJobs, Make-it-in-Germany
- [x] Chinese keyword matching engine: 30+ keywords with strong/weak classification (strong: "chinesisch", "mandarin", "中文"; weak: "china market", "APAC")
- [x] Auto-detection: scraped text analyzed to detect field (AI/CS/robotics/drone/remote), language level, location, employment type, and tech tags (Python, C++, ROS, PyTorch, etc.)
- [x] JSON file storage with deduplication (by URL), max 500 jobs
- [x] API routes: `POST /api/scrape` (scrape-all/scrape-one/clear), `GET /api/scrape` (sources+stats+reports), `GET /api/jobs`
- [x] Admin dashboard (`/admin`): stats, per-source scrape buttons, last result details, scrape history, clear function
- [x] CLI script (`npm run scrape --verbose`): standalone cron-compatible scraper
- [x] Scraped jobs integrated into job board with "Scraped" badge

### Phase 2.5: Puppeteer for JS-Rendered Pages (DONE)
- [x] `src/lib/scraper/puppeteer.ts`: Headless Chrome module
  - Auto-detects environment: `@sparticuz/chromium` on Vercel/Lambda, local Chrome otherwise
  - Auto-scroll for lazy-loaded content
  - `waitForSelector` per-source configurable
  - Resource interception (blocks images/media/fonts for speed)
  - Browser instance reused across sources, closed after scrape
- [x] 5 sources marked `jsRendered: true` with Puppeteer options: Indeed, LinkedIn, XING, Bosch, Huawei
- [x] Engine auto-routes: `jsRendered` → Puppeteer, otherwise → `fetch`
- [x] Admin dashboard shows `+Puppeteer` in source type
- [x] CLI shows `[JS+Puppeteer]` tag

### Vercel Cron Configuration (DONE)
- [x] `vercel.json` with 2 cron jobs:
  - Daily at 6:00 AM UTC → `/api/scrape`
  - Weekly Monday 12:00 PM UTC → `/api/scrape?mode=full`
- [x] `CRON_SECRET` env var support for authentication

---

## 3. Project Structure

```
sinotechjobs/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (LanguageProvider + Navbar + Footer)
│   │   ├── page.tsx                # Home (server) → HomeClient
│   │   ├── HomeClient.tsx          # Home page client component
│   │   ├── globals.css             # Global styles + CSS variables + dark mode
│   │   ├── jobs/
│   │   │   ├── page.tsx            # Jobs board (server) → JobsClient
│   │   │   ├── JobsClient.tsx      # Jobs board client component with filters
│   │   │   └── [id]/
│   │   │       ├── page.tsx        # Job detail (server) → JobDetailClient
│   │   │       └── JobDetailClient.tsx
│   │   ├── post/
│   │   │   └── page.tsx            # Employer job posting form
│   │   ├── admin/
│   │   │   └── page.tsx            # Scraper admin dashboard
│   │   └── api/
│   │       ├── scrape/route.ts     # Scraper API (GET: stats, POST: scrape/clear)
│   │       └── jobs/route.ts       # All jobs API (GET)
│   ├── components/
│   │   ├── LanguageProvider.tsx    # i18n context (EN/ZH/DE)
│   │   ├── Navbar.tsx              # Nav + language switcher
│   │   ├── Footer.tsx              # Footer with links
│   │   └── EmailCapture.tsx        # Newsletter signup component
│   └── lib/
│       ├── types.ts                # Core types (Job, JobField, etc.)
│       ├── jobs.ts                 # 32 curated sample jobs
│       ├── all-jobs.ts             # Combines sample + scraped jobs
│       ├── i18n.ts                 # Full translations EN/ZH/DE
│       └── scraper/
│           ├── types.ts            # Scraper types + rawToJob() + auto-detection
│           ├── sources.ts          # 13 configured sources
│           ├── engine.ts           # Core scraper (RSS/HTML/JSON API + Puppeteer routing)
│           ├── keywords.ts         # Chinese keyword matcher (30+ keywords)
│           ├── storage.ts          # JSON file storage (data/scraped-jobs.json)
│           └── puppeteer.ts         # Headless Chrome for JS-rendered pages
├── scripts/
│   └── scrape.ts                   # CLI scraper script
├── data/                           # Runtime data (auto-created)
│   ├── scraped-jobs.json           # Scraped jobs storage
│   └── scrape-reports.json         # Scrape history (last 20)
├── vercel.json                     # Vercel Cron config
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 4. How to Run

### Development
```powershell
cd C:\Users\FBMHCA5\sinotechjobs
npm install
npm run dev          # http://localhost:3000
```

### Production Build
```powershell
npm run build
npm start            # http://localhost:3000
```

### Lint & Type Check
```powershell
npm run lint
```

### Run Scraper (CLI)
```powershell
npm run scrape                                    # All enabled sources
npm run scrape:verbose                            # With per-source details
npx tsx scripts/scrape.ts --source=indeed-chinese-de  # Single source
```

### Run Scraper (API)
```powershell
# Get stats and sources
curl http://localhost:3000/api/scrape

# Scrape all enabled sources
curl -X POST http://localhost:3000/api/scrape -H "Content-Type: application/json" -d '{"action":"scrape-all"}'

# Scrape single source
curl -X POST http://localhost:3000/api/scrape -H "Content-Type: application/json" -d '{"action":"scrape-one","sourceId":"indeed-chinese-de"}'

# Clear all scraped jobs
curl -X POST http://localhost:3000/api/scrape -H "Content-Type: application/json" -d '{"action":"clear"}'
```

### Deploy to Vercel
```powershell
cd C:\Users\FBMHCA5\sinotechjobs
npx vercel          # Preview deploy
npx vercel --prod   # Production deploy
```

---

## 5. Key Configuration

### Environment Variables
| Variable | Required | Purpose |
|----------|----------|---------|
| `CRON_SECRET` | Optional | Protects `/api/scrape?mode=full` from unauthorized access |

### Adding/Editing Job Sources
Edit `src/lib/scraper/sources.ts`. Each source has:
```typescript
{
  id: "unique-id",
  name: "Display Name",
  nameZh: "中文名称",
  type: "rss" | "html" | "json-api",   // rss: parse XML, html: cheerio, json-api: JSON.parse
  url: "https://...",
  enabled: true/false,
  jsRendered: true/false,               // true = use Puppeteer (for SPA sites)
  puppeteerOptions: {                   // Only if jsRendered: true
    waitForSelector: ".css-selector",  // Wait for this element before scraping
    waitTimeout: 10000,                // ms
    scrollDelay: 2000,                 // ms for auto-scroll
    extraWaitMs: 2000,                 // Additional wait after scroll
  },
  keywords: ["chinesisch", "chinese", "mandarin"],
  selectors: {                          // Only for type: "html"
    jobCard: ".css-selector",
    title: ".css-selector",
    company: ".css-selector",
    location: ".css-selector",
    link: ".css-selector",
    description: ".css-selector",
  },
  defaultField: "ai",                  // Optional fallback field
  defaultLocationCode: "de",           // Optional fallback location
}
```

### Vercel Cron Schedule
Edit `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/scrape", "schedule": "0 6 * * *" },        // Daily 6AM UTC
    { "path": "/api/scrape?mode=full", "schedule": "0 12 * * 1" } // Weekly Monday
  ]
}
```

### Known Limitations
- **Local network blocked:** McAfee Web Gateway blocks external requests in the current development environment. Scraping will work on Vercel or any server with open internet.
- **JSON file storage:** Current storage is file-based (`data/`). This works on Vercel but is ephemeral — files don't persist across serverless function invocations. **Must migrate to a database** (Supabase recommended) for production.
- **Puppeteer on Vercel:** `@sparticuz/chromium` binary is ~50MB. Vercel Hobby plan has 250MB function size limit. Pro plan recommended for production.
- **Anti-bot detection:** Puppeteer alone won't bypass Cloudflare/PerimeterX. For production scraping of LinkedIn/Indeed, consider a scraping API service (ScrapingBee, ScraperAPI, Apify).

---

## 6. Future Work Packages

### Package A: Database Migration (HIGH PRIORITY)
**Goal:** Replace JSON file storage with Supabase (PostgreSQL) for persistent, queryable storage.

**Tasks:**
1. Create Supabase project, get URL + anon key
2. Install `@supabase/supabase-js`
3. Create schema:
   ```sql
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY,
     title TEXT, title_zh TEXT,
     company TEXT, company_zh TEXT,
     field TEXT, location TEXT, location_code TEXT,
     language_level TEXT, employment_type TEXT,
     salary_range TEXT,
     description TEXT, description_zh TEXT,
     requirements TEXT[], requirements_zh TEXT[],
     tags TEXT[],
     application_url TEXT,
     posted_date DATE,
     remote_friendly BOOLEAN,
     visa_sponsorship BOOLEAN,
     featured BOOLEAN,
     source TEXT,           -- 'sample' | 'scraped' | 'manual'
     source_id TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE TABLE scrape_reports (
     id SERIAL PRIMARY KEY,
     timestamp TIMESTAMPTZ,
     total_sources INT,
     successful_sources INT,
     total_jobs_found INT,
     total_jobs_filtered INT,
     new_jobs_added INT,
     report JSONB
   );

   CREATE TABLE email_subscriptions (
     email TEXT PRIMARY KEY,
     subscribed_at TIMESTAMPTZ DEFAULT NOW(),
     language TEXT DEFAULT 'en'
   );

   CREATE TABLE employer_postings (
     id SERIAL PRIMARY KEY,
     job_title TEXT, job_title_zh TEXT,
     company TEXT, location TEXT,
     field TEXT, language_level TEXT,
     employment_type TEXT, salary_range TEXT,
     description TEXT, description_zh TEXT,
     requirements TEXT,
     application_url TEXT,
     remote_friendly BOOLEAN,
     visa_sponsorship BOOLEAN,
     status TEXT DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
     submitted_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
4. Replace `src/lib/scraper/storage.ts` with Supabase client
5. Update `src/lib/all-jobs.ts` to query Supabase
6. Update API routes to use Supabase
7. Add env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### Package B: Employer Portal & Job Approval Workflow (MEDIUM)
**Goal:** Employers can register, post jobs, and track applications. Admin can approve/reject.

**Tasks:**
1. Employer registration/login (Supabase Auth)
2. Employer dashboard (`/employer/dashboard`) — manage their job postings
3. Job submission saves to `employer_postings` table (status: pending)
4. Admin approval page (`/admin/approvals`) — review and approve/reject
5. Email notification to employer on approval
6. Premium posting tiers: featured (€99), pinned (€199), enterprise (€499/mo)
7. Stripe payment integration for premium postings

### Package C: Candidate Features (MEDIUM)
**Goal:** Candidates can create profiles, save jobs, set up alerts.

**Tasks:**
1. Candidate registration/login (Supabase Auth)
2. Candidate profile: skills, experience, languages, preferred locations
3. Saved jobs feature (bookmark/favorite)
4. Job alert preferences: field, location, language level → email notifications
5. Resume/CV upload (Supabase Storage)
6. Application tracking (applied → screening → interview → offer)
7. Profile visibility toggle (opt-in to recruiter talent pool)

### Package D: Scraping API Integration (MEDIUM)
**Goal:** Replace self-hosted Puppeteer with managed scraping API for better reliability.

**Tasks:**
1. Sign up for ScrapingBee or ScraperAPI (get API key)
2. Add `SCRAPING_API_KEY` env var
3. Update `src/lib/scraper/engine.ts` — add `fetchViaScrapingAPI()` function
4. New source option: `scrapingApi: true` flag
5. Fallback chain: scraping API → Puppeteer → fetch
6. Proxy rotation and country targeting (DE IPs for German job boards)
7. Rate limiting and quota management

### Package E: WeChat Mini Program (HIGH for China reach)
**Goal:** Build a WeChat Mini Program to reach Chinese candidates in China.

**Tasks:**
1. Register WeChat Mini Program account (requires Chinese business license or individual developer)
2. Build Mini Program frontend (WeChat-specific framework, similar to React)
3. Backend: reuse existing Next.js API routes
4. Features: job search, job detail, save jobs, apply via WeChat
5. WeChat login (OAuth)
6. WeChat push notifications for new jobs
7. WeChat Pay for premium features

### Package F: Content & SEO (MEDIUM)
**Goal:** Drive organic traffic via SEO and content marketing.

**Tasks:**
1. Blog section (`/blog`) with articles:
   - "DACH Tech Industry Guide for Chinese Professionals"
   - "Visa & Work Permit Guide: Germany Blue Card"
   - "Salary Benchmarks: AI/Robotics in Germany 2026"
   - "German Workplace Culture for Chinese Engineers"
2. SEO optimization: meta tags, structured data (JobPosting schema), sitemap.xml
3. Company profiles (`/companies/[slug]`) — employer branding pages
4. Salary benchmark tool (anonymized data)
5. Interview prep guides
6. DACH relocation guide

### Package G: Analytics & Monitoring (LOW)
**Goal:** Track platform metrics and user behavior.

**Tasks:**
1. Google Analytics 4 or Plausible Analytics (privacy-friendly)
2. Track key metrics: job views, applications, search queries, filter usage
3. Admin analytics dashboard: job posting trends, source effectiveness, conversion rates
4. Scrape monitoring: success rate, jobs found per source, error tracking
5. Email open/click tracking for newsletter
6. Alert system: notify admin if scrape fails 3x in a row

---

## 7. Development Roadmap

### Sprint 1 (Weeks 1–2): Database Migration
- Set up Supabase
- Migrate storage from JSON to PostgreSQL
- Update all API routes
- Deploy to Vercel with env vars
- Test scraping on Vercel (verify Puppeteer works serverless)

### Sprint 2 (Weeks 3–4): Employer Portal
- Employer auth (Supabase Auth)
- Job posting form → database (with approval workflow)
- Admin approval page
- Email notifications (Resend or SendGrid)
- Premium posting tiers + Stripe integration

### Sprint 3 (Weeks 5–6): Candidate Features
- Candidate auth
- Job save/bookmark
- Job alert email preferences
- Profile page
- Application tracking

### Sprint 4 (Weeks 7–8): Scraping Enhancement
- Integrate ScrapingBee/ScraperAPI for blocked sites
- Add 10+ new sources (German company career pages)
- Scrape detail pages (not just listings) for full descriptions
- Scheduled scrape verification on Vercel Cron

### Sprint 5 (Weeks 9–10): Content & SEO
- Blog section with CMS (Sanity or Contentlayer)
- SEO: sitemap, structured data, meta tags
- Company profile pages
- DACH visa/relocation guide content

### Sprint 6 (Weeks 11–12): WeChat Mini Program
- WeChat Mini Program frontend
- Integrate with existing API
- WeChat login + push notifications
- Launch on WeChat platform

### Sprint 7+ (Ongoing): Growth
- Analytics dashboard
- A/B testing
- Community features (Chinese tech professionals in DACH)
- Virtual job fairs
- Partnership with DACH tech hubs (UnternehmerTUM, Cyber Valley)

---

## 8. Business Model

### Revenue Streams

| Stream | Description | Pricing | Phase |
|--------|-------------|---------|-------|
| **Job posting fees** | Free tier (basic, 30 days) + Premium (highlighted, 90 days) + Enterprise (unlimited) | Free / €99 / €499/mo | Phase 2 |
| **Recruitment placement** | Full-cycle headhunting for hard-to-fill bilingual tech roles | €5,000–€15,000 per placement | Phase 3 |
| **Employer branding** | Sponsored company profiles, video interviews in Chinese | €299–€999/mo | Phase 3 |
| **Talent pool subscription** | Recruiters pay for access to opt-in verified candidate profiles | €199/mo | Phase 3 |
| **WeChat advertising** | Sponsored posts in WeChat ecosystem reaching Chinese professionals | €99–€499/post | Phase 4 |
| **Premium content / courses** | "How to apply in DACH" courses, German tech vocab, interview prep | €29–€99/course | Phase 4 |
| **Career fair events** | Virtual or in-person DACH-China tech job fairs | €500–€5,000/booth | Phase 4 |

### Cost Structure (Monthly)

| Item | Phase 1 (MVP) | Phase 3 (Growth) |
|------|---------------|------------------|
| Hosting (Vercel) | €0 (Hobby) | €20 (Pro) |
| Database (Supabase) | €0 (Free) | €25 (Pro) |
| Domain + Email | €5 | €20 |
| Scraping API (ScrapingBee) | €0 | €49 |
| Email service (Resend) | €0 | €20 |
| Marketing (SEO, WeChat, LinkedIn) | €50 | €500–1,000 |
| Part-time content/community manager | €0 | €1,000–2,000 |
| **Total** | **~€55** | **~€1,600–3,100** |

### Key Metrics to Track

1. **Job postings/month** (supply side health)
2. **Registered candidates** (demand side growth)
3. **Application conversion rate** (platform effectiveness)
4. **Time-to-fill** (for recruitment service)
5. **WeChat followers / newsletter subscribers** (audience reach)
6. **Employer repeat rate** (revenue stickiness)
7. **Scrape success rate** (data freshness)
8. **Organic traffic** (SEO effectiveness)

### Go-to-Market Strategy

**Target Candidates:**
- Chinese students graduating from DACH universities (CS, AI, robotics)
- Chinese professionals already in DACH seeking better positions
- Chinese professionals in China wanting to relocate (need visa sponsorship)

**Target Employers:**
- Automotive: VW, BMW, Bosch, Continental, ZF (huge China market)
- Robotics/Automation: KUKA, Festo, Pilz, Beckhoff
- Drones: Wingcopter, Quantum-Systems, Dronetech
- AI/Tech: SAP, Celonis, DeepL, Hugging Face Berlin
- Chinese companies in DACH: Huawei Europe, BYD Europe, NIO Munich, DJI, Xiaomi DE
- Research: Fraunhofer, Max Planck, DFKI, ETH Zurich

**Acquisition Channels:**
1. WeChat Official Account + Mini Program — primary Chinese audience channel
2. Xiaohongshu (小红书) — Chinese professionals sharing DACH work experiences
3. LinkedIn — targeting Chinese professionals in DACH
4. University Chinese student associations (TU9 universities)
5. Zhihu / V2EX — Chinese tech communities
6. SEO — German + Chinese keywords

### Target Employers (Outreach List for Phase 2)
- **Automotive:** VW, BMW, Bosch, Continental, ZF, Mercedes-Benz
- **Robotics:** KUKA, Festo, Pilz, Beckhoff, ABB
- **Drones:** Wingcopter, Quantum-Systems, Atlas Dynamics, FlyNow, Dronetech
- **AI/Tech:** SAP, Celonis, DeepL, Hugging Face, GitLab
- **Chinese in DACH:** Huawei, BYD, NIO, DJI, Xiaomi
- **Research:** DFKI, Fraunhofer, Max Planck, ETH Zurich

---

## 9. Technical Notes for Continuing Agent

### Architecture Decisions
- **Server/Client split:** Pages that need `fs` (file storage) are server components. Interactive pages (filters, forms) are client components. Pattern: `page.tsx` (server) → `*Client.tsx` (client).
- **Language context:** `LanguageProvider` wraps the entire app. Use `useLang()` hook to access `lang`, `setLang()`, and `t` (translations).
- **Job data flow:** `sampleJobs` (static, `src/lib/jobs.ts`) + `scrapedJobs` (dynamic, `data/scraped-jobs.json`) → `getAllJobs()` in `src/lib/all-jobs.ts`
- **Scraper routing:** Engine checks `source.jsRendered` → if true, uses Puppeteer (`renderPage()`); otherwise uses `fetch()` (via `fetchWithRetry()`)

### Adding a New Job Source
1. Add entry to `src/lib/scraper/sources.ts` with unique `id`
2. Set `type`: `"rss"` (XML), `"html"` (cheerio selectors), or `"json-api"` (JSON response)
3. If site is JS-rendered (SPA), set `jsRendered: true` + `puppeteerOptions.waitForSelector`
4. Add CSS selectors for HTML sources
5. Set `enabled: true` to activate
6. Test: `npx tsx scripts/scrape.ts --source=your-source-id --verbose`

### Adding a New Page
1. Create `src/app/[route]/page.tsx`
2. If it needs server-side data (fs, DB): make it a server component, pass data to a `*Client.tsx` component
3. If it's interactive (forms, filters): use `"use client"` directive
4. Wrap content in the existing layout (Navbar + Footer are in root layout)
5. Use `useLang()` for translations — add new keys to all 3 languages in `src/lib/i18n.ts`

### Current i18n Keys
All translation strings are in `src/lib/i18n.ts` under `translations.en`, `translations.zh`, `translations.de`. Structure:
- `nav.*` — navigation items
- `hero.*` — landing page hero section
- `valueProps.*` — value proposition cards
- `emailCapture.*` — newsletter signup
- `jobs.*` — job board (filters, labels, badges)
- `post.*` — employer posting form
- `footer.*` — footer content

### Testing
- No test framework configured yet. Manual testing via `npm run dev` + browser.
- Lint: `npm run lint`
- Build: `npm run build` (includes TypeScript type checking)
- API test: Use the admin dashboard at `/admin` or curl commands above

### Deployment Checklist
- [ ] Set `CRON_SECRET` env var in Vercel
- [ ] Set `SUPABASE_URL` + `SUPABASE_ANON_KEY` after database migration
- [ ] Set `PUPPETEER_SKIP_DOWNLOAD=false` (let Vercel download Chrome or use @sparticuz/chromium)
- [ ] Verify Vercel Cron jobs registered (Vercel Dashboard → Settings → Cron Jobs)
- [ ] Test `/api/scrape?mode=daily` endpoint after deploy
- [ ] Verify `data/` directory is writable (or migrate to Supabase first)

---

## 10. Contact & Context

- **Project owner:** User (FBMHCA5)
- **Original concept date:** 2026-08-11
- **MVP completion:** 2026-08-11
- **Tech lead:** GLM (via opencode)
- **Environment:** Windows 11, PowerShell 5.1, Node 24, npm 11
- **Local network:** McAfee Web Gateway blocks external requests — scraping tests fail locally but work on Vercel
