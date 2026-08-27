# Sources Compliance — SinotechJobs Scraping Legal & ToS Review

> **Date:** 2026-08-28 | **Scope:** 13 configured sources (StepStone RSS, Indeed, LinkedIn, XING, Bosch, SAP, Huawei, DFKI, Fraunhofer, RemoteOK, DroneJobs, MachineLearningJobs, Make-it-in-Germany)
> **Status:** Advisory — not legal advice. Review covers publicly observable ToS as of 2026-08; operator must re-check before enabling a source in production. In doubt, prefer RSS / official API over HTML scraping.

## 1. Summary Verdict

| Verdict | Meaning | Action |
|---------|---------|--------|
| **keep** | ToS permits crawling with attribution / RSS provided | Keep enabled, respect crawl-delay |
| **fallback** | HTML scraping technically works but ToS discourages; use managed API or RSS where available | Enable only behind `scrapingApi` flag + throttle |
| **disable** | ToS explicitly forbids scraping; high anti-bot; legal/reputational risk | Disable by default, consider manual partnership |
| **rss-only** | Source offers RSS — use RSS, never HTML | Configure as `type: rss` only |

## 2. Per-Source Matrix

| # | Source | id | Type | ToS Stance (observed) | Our Mode (code) | Verdict | Notes |
|---|--------|----|------|------------------------|-----------------|---------|-------|
| 1 | **StepStone** | `stepstone-rss` | RSS | RSS is public feed intended for syndication; HTML ToS restricts scraping. | `rss` | **keep (rss-only)** | Use RSS URL only. Do not add HTML selector for StepStone. Respect `ttl`. |
| 2 | **Indeed DE (Chinese)** | `indeed-chinese-de` | HTML (Puppeteer) | ToS forbids automated scraping; robots.txt disallows job detail scraping at scale; anti-bot (Cloudflare/PerimeterX) active. | `html` + `jsRendered` + `scrapingApi:true` | **fallback** | High anti-bot. Keep behind `scrapingApi` flag (ScrapingBee) + throttle 1 req/5s. Fallback chain: scraping-api → Puppeteer → fetch. Monitor via T5.2. |
| 3 | **LinkedIn Jobs** | `linkedin` | HTML (Puppeteer) | ToS §8.2 explicitly forbids scraping, crawling, or using automated means; LinkedIn aggressively blocks. Legal exposure high. | `html` + `jsRendered` + `scrapingApi:true` | **disable** | Default `enabled:false` recommended. If needed, use LinkedIn Official Job Search API (requires partnership) or manual curation. Current config marks `scrapingApi:true` but should remain disabled until API key + legal sign-off. |
| 4 | **XING** | `xing` | HTML (Puppeteer) | ToS prohibits automated collection beyond personal use; German platform with anti-scraping. | `html` + `jsRendered` + `scrapingApi:true` | **disable** | Same as LinkedIn — default disabled. Consider XING E-Recruiting API. |
| 5 | **Bosch Career** | `bosch` | HTML (Puppeteer) | Corporate career site; ToS generally allows browsing but not bulk harvesting; no RSS. | `html` + `jsRendered` | **fallback** | Lower anti-bot than job boards. Allow but throttle, respect robots.txt `Crawl-delay`. Consider contacting Bosch employer-branding for whitelist. |
| 6 | **SAP Career** | `sap` | HTML | Similar to Bosch; careers.sap.com. | `html` | **fallback** | Same as Bosch. SAP SuccessFactors may have XML feed — investigate `careers/sitemap.xml`. |
| 7 | **Huawei EU Career** | `huawei` | HTML (Puppeteer) | Corporate site, moderate ToS. | `html` + `jsRendered` | **fallback** | Keep with throttling. Huawei has English/Chinese postings relevant to filter. |
| 8 | **DFKI** | `dfki` | HTML | Research institute, likely permissive for public research jobs. | `html` | **keep** | Low volume, low risk. Keep direct fetch. |
| 9 | **Fraunhofer** | `fraunhofer` | HTML | Research org, similar to DFKI. | `html` | **keep** | Keep direct fetch. |
| 10 | **RemoteOK** | `remoteok-json` | JSON API | Public JSON API at `remoteok.com/api` explicitly allows programmatic access (no key, cache 1h). | `json-api` | **keep** | Ideal source. Keep enabled, cache 1h, no scrapingApi needed. |
| 11 | **DroneJobs** | `dronejobs` | HTML | Niche board, likely permissive but no official API. | `html` | **keep** | Keep direct fetch, monitor via health. |
| 12 | **MachineLearningJobs** | `mljobs` | HTML | Niche AI board. | `html` | **keep** | Keep. |
| 13 | **Make-it-in-Germany** | `make-it-in-germany` | HTML/RSS | Government portal for skilled migration; likely permissive, may have RSS. | `html` | **keep** | Check for RSS upgrade (`/rss` or `/feed`); keep. |

## 3. General Rules for Operator

1. **Respect robots.txt** — Before enabling a source, `curl https://<host>/robots.txt` and ensure the job listing path is not `Disallow: *` for our UA (`SinotechJobsBot/1.0` or Puppeteer default).
2. **Throttle** — Minimum 2s between requests per host; `scrapingApi` path already throttled by provider quota.
3. **Attribution** — Always store `source_url` and link back to original posting; never rewrite `application_url` to our domain.
4. **Fail-closed** — T5.2 auto-disables after 5 consecutive failures; treat anti-bot 403/429 as `shouldAutoDisable` true, do not brute-force.
5. **No personal data scraping** — Only job metadata (title, company, location, description, apply URL). Never collect applicant data.
6. **GDPR** — Jobs are public postings; no PII beyond company name. Newsletter double opt-in (T1.6) already GDPR.
7. **Re-review cadence** — Re-check ToS at least quarterly; update this doc and `enabled` flags.

## 4. Recommended Config Changes (post-review)

```ts
// src/lib/scraper/sources.ts — suggested defaults after review
{ id: 'linkedin', enabled: false, scrapingApi: true, ... } // disabled until partnership
{ id: 'xing', enabled: false, scrapingApi: true, ... }
{ id: 'indeed-chinese-de', enabled: true, scrapingApi: true, ... } // keep but throttled
// others: enabled: true as today
```

Enabling `scrapingApi:true` requires `SCRAPING_API_KEY` + `SCRAPING_API_PROVIDER` env (Vercel). Without key, engine falls back to Puppeteer/fetch automatically (T5.1 chain).

## 5. What This Doc Does NOT Cover

- German **UrhG** / database right — job postings are factual, low risk, but bulk reproduction may trigger ancillary rights; keep excerpt short and always link to source.
- **WeChat** track (E9) — separate legal for CN hosting/ICP; not covered here.

---

## References (spot-checked 2026-08)

- StepStone robots.txt — RSS at `/rss/` is whitelisted.
- Indeed ToS §“Automated Access” — prohibits scraping; robots.txt `Disallow: /jobs` for many UAs.
- LinkedIn User Agreement §8.2 — “Don’t scrape or copy... using automated means.”
- RemoteOK API — `https://remoteok.com/api` documented as public.
- Corporate career sites (Bosch/SAP/Huawei/DFKI/Fraunhofer) — no explicit anti-scraping clause observed, but general “no bulk harvesting” applies.

*Reviewer:* Hermes (PM) — Codex built fallback chain (T5.1), health auto-disable (T5.2); this doc is operator-facing. Update via PR when enabling/disabling a source.
