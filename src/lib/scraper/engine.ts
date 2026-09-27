import * as cheerio from "cheerio";
import type { ScraperSource, ScrapedJobRaw, ScrapeResult, FetchMode } from "./types";
import { matchChineseKeywords } from "./keywords";
import { renderPage, closeBrowser } from "./puppeteer";
import { shouldAutoDisable } from "./health";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Abort-aware sleep. Without the signal an aborted run still has to sit out
// the full inter-source pause (and every retry backoff) before the caller can
// unwind, which eats into the remaining cron budget for no reason.
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Caller cancellation (cron timeout) and the per-request timeout must both
// abort the fetch, otherwise a hung request outlives the scrape budget.
function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, signal]);
}

async function fetchWithRetry(
  url: string,
  retries = 2,
  requestOptions?: ScraperSource["requestOptions"],
  signal?: AbortSignal
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Cancelled mid-run: stop immediately instead of burning the retry budget.
    if (signal?.aborted) return null;
    try {
      const headers: Record<string, string> = {
        "User-Agent": getRandomUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,de;q=0.8,zh-CN;q=0.7,zh;q=0.6",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        ...requestOptions?.headers,
      };

      const response = await fetch(url, {
        headers,
        method: (requestOptions?.method as string) ?? "GET",
        body: requestOptions?.body,
        signal: combineSignals(15000, signal),
      });

      if (!response.ok) {
        if (attempt < retries) {
          await delay(2000 * (attempt + 1), signal);
          continue;
        }
        return null;
      }

      return await response.text();
    } catch {
      if (signal?.aborted) return null;
      if (attempt < retries) {
        await delay(2000 * (attempt + 1), signal);
        continue;
      }
      return null;
    }
  }
  return null;
}

// Managed scraping proxies bill per request, so a 200 that actually carries an
// anti-bot challenge page burns credit without yielding any jobs. Reject such
// payloads so the caller can fall through to its next fallback mode.
export const MIN_PLAUSIBLE_HTML_CHARS = 500;
const HTML_PAYLOAD_MARKERS = ["<html", "<!doctype", "<body", "<div", "<span", "<a ", "<rss", "<?xml"];
const JSON_PAYLOAD_PREFIXES = ["{", "["];

function isPlausibleScrapingApiPayload(body: string, sourceType?: ScraperSource["type"]): boolean {
  // JSON endpoints legitimately return small payloads, so a length floor would
  // reject valid responses. `parseJSONAPI` needs JSON anyway, so anything that
  // is not a JSON container is a challenge page for these sources.
  if (sourceType === "json-api" || sourceType === "api") {
    const head = body.trimStart().slice(0, 2000);
    return JSON_PAYLOAD_PREFIXES.some((prefix) => head.startsWith(prefix));
  }
  if (body.length < MIN_PLAUSIBLE_HTML_CHARS) return false;
  const head = body.slice(0, 2000).toLowerCase();
  return HTML_PAYLOAD_MARKERS.some((marker) => head.includes(marker));
}

export async function fetchViaScrapingAPI(
  url: string,
  sourceType?: ScraperSource["type"],
  signal?: AbortSignal
): Promise<string | null> {
  const key = process.env.SCRAPING_API_KEY;
  const provider = (process.env.SCRAPING_API_PROVIDER || "scrapingbee").toLowerCase();
  if (!key) throw new Error("SCRAPING_API_KEY missing");
  if (provider === "scrapingbee") {
    const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&country_code=de`;
    const res = await fetch(apiUrl, { signal: combineSignals(30000, signal) });
    if (!res.ok) throw new Error(`ScrapingBee ${res.status}`);
    const body = await res.text();
    return isPlausibleScrapingApiPayload(body, sourceType) ? body : null;
  }
  if (provider === "scraperapi") {
    const apiUrl = `https://api.scraperapi.com?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, { signal: combineSignals(30000, signal) });
    if (!res.ok) throw new Error(`ScraperAPI ${res.status}`);
    const body = await res.text();
    return isPlausibleScrapingApiPayload(body, sourceType) ? body : null;
  }
  throw new Error(`Unknown provider ${provider}`);
}

export async function scrapeSource(source: ScraperSource, signal?: AbortSignal): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // Special handling: Google Jobs via searchapi.io (engine=google_jobs with fallback engine=google)
  if (source.id === "google-jobs-searchapi") {
    const apiKey = process.env.SEARCHAPI_KEY || process.env.SEARCH_API_KEY;
    if (!apiKey) {
      errors.push("SEARCHAPI_KEY / SEARCH_API_KEY missing — set SEARCHAPI_KEY env var for searchapi.io");
      return {
        source,
        jobsFound: 0,
        jobsFiltered: 0,
        jobs: [],
        errors,
        duration: Date.now() - startTime,
        fetchMode: "direct",
      };
    }

    const queries = [
      "Chinese speaking jobs Germany",
      "Mandarin jobs Germany",
      "Chinese language jobs Germany",
      "China business jobs Germany",
    ];

    const fetchMode: FetchMode = "direct";
    let lastError: string | null = null;
    let cancelled = false;
    const seenUrls = new Set<string>();
    const jobs: ScrapedJobRaw[] = [];

    const buildUrl = (engine: string, query: string) =>
      `https://www.searchapi.io/api/v1/search?engine=${encodeURIComponent(engine)}&q=${encodeURIComponent(query)}&location=${encodeURIComponent("Germany")}&hl=en&gl=de&api_key=${encodeURIComponent(apiKey)}`;

    const tryFetch = async (engine: string, query: string): Promise<string | null> => {
      const url = buildUrl(engine, query);
      try {
        const res = await fetch(url, { signal: combineSignals(15000, signal) });
        const text = await res.text();
        if (!res.ok) {
          lastError = `SearchAPI ${engine} HTTP ${res.status}: ${text.slice(0, 500)}`;
          return null;
        }
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) {
            const errMsg = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
            lastError = `SearchAPI ${engine} error: ${errMsg}`;
            return null;
          }
        } catch {
          // ignore JSON parse check, keep text
        }
        return text;
      } catch (e) {
        lastError = `SearchAPI ${engine} fetch failed: ${e instanceof Error ? e.message : String(e)}`;
        return null;
      }
    };

    for (const query of queries) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      let rawJson: string | null = null;
      rawJson = await tryFetch("google_jobs", query);
      if (!rawJson) {
        console.warn(`[scraper] google-jobs-searchapi query="${query}" engine=google_jobs failed (${lastError}), trying fallback engine=google`);
        const fallback = await tryFetch("google", query);
        if (fallback) rawJson = fallback;
      }

      if (!rawJson) {
        if (lastError) errors.push(`[${query}] ${lastError}`);
        console.log(`[scraper] google-jobs query=${query} jobsFound=0`);
        continue;
      }

      const jobsForQuery: ScrapedJobRaw[] = [];
      try {
        const data = JSON.parse(rawJson);
        const list: unknown[] = Array.isArray((data as Record<string, unknown>).jobs_results)
          ? ((data as Record<string, unknown>).jobs_results as unknown[])
          : Array.isArray((data as Record<string, unknown>).jobs)
            ? ((data as Record<string, unknown>).jobs as unknown[])
            : Array.isArray((data as Record<string, unknown>).results)
              ? ((data as Record<string, unknown>).results as unknown[])
              : Array.isArray((data as Record<string, unknown>).organic_results)
                ? ((data as Record<string, unknown>).organic_results as unknown[])
                : [];

        for (const item of list) {
          if (typeof item !== "object" || item === null) continue;
          const rec = item as Record<string, unknown>;
          const title = (rec.title as string) || (rec.job_title as string) || (rec.position as string) || "";
          const company =
            (rec.company_name as string) ||
            (rec.company as string) ||
            (rec.via as string) ||
            (rec.source as string) ||
            "";
          const location =
            (rec.location as string) ||
            (rec.city as string) ||
            (rec.place as string) ||
            "Germany";
          let url = "";
          if (typeof rec.share_link === "string" && rec.share_link) url = rec.share_link;
          else if (typeof rec.link === "string" && rec.link) url = rec.link;
          else if (typeof rec.job_link === "string" && rec.job_link) url = rec.job_link;
          else if (typeof rec.url === "string" && rec.url) url = rec.url;
          else if (Array.isArray(rec.apply_options) && rec.apply_options.length > 0) {
            const first = rec.apply_options[0] as Record<string, unknown>;
            if (typeof first?.link === "string") url = first.link as string;
          }
          if (!url) url = source.url;

          const descriptionRaw =
            (rec.description as string) ||
            (rec.snippet as string) ||
            (rec.summary as string) ||
            "";

          let extText = "";
          if (Array.isArray(rec.extensions)) extText = (rec.extensions as string[]).join(" ");
          else if (rec.detected_extensions && typeof rec.detected_extensions === "object") {
            const de = rec.detected_extensions as Record<string, unknown>;
            extText = Object.values(de)
              .filter((v) => typeof v === "string")
              .join(" ");
          }

          const description = String(descriptionRaw || extText).substring(0, 2000);

          let postedDateRaw = "";
          if (typeof rec.posted_at === "string") postedDateRaw = rec.posted_at as string;
          else if (typeof rec.date === "string") postedDateRaw = rec.date as string;
          else if (typeof rec.created_at === "string") postedDateRaw = rec.created_at as string;
          else {
            const de2 = rec.detected_extensions as Record<string, unknown> | undefined;
            if (de2 && typeof de2.posted_at === "string") postedDateRaw = de2.posted_at as string;
          }

          if (title && url) {
            jobsForQuery.push({
              title: String(title).trim(),
              company: String(company).trim() || extractCompanyFromSource(source),
              location: String(location).trim() || "Germany",
              url: String(url).trim(),
              description: String(description).trim().substring(0, 2000),
              postedDate: parseDate(String(postedDateRaw || "")),
              sourceId: source.id,
              sourceName: source.name,
            });
          }
        }
      } catch (e) {
        errors.push(`[${query}] Failed to parse SearchAPI response: ${e instanceof Error ? e.message : String(e)}`);
        console.log(`[scraper] google-jobs query=${query} jobsFound=0`);
        continue;
      }

      console.log(`[scraper] google-jobs query=${query} jobsFound=${jobsForQuery.length}`);

      for (const j of jobsForQuery) {
        const key = (j.url || "").trim();
        const altKey = (j as unknown as Record<string, unknown>).applicationUrl as string | undefined;
        const dedupKey = key || (altKey ? String(altKey).trim() : "");
        if (!dedupKey) continue;
        if (seenUrls.has(dedupKey)) continue;
        seenUrls.add(dedupKey);
        if (altKey && altKey !== dedupKey) seenUrls.add(String(altKey).trim());
        jobs.push(j);
      }
    }

    if (jobs.length === 0 && errors.length === 0) {
      if (!cancelled) {
        errors.push("Failed to fetch from SearchAPI (all queries, both engines)");
      }
    }

    const filtered = jobs.filter((job) => {
      const fullText = `${job.title} ${job.company} ${job.location} ${job.description ?? ""}`;
      return matchChineseKeywords(fullText).matched;
    });

    console.log(`[scraper] ${source.id} fetchMode=${fetchMode} jobsFound=${jobs.length} jobsFiltered=${filtered.length}`);

    return {
      source,
      jobsFound: jobs.length,
      jobsFiltered: filtered.length,
      jobs: filtered,
      // A cancelled run reports no errors: it says nothing about the source's
      // health, and an "aborted" error would count it as failed downstream.
      errors: cancelled ? [] : errors,
      duration: Date.now() - startTime,
      fetchMode,
      ...(cancelled ? { cancelled: true } : {}),
    };
  }

  const { html, fetchMode, cancelled } = await fetchWithFallback(source, errors, signal);

  // Cancellation is not an outcome of the source: return an empty, error-free
  // result flagged as cancelled so no downstream failure accounting (report
  // stats, shouldAutoDisable) treats it as a broken source.
  if (cancelled) {
    return {
      source,
      jobsFound: 0,
      jobsFiltered: 0,
      jobs: [],
      errors: [],
      duration: Date.now() - startTime,
      fetchMode,
      cancelled: true,
    };
  }

  // Ensure fetchMode logging for direct when html came from scraping-api/puppeteer? Already handled.
  // If html still null, fetchMode remains undefined.

  const jobs: ScrapedJobRaw[] = [];
  if (html) {
    try {
      if (source.type === "rss") {
        jobs.push(...parseRSS(html, source));
      } else if (source.type === "html") {
        jobs.push(...parseHTML(html, source, errors));
      } else if (source.type === "json-api" || source.type === "api") {
        jobs.push(...parseJSONAPI(html, source, errors));
      }
    } catch (err) {
      errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    if (errors.length === 0) errors.push(`Failed to fetch content for ${source.id}`);
  }

  const filtered = jobs.filter((job) => {
    const fullText = `${job.title} ${job.company} ${job.location} ${job.description ?? ""}`;
    return matchChineseKeywords(fullText).matched;
  });

  // Log fetchMode in report if available
  if (fetchMode) console.log(`[scraper] ${source.id} fetchMode=${fetchMode} jobsFound=${jobs.length} jobsFiltered=${filtered.length}`);

  return {
    source,
    jobsFound: jobs.length,
    jobsFiltered: filtered.length,
    jobs: filtered,
    errors,
    duration: Date.now() - startTime,
    fetchMode,
  };
}

async function fetchWithFallback(
  source: ScraperSource,
  errors: string[],
  signal?: AbortSignal
): Promise<{ html: string | null; fetchMode?: FetchMode; cancelled?: boolean }> {
  // Errors from individual fallback attempts are local: if a later attempt
  // succeeds they must not be merged into `errors`, otherwise the source is
  // reported as failed even though it produced content.
  const attemptErrors: string[] = [];

  if (signal?.aborted) {
    return { html: null, cancelled: true };
  }

  if (source.scrapingApi && process.env.SCRAPING_API_KEY) {
    try {
      const apiHtml = await fetchViaScrapingAPI(source.url, source.type, signal);
      // The abort can land while the managed API call is in flight. Re-check
      // before interpreting the outcome: a rejected fetch here is a
      // cancellation, not a broken source, and must not become an error.
      if (signal?.aborted) return { html: null, cancelled: true };
      if (apiHtml) {
        console.log(`[scraper] ${source.id} fetched via scraping-api`);
        return { html: apiHtml, fetchMode: "scraping-api" };
      }
      attemptErrors.push(`Scraping API returned a block/challenge page for ${source.url}`);
      console.warn(`[scraper] scrapingApi returned an implausible payload for ${source.id}, falling back`);
    } catch (e) {
      if (signal?.aborted) return { html: null, cancelled: true };
      attemptErrors.push(`Scraping API failed for ${source.id}: ${e instanceof Error ? e.message : String(e)}`);
      console.warn(`[scraper] scrapingApi failed for ${source.id}, falling back: `, e);
    }
  }
  if (source.jsRendered) {
    try {
      const puppeteerHtml = await renderPage(source.url, {
        waitForSelector: source.puppeteerOptions?.waitForSelector,
        waitTimeout: source.puppeteerOptions?.waitTimeout,
        scrollDelay: source.puppeteerOptions?.scrollDelay,
        extraWaitMs: source.puppeteerOptions?.extraWaitMs,
      }, signal);
      if (signal?.aborted) return { html: null, cancelled: true };
      if (puppeteerHtml) {
        console.log(`[scraper] ${source.id} fetched via puppeteer`);
        return { html: puppeteerHtml, fetchMode: "puppeteer" };
      }
      attemptErrors.push(`Puppeteer failed to render: ${source.url}`);
    } catch (e) {
      if (signal?.aborted) return { html: null, cancelled: true };
      attemptErrors.push(`Puppeteer error for ${source.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const direct = await fetchWithRetry(source.url, 2, source.requestOptions, signal);
  if (signal?.aborted) return { html: null, cancelled: true };
  if (direct) {
    console.log(`[scraper] ${source.id} fetched via direct`);
    return { html: direct, fetchMode: "direct" };
  }
  attemptErrors.push(`Failed to fetch: ${source.url}`);
  // Every fallback mode failed — only now do the attempt errors count.
  errors.push(...attemptErrors);
  return { html: null };
}

// Keep fetchPageContent for backwards compat — delegates to fetchWithFallback and returns html string
async function fetchPageContent(
  source: ScraperSource,
  errors: string[]
): Promise<string | null> {
  const { html } = await fetchWithFallback(source, errors);
  return html;
}

function parseRSS(html: string, source: ScraperSource): ScrapedJobRaw[] {
  const $ = cheerio.load(html, { xmlMode: true });
  const jobs: ScrapedJobRaw[] = [];

  $("item, entry").each((_, element) => {
    const $el = $(element);
    const title = $el.find("title").text().trim();
    const link = $el.find("link").text().trim() || $el.find("link").attr("href") || "";
    const pubDate = $el.find("pubDate, published, updated").text().trim();
    const description = $el.find("description, summary, content").text().trim();

    let location = "";
    const locMatch = description.match(/(?:location|ort|standort)[:\s]*([^\n<]+)/i);
    if (locMatch) location = locMatch[1].trim();

    let company = source.name.split(" - ")[0] || "";
    const companyMatch = description.match(/(?:company|firma|unternehmen)[:\s]*([^\n<]+)/i);
    if (companyMatch) company = companyMatch[1].trim();

    if (title && link) {
      jobs.push({
        title,
        company,
        location: location || "Germany",
        url: link,
        description: description.substring(0, 2000),
        postedDate: parseDate(pubDate),
        sourceId: source.id,
        sourceName: source.name,
      });
    }
  });

  return jobs;
}

function parseHTML(html: string, source: ScraperSource, errors: string[]): ScrapedJobRaw[] {
  const $ = cheerio.load(html);
  const jobs: ScrapedJobRaw[] = [];
  const selectors = source.selectors;

  if (!selectors?.jobCard) {
    errors.push("No job card selector defined");
    return [];
  }

  $(selectors.jobCard).each((_, element) => {
    const $el = $(element);
    const title = selectors.title ? $el.find(selectors.title).first().text().trim() || $el.find("a").first().text().trim() : "";
    const company = selectors.company ? $el.find(selectors.company).text().trim() : "";
    const location = selectors.location ? $el.find(selectors.location).text().trim() : "";
    const link = selectors.link ? $el.find(selectors.link).first().attr("href") || "" : $el.find("a").first().attr("href") || "";
    const description = selectors.description ? $el.find(selectors.description).text().trim() : "";

    if (title && link) {
      // Resolve per item: a single malformed href must not discard the whole batch.
      let fullUrl: string;
      try {
        fullUrl = link.startsWith("http") ? link : new URL(link, source.url).href;
      } catch {
        console.warn(`[scraper] ${source.id} skipping job with malformed link: ${link}`);
        return;
      }
      jobs.push({
        title: cleanText(title),
        company: cleanText(company) || extractCompanyFromSource(source),
        location: cleanText(location) || "Germany",
        url: fullUrl,
        description: cleanText(description).substring(0, 2000),
        postedDate: new Date().toISOString().split("T")[0],
        sourceId: source.id,
        sourceName: source.name,
      });
    }
  });

  return jobs;
}

function parseJSONAPI(html: string, source: ScraperSource, errors: string[]): ScrapedJobRaw[] {
  try {
    const data = JSON.parse(html);
    const jobs: ScrapedJobRaw[] = [];

    const jobList = Array.isArray(data) ? data : data.jobs || data.results || data.list || [];

    for (const item of jobList) {
      if (typeof item !== "object" || item === null) continue;

      const title = item.title || item.position || item.job_title || "";
      const company = item.company || item.company_name || item.employer || "";
      const location = item.location || item.city || item.place || "Remote";
      const url = item.url || item.link || item.apply_url || source.url;
      const description = item.description || item.summary || item.snippet || "";
      const postedDate = item.created_at || item.date || item.posted || "";

      if (title && url) {
        jobs.push({
          title,
          company,
          location,
          url,
          description: String(description).substring(0, 2000),
          postedDate: parseDate(postedDate),
          sourceId: source.id,
          sourceName: source.name,
        });
      }
    }

    return jobs;
  } catch (e) {
    errors.push(
      `Failed to parse JSON API response: ${e instanceof Error ? e.message : String(e)}`
    );
    return [];
  }
}

// Legacy wrappers kept for internal compatibility — they use fetchPageContent with fallback chain
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function scrapeRSS(source: ScraperSource, errors: string[]): Promise<ScrapedJobRaw[]> {
  const html = await fetchPageContent(source, errors);
  if (!html) {
    if (!errors.length) errors.push(`Failed to fetch RSS: ${source.url}`);
    return [];
  }
  return parseRSS(html, source);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function scrapeHTML(source: ScraperSource, errors: string[]): Promise<ScrapedJobRaw[]> {
  const html = await fetchPageContent(source, errors);
  if (!html) {
    if (!errors.length) errors.push(`Failed to fetch HTML: ${source.url}`);
    return [];
  }
  return parseHTML(html, source, errors);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function scrapeJSONAPI(source: ScraperSource, errors: string[]): Promise<ScrapedJobRaw[]> {
  const html = await fetchPageContent(source, errors);
  if (!html) {
    if (!errors.length) errors.push(`Failed to fetch API: ${source.url}`);
    return [];
  }
  return parseJSONAPI(html, source, errors);
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\n\t\r]+/g, " ").trim();
}

function extractCompanyFromSource(source: ScraperSource): string {
  const parts = source.name.split(" - ");
  return parts[0].trim();
}

function parseDate(dateStr: string): string {
  const raw = (dateStr ?? "").trim();
  if (raw) {
    const date = new Date(raw);
    if (!isNaN(date.getTime())) return date.toISOString().split("T")[0];
    // Some feeds wrap the date in surrounding text ("Posted: 12.08.2026 | Berlin").
    const embedded = raw.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/);
    if (embedded) {
      const parsed = new Date(embedded[0]);
      if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
    }
  }
  // No usable date: stamp 7 days back so bulk-imported jobs can still soft-expire
  // under expireOverdueJobs instead of looking permanently fresh.
  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 7);
  return fallback.toISOString().split("T")[0];
}

export function shouldSkipSource(source: ScraperSource, recentReports: unknown[] = []): boolean {
  if (!source.enabled) return true;
  if (recentReports && recentReports.length > 0 && shouldAutoDisable(source.id, recentReports as unknown[])) {
    return true;
  }
  return false;
}

// shouldAutoDisable needs report history; callers do not pass it, so load the last
// reports here via the same DATA_STORE-aware async path as addScrapedJobsAsync.
async function loadRecentReports(): Promise<unknown[]> {
  try {
    const { loadScrapeReportsAsync } = await import("./storage");
    return (await loadScrapeReportsAsync()) as unknown[];
  } catch (err) {
    console.warn("[scraper] failed to load recent reports for auto-disable:", err);
    return [];
  }
}

// closeBrowser() tears down a module-level singleton shared by every scrape in
// this process. A second concurrent run (double-clicked admin button, admin
// scrape overlapping a warm cron lambda) would have its browser closed out
// from under it mid-goto, so only one run may be in flight at a time.
let activeScrape: Promise<ScrapeResult[]> | null = null;

async function runScrapeAllSources(
  sources: ScraperSource[],
  recentReports?: unknown[],
  onResult?: (result: ScrapeResult) => void,
  signal?: AbortSignal
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  // `!== undefined` is the discriminator: an explicitly passed empty array
  // means "no history, do not auto-disable anything", which a truthiness/length
  // check cannot tell apart from "caller passed nothing".
  const reports = recentReports !== undefined ? recentReports : await loadRecentReports();

  const usesPuppeteer = sources.some((s) => s.enabled && s.jsRendered);

  try {
    for (const source of sources) {
      if (signal?.aborted) {
        console.log("[scraper] abort requested — stopping before next source");
        break;
      }
      if (shouldSkipSource(source, reports)) {
        console.log(`[scraper] skip disabled ${source.id}`);
        continue;
      }
      const result = await scrapeSource(source, signal);
      if (result.cancelled) {
        // Keep a cancelled source out of the results array entirely: with no
        // errors it would otherwise be counted as a success, and if it ever
        // carried one it would count toward the consecutive-failure streak
        // that permanently auto-disables the source.
        console.log(`[scraper] ${source.id} cancelled — excluded from results`);
        break;
      }
      results.push(result);
      onResult?.(result);
      await delay(1000 + Math.random() * 2000, signal);
    }

    return results;
  } finally {
    // Must run on every exit path — including an aborted run — otherwise the
    // Chromium process is orphaned and leaks for the rest of the invocation.
    if (usesPuppeteer) {
      await closeBrowser();
    }
  }
}

export async function scrapeAllSources(
  sources: ScraperSource[],
  recentReports?: unknown[],
  onResult?: (result: ScrapeResult) => void,
  signal?: AbortSignal
): Promise<ScrapeResult[]> {
  if (activeScrape) {
    console.warn("[scraper] a scrape is already running — refusing to start a concurrent run");
    return [];
  }

  const run = runScrapeAllSources(sources, recentReports, onResult, signal);
  activeScrape = run;
  try {
    return await run;
  } finally {
    // Only clear the slot if it is still ours: a later run may have taken over.
    if (activeScrape === run) activeScrape = null;
  }
}
