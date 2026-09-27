import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScraperSource } from "@/lib/scraper/types";

// Mock puppeteer before importing engine (hoisted)
vi.mock("@/lib/scraper/puppeteer", () => ({
  renderPage: vi.fn(),
  closeBrowser: vi.fn(),
  getBrowser: vi.fn(),
}));

import { fetchViaScrapingAPI, scrapeSource, MIN_PLAUSIBLE_HTML_CHARS } from "@/lib/scraper/engine";
import { renderPage } from "@/lib/scraper/puppeteer";

const mockedRenderPage = vi.mocked(renderPage);

// Realistic anti-bot interstitial. Short by design — this is what a real
// Cloudflare/Akamai challenge looks like, and the guard must reject it.
const CLOUDFLARE_CHALLENGE_PAGE =
  `<html><head><title>Just a moment...</title></head><body>` +
  `<div id="cf-challenge-running">Checking your browser before accessing.` +
  ` Please enable JavaScript and cookies to continue.</div>` +
  `</body></html>`;

// A markup listing page of realistic size. Fixtures below 500 chars would be
// rejected by the block-page guard, so they must not exercise that path.
function realisticHtmlListing(): string {
  return `<!doctype html>
<html lang="de">
  <head><meta charset="utf-8"><title>StepStone — Jobs für chinesischsprachige Bewerber</title></head>
  <body>
    <main class="job-results" data-total="1">
      <article class="job" data-id="j-4711">
        <a class="title" href="https://www.stepstone.de/jobs/senior-robotics-engineer-muenchen">Senior Robotics Engineer (m/w/d)</a>
        <span class="company">KUKA AG</span>
        <span class="location">München, Bayern</span>
        <p class="description">Entwicklung von Steuerungssoftware für Industrieroboter. Gute Deutschkenntnisse required, Mandarin-Kenntnisse sind von Vorteil. Standort Augsburg oder München.</p>
      </article>
    </main>
  </body>
</html>`;
}

function makeSource(overrides: Partial<ScraperSource> = {}): ScraperSource {
  return {
    id: "test-linkedin",
    name: "Test LinkedIn",
    nameZh: "测试",
    type: "json-api",
    url: "https://example.com/api",
    enabled: true,
    keywords: ["chinesisch"],
    ...overrides,
  };
}

describe("fetchViaScrapingAPI", () => {
  const originalEnv = process.env;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // clone env
    process.env = { ...originalEnv };
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockedRenderPage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("builds correct ScrapingBee URL with encoded key and url", async () => {
    process.env.SCRAPING_API_KEY = "bee-key-123";
    delete process.env.SCRAPING_API_PROVIDER; // default scrapingbee
    const htmlPayload = realisticHtmlListing();
    expect(htmlPayload.length).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_HTML_CHARS);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => htmlPayload,
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com/job?q=test&lang=zh", "html");

    expect(result).toBe(htmlPayload);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("https://app.scrapingbee.com/api/v1/");
    expect(calledUrl).toContain(`api_key=${encodeURIComponent("bee-key-123")}`);
    expect(calledUrl).toContain(`url=${encodeURIComponent("https://example.com/job?q=test&lang=zh")}`);
    expect(calledUrl).toContain("render_js=true");
    expect(calledUrl).toContain("premium_proxy=true");
    expect(calledUrl).toContain("country_code=de");
  });

  it("builds correct ScraperAPI URL when provider=scraperapi", async () => {
    process.env.SCRAPING_API_KEY = "scraper-key-xyz";
    process.env.SCRAPING_API_PROVIDER = "scraperapi";
    const htmlPayload = realisticHtmlListing();

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => htmlPayload,
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com/job", "html");

    expect(result).toBe(htmlPayload);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("https://api.scraperapi.com");
    expect(calledUrl).toContain(`api_key=${encodeURIComponent("scraper-key-xyz")}`);
    expect(calledUrl).toContain(`url=${encodeURIComponent("https://example.com/job")}`);
    // ScrapingBee param should not be present
    expect(calledUrl).not.toContain("render_js");
  });

  it("handles provider case-insensitivity (ScrapingBee uppercase)", async () => {
    process.env.SCRAPING_API_KEY = "key123";
    process.env.SCRAPING_API_PROVIDER = "ScrapingBee";
    const htmlPayload = realisticHtmlListing();

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => htmlPayload,
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com", "html");
    expect(result).toBe(htmlPayload);
    expect(fetchSpy.mock.calls[0][0]).toContain("scrapingbee.com");
  });

  it("throws when SCRAPING_API_KEY missing", async () => {
    delete process.env.SCRAPING_API_KEY;
    delete process.env.SCRAPING_API_PROVIDER;

    await expect(fetchViaScrapingAPI("https://example.com")).rejects.toThrow("SCRAPING_API_KEY missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws ScrapingBee error when response not ok", async () => {
    process.env.SCRAPING_API_KEY = "k";
    delete process.env.SCRAPING_API_PROVIDER;

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    } as Response);

    await expect(fetchViaScrapingAPI("https://example.com")).rejects.toThrow("ScrapingBee 403");
  });

  it("throws ScraperAPI error when response not ok", async () => {
    process.env.SCRAPING_API_KEY = "k";
    process.env.SCRAPING_API_PROVIDER = "scraperapi";

    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as Response);

    await expect(fetchViaScrapingAPI("https://example.com")).rejects.toThrow("ScraperAPI 429");
  });

  it("throws unknown provider error", async () => {
    process.env.SCRAPING_API_KEY = "k";
    process.env.SCRAPING_API_PROVIDER = "unknown-provider";

    await expect(fetchViaScrapingAPI("https://example.com")).rejects.toThrow("Unknown provider unknown-provider");
  });

  // --- block-page guard: a 200 that carries a challenge page must never be
  // reported as content, otherwise the managed API credit is silently burned.
  it("rejects a short Cloudflare challenge page for an html source (returns null)", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    delete process.env.SCRAPING_API_PROVIDER;
    expect(CLOUDFLARE_CHALLENGE_PAGE.length).toBeLessThan(MIN_PLAUSIBLE_HTML_CHARS);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => CLOUDFLARE_CHALLENGE_PAGE,
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com/blocked", "html");
    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a long block-page payload with no markup markers (returns null)", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    delete process.env.SCRAPING_API_PROVIDER;
    // Over the length floor, but carries no HTML — a plain-text captcha wall.
    const captchaWall = "Attention Required! Cloudflare error 1020 access denied. ".repeat(20);
    expect(captchaWall.length).toBeGreaterThan(MIN_PLAUSIBLE_HTML_CHARS);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => captchaWall,
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com/blocked", "html");
    expect(result).toBeNull();
  });

  it("rejects an HTML challenge page for a json-api source (returns null)", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    delete process.env.SCRAPING_API_PROVIDER;

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => realisticHtmlListing(), // long enough, but not JSON
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com/api/blocked", "json-api");
    expect(result).toBeNull();
  });

  it("applies MIN_PLAUSIBLE_HTML_CHARS as a boundary on markup payloads", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    delete process.env.SCRAPING_API_PROVIDER;

    const justUnder = `<html>${"a".repeat(MIN_PLAUSIBLE_HTML_CHARS - "<html></html>".length - 1)}</html>`;
    expect(justUnder.length).toBe(MIN_PLAUSIBLE_HTML_CHARS - 1);
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => justUnder } as Response);
    expect(await fetchViaScrapingAPI("https://example.com", "html")).toBeNull();

    const exactlyAt = `${justUnder}a`;
    expect(exactlyAt.length).toBe(MIN_PLAUSIBLE_HTML_CHARS);
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => exactlyAt } as Response);
    expect(await fetchViaScrapingAPI("https://example.com", "html")).toBe(exactlyAt);
  });

  it("accepts a short but valid JSON payload for a json-api source", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    delete process.env.SCRAPING_API_PROVIDER;
    // Small JSON is legitimate for a JSON API — no length floor applies there.
    const jsonPayload = JSON.stringify([{ title: "Chinese speaking DevOps Engineer", company: "Bosch" }]);
    expect(jsonPayload.length).toBeLessThan(MIN_PLAUSIBLE_HTML_CHARS);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => jsonPayload,
    } as Response);

    const result = await fetchViaScrapingAPI("https://example.com/api/jobs", "json-api");
    expect(result).toBe(jsonPayload);
  });
});

describe("fallback chain and fetchMode", () => {
  const originalEnv = process.env;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockedRenderPage.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("skips scraping-api when SCRAPING_API_KEY missing and uses direct (fetchMode=direct)", async () => {
    delete process.env.SCRAPING_API_KEY;

    const source = makeSource({
      id: "linkedin-chinese-de",
      scrapingApi: true,
      jsRendered: false,
      type: "json-api",
      url: "https://example.com/api",
    });

    // direct fetch mock returns JSON with chinese keyword so it passes filter
    const jsonPayload = JSON.stringify([
      {
        title: "Software Engineer chinesisch",
        company: "TestCo",
        location: "Berlin",
        url: "https://example.com/job/1",
        description: "need chinesisch",
      },
    ]);

    fetchSpy.mockImplementation(async (url: string) => {
      // should be direct fetch to source url, not scrapingbee
      expect(url).toBe("https://example.com/api");
      return {
        ok: true,
        status: 200,
        text: async () => jsonPayload,
      } as Response;
    });

    const result = await scrapeSource(source);

    expect(result.fetchMode).toBe("direct");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockedRenderPage).not.toHaveBeenCalled();
    expect(result.jobsFound).toBe(1);
    expect(result.jobsFiltered).toBe(1);
    expect(result.jobs[0].title).toContain("chinesisch");
  });

  it("skips scraping-api when source.scrapingApi is false even if key exists", async () => {
    process.env.SCRAPING_API_KEY = "some-key";

    const source = makeSource({
      id: "stepstone-chinese-de",
      scrapingApi: false,
      jsRendered: false,
      type: "json-api",
      url: "https://example.com/api2",
    });

    const jsonPayload = JSON.stringify([
      {
        title: "chinesisch required",
        company: "Co",
        location: "Munich",
        url: "https://example.com/job/2",
        description: "chinesisch",
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => jsonPayload,
    } as Response);

    const result = await scrapeSource(source);
    expect(result.fetchMode).toBe("direct");
    // ensure fetch was called with direct url, not scrapingbee
    expect(fetchSpy.mock.calls[0][0]).toBe("https://example.com/api2");
  });

  it("uses scraping-api when enabled and key present, fetchMode=scraping-api, does not call puppeteer", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    delete process.env.SCRAPING_API_PROVIDER; // scrapingbee

    const source = makeSource({
      id: "xing-chinese-de",
      scrapingApi: true,
      jsRendered: true,
      type: "json-api",
      url: "https://example.com/api3",
    });

    const jsonPayload = JSON.stringify([
      {
        title: "XING chinesisch job",
        company: "XingCo",
        location: "Berlin",
        url: "https://example.com/job/3",
        description: "mandarin required chinesisch",
      },
    ]);

    fetchSpy.mockImplementation(async (url: string) => {
      // first call should be scrapingbee api url
      if (typeof url === "string" && url.includes("scrapingbee.com")) {
        expect(url).toContain(encodeURIComponent("https://example.com/api3"));
        return {
          ok: true,
          status: 200,
          text: async () => jsonPayload,
        } as Response;
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    mockedRenderPage.mockResolvedValue("<html>should not be called</html>");

    const result = await scrapeSource(source);

    expect(result.fetchMode).toBe("scraping-api");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockedRenderPage).not.toHaveBeenCalled();
    expect(result.jobsFiltered).toBe(1);
  });

  it("falls back to puppeteer when scraping-api fails, fetchMode=puppeteer", async () => {
    process.env.SCRAPING_API_KEY = "key-fail";
    process.env.SCRAPING_API_PROVIDER = "scrapingbee";

    const source = makeSource({
      id: "linkedin-chinese-de",
      scrapingApi: true,
      jsRendered: true,
      type: "json-api",
      url: "https://example.com/api4",
    });

    const jsonPayload = JSON.stringify([
      {
        title: "LinkedIn chinesisch fallback puppeteer",
        company: "LinkedInCo",
        location: "Hamburg",
        url: "https://example.com/job/4",
        description: "chinesisch",
      },
    ]);

    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("scrapingbee.com")) {
        return {
          ok: false,
          status: 500,
          text: async () => "error",
        } as Response;
      }
      // should not reach direct if puppeteer succeeds
      throw new Error(`Unexpected direct fetch call: ${url}`);
    });

    mockedRenderPage.mockResolvedValue(jsonPayload);

    const result = await scrapeSource(source);

    expect(result.fetchMode).toBe("puppeteer");
    expect(mockedRenderPage).toHaveBeenCalledTimes(1);
    expect(mockedRenderPage).toHaveBeenCalledWith("https://example.com/api4", expect.any(Object));
    expect(result.jobsFiltered).toBe(1);
    // console.warn should have been called for scrapingApi failure
    expect(console.warn).toHaveBeenCalled();
  });

  it("falls back to direct when scraping-api and puppeteer both fail, fetchMode=direct", async () => {
    process.env.SCRAPING_API_KEY = "key-fail2";

    const source = makeSource({
      id: "xing-chinese-de",
      scrapingApi: true,
      jsRendered: true,
      type: "json-api",
      url: "https://example.com/api5",
    });

    const jsonPayload = JSON.stringify([
      {
        title: "Direct fallback chinesisch",
        company: "DirectCo",
        location: "Berlin",
        url: "https://example.com/job/5",
        description: "chinesisch",
      },
    ]);

    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("scrapingbee.com")) {
        return {
          ok: false,
          status: 502,
          text: async () => "bad gateway",
        } as Response;
      }
      // direct fetch
      if (url === "https://example.com/api5") {
        return {
          ok: true,
          status: 200,
          text: async () => jsonPayload,
        } as Response;
      }
      throw new Error(`Unexpected url ${url}`);
    });

    mockedRenderPage.mockResolvedValue(null); // puppeteer fails

    const result = await scrapeSource(source);

    expect(result.fetchMode).toBe("direct");
    expect(mockedRenderPage).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalled();
    // should have called scrapingbee and direct
    const calledUrls = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes("scrapingbee.com"))).toBe(true);
    expect(calledUrls.some((u) => u === "https://example.com/api5")).toBe(true);
    expect(result.jobsFiltered).toBe(1);
  });

  it("uses puppeteer directly when scrapingApi not enabled but jsRendered true, fetchMode=puppeteer", async () => {
    delete process.env.SCRAPING_API_KEY;

    const source = makeSource({
      id: "indeed-chinese-de",
      scrapingApi: undefined,
      jsRendered: true,
      type: "html",
      url: "https://example.com/jobs",
      selectors: {
        jobCard: ".job",
        title: ".title",
        company: ".company",
        location: ".location",
        link: "a",
      },
    });

    const htmlPayload = `
      <html><body>
        <div class="job">
          <div class="title">Engineer chinesisch</div>
          <div class="company">IndeedCo</div>
          <div class="location">Berlin</div>
          <a href="https://example.com/job/6">Apply</a>
        </div>
      </body></html>
    `;

    mockedRenderPage.mockResolvedValue(htmlPayload);
    // direct fetch should not be called if puppeteer succeeds
    fetchSpy.mockImplementation(async () => {
      throw new Error("direct fetch should not be called when puppeteer succeeds");
    });

    const result = await scrapeSource(source);
    expect(result.fetchMode).toBe("puppeteer");
    expect(mockedRenderPage).toHaveBeenCalledTimes(1);
    expect(result.jobsFiltered).toBe(1);
    expect(result.jobs[0].title).toContain("chinesisch");
  });

  it("records fetchMode even when filtering yields zero jobs", async () => {
    delete process.env.SCRAPING_API_KEY;

    const source = makeSource({
      id: "remoteok-chinese",
      scrapingApi: false,
      jsRendered: false,
      type: "json-api",
      url: "https://example.com/api6",
    });

    // job without chinese keyword -> will be filtered out
    const jsonPayload = JSON.stringify([
      {
        title: "Software Engineer Python",
        company: "TechCorp",
        location: "Remote",
        url: "https://example.com/job/7",
        description: "Python developer",
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => jsonPayload,
    } as Response);

    const result = await scrapeSource(source);
    expect(result.fetchMode).toBe("direct");
    expect(result.jobsFound).toBe(1);
    expect(result.jobsFiltered).toBe(0);
    expect(result.jobs).toHaveLength(0);
  });

  it("logs fetchMode via console.log", async () => {
    process.env.SCRAPING_API_KEY = "log-key";
    const source = makeSource({
      id: "linkedin-chinese-de",
      scrapingApi: true,
      jsRendered: false,
      type: "json-api",
      url: "https://example.com/api7",
    });

    const jsonPayload = JSON.stringify([
      {
        title: "chinesisch log test",
        company: "LogCo",
        location: "Berlin",
        url: "https://example.com/job/8",
        description: "chinesisch",
      },
    ]);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => jsonPayload,
    } as Response);

    const result = await scrapeSource(source);
    expect(result.fetchMode).toBe("scraping-api");
    // console.log should have been called with fetchMode
    const logCalls = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logCalls).toContain("scraping-api");
  });

  it("falls back to puppeteer when scraping-api returns a block page, fetchMode=puppeteer", async () => {
    process.env.SCRAPING_API_KEY = "block-key";
    delete process.env.SCRAPING_API_PROVIDER;

    const source = makeSource({
      id: "linkedin-blocked",
      scrapingApi: true,
      jsRendered: true,
      type: "html",
      url: "https://example.com/blocked",
      selectors: {
        jobCard: ".job",
        title: ".title",
        company: ".company",
        location: ".location",
        link: "a",
        description: ".description",
      },
    });

    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("scrapingbee.com")) {
        return { ok: true, status: 200, text: async () => CLOUDFLARE_CHALLENGE_PAGE } as Response;
      }
      throw new Error(`Unexpected direct fetch call: ${url}`);
    });

    const puppeteerHtml = realisticHtmlListing();
    mockedRenderPage.mockResolvedValue(puppeteerHtml);

    const result = await scrapeSource(source);

    expect(result.fetchMode).toBe("puppeteer");
    expect(result.jobsFiltered).toBe(1);
    expect(result.jobs[0].title).toContain("Robotics");
    // the challenge page was discarded, never parsed into jobs
    expect(result.jobs.some((j) => (j.description ?? "").includes("cf-challenge"))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("implausible payload"));
    // attempt-local errors are dropped once a later mode succeeds
    expect(result.errors).toHaveLength(0);
  });

  it("records a block/challenge error when scraping-api and all fallbacks fail", async () => {
    process.env.SCRAPING_API_KEY = "block-key";
    delete process.env.SCRAPING_API_PROVIDER;

    const source = makeSource({
      id: "linkedin-blocked",
      scrapingApi: true,
      jsRendered: false,
      type: "html",
      url: "https://example.com/blocked",
    });

    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("scrapingbee.com")) {
        return { ok: true, status: 200, text: async () => CLOUDFLARE_CHALLENGE_PAGE } as Response;
      }
      return { ok: false, status: 503, text: async () => "service unavailable" } as Response;
    });

    vi.useFakeTimers();
    try {
      const pending = scrapeSource(source);
      // fetchWithRetry waits 2s + 4s between its three attempts
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.fetchMode).toBeUndefined();
      expect(result.jobs).toHaveLength(0);
      expect(result.jobsFound).toBe(0);
      expect(result.errors.some((e) => e.includes("block/challenge page"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Failed to fetch: https://example.com/blocked"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
