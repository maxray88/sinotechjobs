import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The engine never launches a real browser in tests; puppeteer is replaced so
// the fallback chain and the abort re-checks can be driven deterministically.
vi.mock("@/lib/scraper/puppeteer", () => ({
  renderPage: vi.fn(),
  closeBrowser: vi.fn(),
  getBrowser: vi.fn(),
}));

import type { ScraperSource } from "@/lib/scraper/types";
import { scrapeAllSources, scrapeSource } from "@/lib/scraper/engine";
import { shouldAutoDisable } from "@/lib/scraper/health";
import { closeBrowser, renderPage } from "@/lib/scraper/puppeteer";
import {
  ADMIN_SECRET_STORAGE_KEY,
  buildAuthHeaders,
  getAdminSecret,
  setAdminSecret,
} from "@/lib/admin-auth";

const mockedRenderPage = vi.mocked(renderPage);
const mockedCloseBrowser = vi.mocked(closeBrowser);

function makeSource(overrides: Partial<ScraperSource> = {}): ScraperSource {
  return {
    id: "test-source",
    name: "Test Source",
    nameZh: "ceshi",
    type: "json-api",
    url: "https://example.com/api",
    enabled: true,
    keywords: ["chinesisch"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. CANCELLATION IS NOT A FAILURE
//
// engine.ts re-checks signal.aborted after every fallback mode and flags the
// result cancelled instead of pushing "This operation was aborted" into
// errors. An aborted run must never look like a broken source, or
// health.ts shouldAutoDisable permanently disables a healthy source after
// five cron timeouts.
// ---------------------------------------------------------------------------
describe("cancellation is not a source failure", () => {
  const originalEnv = process.env;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SCRAPING_API_KEY;
    delete process.env.SEARCHAPI_KEY;
    delete process.env.SEARCH_API_KEY;
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockedRenderPage.mockReset();
    mockedCloseBrowser.mockReset();
    mockedCloseBrowser.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("flags an already-aborted signal as cancelled with an empty errors array", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await scrapeSource(makeSource(), controller.signal);

    expect(result.cancelled).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.jobs).toEqual([]);
    expect(result.jobsFound).toBe(0);
    expect(result.jobsFiltered).toBe(0);
    // Nothing was even attempted: no network, no browser.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedRenderPage).not.toHaveBeenCalled();
  });

  it("treats an abort landing on the direct fetch as cancelled, not as a fetch error", async () => {
    const controller = new AbortController();
    // A real aborted fetch rejects, and the abort has already fired by then.
    fetchSpy.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("This operation was aborted", "AbortError");
    });

    const result = await scrapeSource(
      makeSource({ scrapingApi: false, jsRendered: false }),
      controller.signal
    );

    expect(result.cancelled).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.errors.join(" ")).not.toContain("aborted");
    // The retry budget is not burned on a cancelled run.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats an abort landing inside the managed scraping API as cancelled", async () => {
    process.env.SCRAPING_API_KEY = "bee-key";
    const controller = new AbortController();
    fetchSpy.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("This operation was aborted", "AbortError");
    });

    const result = await scrapeSource(
      makeSource({ scrapingApi: true, jsRendered: true, url: "https://example.com/bee" }),
      controller.signal
    );

    expect(result.cancelled).toBe(true);
    expect(result.errors).toEqual([]);
    // Neither the Puppeteer nor the direct fallback may start after a cancel.
    expect(mockedRenderPage).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats an abort landing inside Puppeteer as cancelled and skips the direct fallback", async () => {
    const controller = new AbortController();
    mockedRenderPage.mockImplementation(async () => {
      controller.abort();
      return null;
    });

    const result = await scrapeSource(
      makeSource({ scrapingApi: false, jsRendered: true }),
      controller.signal
    );

    expect(result.cancelled).toBe(true);
    expect(result.errors).toEqual([]);
    expect(mockedRenderPage).toHaveBeenCalledTimes(1);
    // Before the fix this fell through to a direct fetch and reported
    // "Puppeteer failed to render" plus "Failed to fetch" as source errors.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks the searchapi source cancelled without inventing a SearchAPI error", async () => {
    process.env.SEARCHAPI_KEY = "search-key";
    const controller = new AbortController();
    controller.abort();

    const result = await scrapeSource(
      makeSource({ id: "google-jobs-searchapi" }),
      controller.signal
    );

    expect(result.cancelled).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.errors.join(" ")).not.toContain("SearchAPI");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a cancelled source out of the results array and out of the onResult stream", async () => {
    const controller = new AbortController();
    const onResult = vi.fn();
    mockedRenderPage.mockImplementation(async () => {
      controller.abort();
      return null;
    });

    const results = await scrapeAllSources(
      [makeSource({ id: "js-source", jsRendered: true })],
      [],
      onResult,
      controller.signal
    );

    expect(results).toEqual([]);
    expect(onResult).not.toHaveBeenCalled();
    // The browser is still torn down even on the cancelled path.
    expect(mockedCloseBrowser).toHaveBeenCalledTimes(1);
  });

  it("does not let cancelled results drive shouldAutoDisable to disable a healthy source", () => {
    const cancelled = {
      source: makeSource({ id: "healthy-source" }),
      jobsFound: 0,
      jobsFiltered: 0,
      // The crux of the fix: a cancelled result carries no errors.
      errors: [],
    } as unknown as Record<string, unknown>;
    const reports = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 60_000).toISOString(),
      results: [cancelled],
    }));

    expect(shouldAutoDisable("healthy-source", reports, 5)).toBe(false);
  });

  it("would have disabled the source five times over with the pre-fix error-carrying result", () => {
    // Control: proves the assertion above is discriminating. The old engine
    // pushed an abort message into errors, which health.ts reads as failure.
    const preFix: Record<string, unknown> = {
      source: makeSource({ id: "healthy-source" }),
      jobsFound: 0,
      jobsFiltered: 0,
      errors: ["Failed to fetch: https://example.com/api"],
    };
    const reports = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 60_000).toISOString(),
      results: [preFix],
    }));

    expect(shouldAutoDisable("healthy-source", reports, 5)).toBe(true);
  });

  it("still reports a genuine, non-cancelled outage as a failure", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));

    vi.useFakeTimers();
    try {
      const pending = scrapeSource(makeSource({ scrapingApi: false, jsRendered: false }));
      // fetchWithRetry waits 2s + 4s between its three attempts
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      // The fix must not swallow real errors.
      expect(result.cancelled).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. CONCURRENT SCRAPE LOCK
//
// closeBrowser() tears down a module-level Chromium singleton shared by every
// scrape in the process, so only one scrapeAllSources run may be in flight.
// ---------------------------------------------------------------------------
describe("concurrent scrape lock", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SCRAPING_API_KEY;
    vi.stubGlobal("fetch", vi.fn());
    mockedRenderPage.mockReset();
    mockedCloseBrowser.mockReset();
    mockedCloseBrowser.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a second run instead of starting one that would close the shared browser", async () => {
    const controller = new AbortController();
    // Assigned synchronously by the executor below; the throwing default exists
    // only so the variable keeps a callable type (TS would otherwise narrow it
    // to null and reject the later call).
    let releaseRender: () => void = () => {
      throw new Error("the gated render was never awaited");
    };
    const gate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    mockedRenderPage.mockImplementation(async () => {
      await gate;
      return "<html><body>rendered</body></html>";
    });

    // Abort on the first result so the inter-source pause resolves instantly.
    const onResultA = vi.fn(() => controller.abort());
    const first = scrapeAllSources(
      [makeSource({ id: "source-a", jsRendered: true, url: "https://example.com/a" })],
      [],
      onResultA,
      controller.signal
    );

    // The lock must already be held, before the first await has resolved.
    const onResultB = vi.fn();
    const second = await scrapeAllSources(
      [makeSource({ id: "source-b", jsRendered: true, url: "https://example.com/b" })],
      [],
      onResultB
    );

    expect(second).toEqual([]);
    expect(onResultB).not.toHaveBeenCalled();
    // Only source A ever reached the browser; B started no work at all.
    expect(mockedRenderPage).toHaveBeenCalledTimes(1);
    expect(mockedRenderPage.mock.calls[0][0]).toBe("https://example.com/a");
    // Critically, the rejected run did not tear the shared browser down.
    expect(mockedCloseBrowser).not.toHaveBeenCalled();

    releaseRender();
    const firstResults = await first;

    expect(firstResults).toHaveLength(1);
    expect(firstResults[0].source.id).toBe("source-a");
    expect(onResultA).toHaveBeenCalledTimes(1);
    // Exactly one teardown, from the run that actually owned the browser.
    expect(mockedCloseBrowser).toHaveBeenCalledTimes(1);
  });

  it("releases the lock once the first run settles so the next run proceeds", async () => {
    mockedRenderPage.mockImplementation(async () => {
      await flush();
      return "<html><body>rendered</body></html>";
    });
    const firstController = new AbortController();
    const first = scrapeAllSources(
      [makeSource({ id: "source-a", jsRendered: true })],
      [],
      () => firstController.abort(),
      firstController.signal
    );
    await first;
    expect(mockedCloseBrowser).toHaveBeenCalledTimes(1);

    // Second, sequential run: a fresh direct-only source.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            title: "Software Engineer (chinesisch required)",
            company: "Bosch",
            location: "Berlin",
            url: "https://example.com/job/1",
            description: " Mandarin-Kenntnisse required for this role.",
          },
        ]),
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    const secondController = new AbortController();
    const onResult = vi.fn(() => secondController.abort());
    const secondResults = await scrapeAllSources(
      [makeSource({ id: "source-c", jsRendered: false })],
      [],
      onResult,
      secondController.signal
    );

    expect(secondResults).toHaveLength(1);
    expect(secondResults[0].source.id).toBe("source-c");
    expect(onResult).toHaveBeenCalledTimes(1);
    // A direct-only run owns no browser, so no extra teardown happens.
    expect(mockedCloseBrowser).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4 + 5. getAdminSecret / setAdminSecret hardening
// ---------------------------------------------------------------------------
describe("admin secret storage hardening", () => {
  function storage(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    return {
      getItem: vi.fn((key: string) => map.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        map.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        map.delete(key);
      }),
    };
  }

  function withWindow(localStorage: unknown): void {
    vi.stubGlobal("window", { localStorage });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("trims a stored secret on read, symmetric with the trimmed write", () => {
    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "  secret  " }));
    expect(getAdminSecret()).toBe("secret");
  });

  it("trims surrounding CRLF off a hand-edited value and keeps the secret usable", () => {
    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "  \r\nsecret\r\n  " }));
    expect(getAdminSecret()).toBe("secret");
    // The trimmed value is what reaches the Authorization header, so it must
    // never contain a character that would make `new Headers()` throw.
    expect(buildAuthHeaders()).toEqual({ Authorization: "Bearer secret" });
  });

  it("rejects a value that still contains control characters after trimming", () => {
    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "sec\r\nret" }));
    expect(getAdminSecret()).toBeNull();

    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "a@b.c\r\nBcc: victim@x.y" }));
    expect(getAdminSecret()).toBeNull();

    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "sec\tret" }));
    expect(getAdminSecret()).toBeNull();

    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "sec\u0000ret" }));
    expect(getAdminSecret()).toBeNull();

    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "sec\u007fret" }));
    expect(getAdminSecret()).toBeNull();
  });

  it("omits the Authorization header entirely for an unusable stored secret", () => {
    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "sec\r\nret" }));
    expect(buildAuthHeaders()).toEqual({});
    // And the value the admin UI would have sent is header-safe by construction.
    expect(() => new Headers({ Authorization: `Bearer ${getAdminSecret() ?? ""}` })).not.toThrow();
  });

  it("returns null for missing, empty and whitespace-only stored values", () => {
    withWindow(storage());
    expect(getAdminSecret()).toBeNull();

    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "" }));
    expect(getAdminSecret()).toBeNull();

    withWindow(storage({ [ADMIN_SECRET_STORAGE_KEY]: "   \t  " }));
    expect(getAdminSecret()).toBeNull();
  });

  it("returns null instead of throwing when storage is unavailable", () => {
    const broken = {
      getItem: vi.fn(() => {
        throw new Error("SecurityError: storage is disabled");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    withWindow(broken);
    expect(getAdminSecret()).toBeNull();
  });

  it("returns null during SSR, where there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(getAdminSecret()).toBeNull();
    expect(buildAuthHeaders()).toEqual({});
  });

  it("setAdminSecret returns true and persists the trimmed value", () => {
    withWindow(storage());
    expect(setAdminSecret("  secret  ")).toBe(true);
    expect(getAdminSecret()).toBe("secret");
  });

  it("setAdminSecret returns false when localStorage.setItem throws, and nothing is stored", () => {
    const throwing = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
      removeItem: vi.fn(),
    };
    withWindow(throwing);

    expect(setAdminSecret("secret")).toBe(false);
    // The caller must be able to surface a real error instead of re-prompting.
    expect(getAdminSecret()).toBeNull();
  });

  it("setAdminSecret returns false for an empty or nullish secret", () => {
    withWindow(storage());
    expect(setAdminSecret("")).toBe(false);
    expect(setAdminSecret("   ")).toBe(false);
    expect(setAdminSecret(null as unknown as string)).toBe(false);
    expect(setAdminSecret(undefined as unknown as string)).toBe(false);
  });

  it("setAdminSecret returns false during SSR, where there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(setAdminSecret("secret")).toBe(false);
  });
});
