# Build Report — SinotechJobs

> Template for production build size & Puppeteer bundle measurement.
> Fill values after running `scripts/measure-build.sh` or `vercel build`.
> Last updated: 2026-08-27

## Build size

| Metric | Size | Notes |
|--------|------|-------|
| `.next` total | _TBD_ | `du -sh .next` |
| `.next/static` (client JS/CSS) | _TBD_ | `du -sh .next/static` |
| `.next/server` (SSR/server) | _TBD_ | `du -sh .next/server` |
| First Load JS (shared) | _TBD_ | From `next build` output — "First Load JS shared by all" |
| Largest route (total) | _TBD_ | From `next build` route table |
| `npm run build` time | _TBD_ | Wall time |

### How to reproduce

```bash
./scripts/measure-build.sh
# or manually:
npm run build 2>&1 | tail -20
du -sh .next .next/static .next/server
```

Include the last 20 lines of `next build` output here:

```
# paste `npm run build 2>&1 | tail -20` output
```

## Puppeteer impact

| Metric | Size | Notes |
|--------|------|-------|
| `node_modules/puppeteer` | ~112K (wrapper) + browser download if cached | Thin wrapper; real browser is external |
| `node_modules/@sparticuz/chromium` | ~66M (compressed) / ~130M unpacked | Serverless-compatible Chromium binary |
| Puppeteer sources enabled | 5 / 13 | `Indeed`, `LinkedIn`, `XING`, `Bosch`, `Huawei` set `jsRendered: true` |
| Vercel function size (`.vercel/output`) | _TBD_ | `du -sh .vercel/output` after `vercel build` |
| Vercel limit (Hobby) | 250 MB (uncompressed) per function | Pro: 250 MB+ configurable |
| Vercel limit (Pro) | 250 MB default, larger with config | Check dashboard → Functions |

### Detail

- `puppeteer` itself (~112K on disk in this repo) is a lightweight launcher; the heavy part is the Chromium binary provided by `@sparticuz/chromium` (~66M in `node_modules`, expands on deploy).
- Only 5 of 13 scraper sources use Puppeteer (`jsRendered: true`). The remaining 8 use `fetch` + `cheerio` (RSS/HTML/JSON-API) and do not load Chromium.
- `@sparticuz/chromium` is optimized for AWS Lambda / Vercel (stripped, compressed, Brotli-packed tar). It unpacks at runtime via `chromium.executablePath()`.
- Next.js config (`next.config.ts`) marks both packages as external via `experimental.serverComponentsExternalPackages` (and stable `serverExternalPackages`) so they are not bundled into the Edge/serverless trace unnecessarily — they are required at runtime only inside `/api/scrape` and `scripts/scrape.ts`.

### How to reproduce

```bash
du -sh node_modules/puppeteer node_modules/@sparticuz/chromium
grep -c "jsRendered: true" src/lib/scraper/sources.ts
# Vercel estimate (requires vercel CLI):
vercel build 2>&1 | tail -30
du -sh .vercel/output 2>&1 | head -5
```

## Recommendations

1. **Keep Puppeteer scoped to 5 sources** — do not enable `jsRendered: true` globally. Add new JS-rendered sources only after verifying `waitForSelector` is stable and the site truly requires headless rendering. Prefer `rss`/`json-api`/`html` + `fetch` where possible (faster, smaller, fewer flakes).

2. **Use `@sparticuz/chromium` on Vercel/Lambda, local Chrome locally** — `src/lib/scraper/puppeteer.ts` already auto-detects `process.env.VERCEL` / `AWS_LAMBDA_FUNCTION_NAME` and switches `executablePath` / `args`. Do not bundle a second Chromium.

3. **Keep serverless function size < 50 MB compressed where feasible** — `@sparticuz/chromium` ~50–66M compressed is the dominant contributor. The app's own JS (`.next/static` + `.next/server`) should stay < 10 MB. If function approaches the 250 MB Hobby limit, consider:
   - Moving Puppeteer scraping to a dedicated function/route (`/api/cron/daily`) with `maxDuration` and external package config only on that route.
   - Offloading heavy scraping to an external service (ScrapingBee / ScraperAPI / Apify) behind a `scrapingApi: true` flag (see Roadmap Package D).
   - Enabling `outputFileTracing: true` (already set) so Vercel traces only used files.

4. **Do not add `next-bundle-analyzer` to production deps** — use it ad-hoc: `ANALYZE=true npm run build` with a local install, or inspect `next build` route table and `.next/analyze` output. The config in `next.config.ts` includes a commented example for this.

5. **Monitor per-source cost** — log `waitForSelector` timeout rate and average render time (see `src/lib/scraper/engine.ts` routing: `[JS+Puppeteer]` tag in CLI). If LinkedIn/Indeed behind Cloudflare/PerimeterX cause frequent timeouts, prefer the scraping API fallback chain: `scraping API → Puppeteer → fetch`.

6. **Cache & dedupe** — storage (`data/scraped-jobs.json` → later Supabase) deduplicates by URL; keep `max 500 jobs` cap to bound DB/storage growth. Cron: daily at 06:00 UTC (`/api/cron/daily`) is sufficient; `mode=full` weekly can re-scrape disabled sources.

7. **CI guardrail** — optionally add a CI step: `du -sh .next | awk '{print $1}'` + threshold check (e.g., `.next` < 100M, function < 200M) to catch accidental large deps.

---

### Appendix: Raw outputs (paste after measurement)

#### `npm run build | tail -20`

```
```

#### `du -sh` snapshots

```
# du -sh .next
# du -sh node_modules/puppeteer
# du -sh node_modules/@sparticuz/chromium
# du -sh .vercel/output  (if available)
```

#### `next.config.ts` excerpt

```ts
// outputFileTracing: true
// serverExternalPackages: ["puppeteer", "@sparticuz/chromium"]
// experimental.serverComponentsExternalPackages: ["puppeteer", "@sparticuz/chromium"]
// bundle analyzer comment present (no dep added)
```
