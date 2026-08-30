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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = 2, requestOptions?: ScraperSource["requestOptions"]): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        if (attempt < retries) {
          await delay(2000 * (attempt + 1));
          continue;
        }
        return null;
      }

      return await response.text();
    } catch {
      if (attempt < retries) {
        await delay(2000 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function fetchViaScrapingAPI(url: string): Promise<string> {
  const key = process.env.SCRAPING_API_KEY;
  const provider = (process.env.SCRAPING_API_PROVIDER || "scrapingbee").toLowerCase();
  if (!key) throw new Error("SCRAPING_API_KEY missing");
  if (provider === "scrapingbee") {
    const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&country_code=de`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`ScrapingBee ${res.status}`);
    return res.text();
  }
  if (provider === "scraperapi") {
    const apiUrl = `http://api.scraperapi.com?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`ScraperAPI ${res.status}`);
    return res.text();
  }
  throw new Error(`Unknown provider ${provider}`);
}

export async function scrapeSource(source: ScraperSource): Promise<ScrapeResult> {
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

    const buildUrl = (engine: string) =>
      `https://www.searchapi.io/api/v1/search?engine=${encodeURIComponent(engine)}&q=${encodeURIComponent("chinesisch jobs Germany")}&location=${encodeURIComponent("Germany")}&hl=de&gl=de&api_key=${encodeURIComponent(apiKey)}`;

    let rawJson: string | null = null;
    const fetchMode: FetchMode = "direct";
    let lastError: string | null = null;

    const tryFetch = async (engine: string): Promise<string | null> => {
      const url = buildUrl(engine);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
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
            // trigger fallback on engine param errors
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

    rawJson = await tryFetch("google_jobs");
    if (!rawJson) {
      console.warn(`[scraper] google-jobs-searchapi engine=google_jobs failed (${lastError}), trying fallback engine=google`);
      const fallback = await tryFetch("google");
      if (fallback) rawJson = fallback;
    }

    if (!rawJson) {
      if (lastError) errors.push(lastError);
      if (errors.length === 0) errors.push("Failed to fetch from SearchAPI (both engines)");
      return {
        source,
        jobsFound: 0,
        jobsFiltered: 0,
        jobs: [],
        errors,
        duration: Date.now() - startTime,
        fetchMode,
      };
    }

    const jobs: ScrapedJobRaw[] = [];
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
          jobs.push({
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
      errors.push(`Failed to parse SearchAPI response: ${e instanceof Error ? e.message : String(e)}`);
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
      errors,
      duration: Date.now() - startTime,
      fetchMode,
    };
  }

  const { html, fetchMode } = await fetchWithFallback(source, errors);

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
  errors: string[]
): Promise<{ html: string | null; fetchMode?: FetchMode }> {
  let html: string | null = null;
  let fetchMode: FetchMode | undefined;
  if (source.scrapingApi && process.env.SCRAPING_API_KEY) {
    try {
      html = await fetchViaScrapingAPI(source.url);
      fetchMode = "scraping-api";
      console.log(`[scraper] ${source.id} fetched via scraping-api`);
      return { html, fetchMode };
    } catch (e) {
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
      });
      if (puppeteerHtml) {
        console.log(`[scraper] ${source.id} fetched via puppeteer`);
        return { html: puppeteerHtml, fetchMode: "puppeteer" };
      }
      errors.push(`Puppeteer failed to render: ${source.url}`);
    } catch (e) {
      errors.push(`Puppeteer error for ${source.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const direct = await fetchWithRetry(source.url, 2, source.requestOptions);
  if (direct) {
    console.log(`[scraper] ${source.id} fetched via direct`);
    return { html: direct, fetchMode: "direct" };
  }
  if (errors.length === 0) errors.push(`Failed to fetch: ${source.url}`);
  return { html: null, fetchMode };
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
      const fullUrl = link.startsWith("http") ? link : new URL(link, source.url).href;
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
  } catch {
    errors.push("Failed to parse JSON API response");
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
  if (!dateStr) return new Date().toISOString().split("T")[0];
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return new Date().toISOString().split("T")[0];
  return date.toISOString().split("T")[0];
}

export function shouldSkipSource(source: ScraperSource, recentReports: unknown[] = []): boolean {
  if (!source.enabled) return true;
  if (recentReports && recentReports.length > 0 && shouldAutoDisable(source.id, recentReports as unknown[])) {
    return true;
  }
  return false;
}

export async function scrapeAllSources(sources: ScraperSource[], recentReports?: unknown[]): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  const usesPuppeteer = sources.some((s) => s.enabled && s.jsRendered);

  for (const source of sources) {
    if (shouldSkipSource(source, (recentReports ?? []) as unknown[])) {
      console.log(`[scraper] skip disabled ${source.id}`);
      continue;
    }
    const result = await scrapeSource(source);
    results.push(result);
    await delay(1000 + Math.random() * 2000);
  }

  if (usesPuppeteer) {
    await closeBrowser();
  }

  return results;
}
