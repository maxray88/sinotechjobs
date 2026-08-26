import * as cheerio from "cheerio";
import type { ScraperSource, ScrapedJobRaw, ScrapeResult } from "./types";
import { matchChineseKeywords } from "./keywords";
import { renderPage, closeBrowser } from "./puppeteer";

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

export async function scrapeSource(source: ScraperSource): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const jobs: ScrapedJobRaw[] = [];

  try {
    if (source.type === "rss") {
      const rssJobs = await scrapeRSS(source, errors);
      jobs.push(...rssJobs);
    } else if (source.type === "html") {
      const htmlJobs = await scrapeHTML(source, errors);
      jobs.push(...htmlJobs);
    } else if (source.type === "json-api") {
      const apiJobs = await scrapeJSONAPI(source, errors);
      jobs.push(...apiJobs);
    }
  } catch (err) {
    errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const filtered = jobs.filter((job) => {
    const fullText = `${job.title} ${job.company} ${job.location} ${job.description ?? ""}`;
    return matchChineseKeywords(fullText).matched;
  });

  return {
    source,
    jobsFound: jobs.length,
    jobsFiltered: filtered.length,
    jobs: filtered,
    errors,
    duration: Date.now() - startTime,
  };
}

async function fetchPageContent(
  source: ScraperSource,
  errors: string[]
): Promise<string | null> {
  if (source.jsRendered) {
    const html = await renderPage(source.url, {
      waitForSelector: source.puppeteerOptions?.waitForSelector,
      waitTimeout: source.puppeteerOptions?.waitTimeout,
      scrollDelay: source.puppeteerOptions?.scrollDelay,
      extraWaitMs: source.puppeteerOptions?.extraWaitMs,
    });
    if (!html) {
      errors.push(`Puppeteer failed to render: ${source.url}`);
    }
    return html;
  }
  return await fetchWithRetry(source.url, 2, source.requestOptions);
}

async function scrapeRSS(source: ScraperSource, errors: string[]): Promise<ScrapedJobRaw[]> {
  const html = await fetchPageContent(source, errors);
  if (!html) {
    if (!errors.length) errors.push(`Failed to fetch RSS: ${source.url}`);
    return [];
  }

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

async function scrapeHTML(source: ScraperSource, errors: string[]): Promise<ScrapedJobRaw[]> {
  const html = await fetchPageContent(source, errors);
  if (!html) {
    if (!errors.length) errors.push(`Failed to fetch HTML: ${source.url}`);
    return [];
  }

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

async function scrapeJSONAPI(source: ScraperSource, errors: string[]): Promise<ScrapedJobRaw[]> {
  const html = await fetchPageContent(source, errors);
  if (!html) {
    if (!errors.length) errors.push(`Failed to fetch API: ${source.url}`);
    return [];
  }

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

export async function scrapeAllSources(sources: ScraperSource[]): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  const usesPuppeteer = sources.some((s) => s.enabled && s.jsRendered);

  for (const source of sources) {
    if (!source.enabled) continue;
    const result = await scrapeSource(source);
    results.push(result);
    await delay(1000 + Math.random() * 2000);
  }

  if (usesPuppeteer) {
    await closeBrowser();
  }

  return results;
}
