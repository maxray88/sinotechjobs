/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Only the Chromium binding is replaced. renderPage/getBrowser/closeBrowser are
// the real shipping code under test here.
const launch = vi.fn();
vi.mock("puppeteer", () => ({ default: { launch: (...args: unknown[]) => launch(...args) } }));
vi.mock("@sparticuz/chromium", () => ({
  default: { args: ["--no-sandbox"], executablePath: async () => "/tmp/chromium" },
}));

import { closeBrowser, getBrowser, renderPage } from "@/lib/scraper/puppeteer";

type FakePage = {
  setUserAgent: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  setRequestInterception: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makePage(html: string): FakePage {
  return {
    setUserAgent: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    setRequestInterception: vi.fn(async () => {}),
    on: vi.fn(),
    goto: vi.fn(async () => ({ ok: () => true })),
    waitForSelector: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
    content: vi.fn(async () => html),
    close: vi.fn(async () => {}),
  };
}

function makeBrowser(page: FakePage) {
  return {
    connected: true,
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
    pages: vi.fn(async () => [page]),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const PAGE_HTML = "<html><body><h1>Jobs</h1></body></html>";

describe("renderPage — abort handling around Chromium startup", () => {
  beforeEach(() => {
    // launch is a module-level mock shared by every test in this file, so its
    // call counter has to be scoped to the test that makes the assertion.
    launch.mockClear();
  });

  afterEach(async () => {
    // Drop the module-level browser singleton so the next test cold-starts.
    await closeBrowser();
    vi.restoreAllMocks();
  });

  it("resolves null without opening a page when the signal is already aborted", async () => {
    const page = makePage(PAGE_HTML);
    const browser = makeBrowser(page);
    launch.mockResolvedValue(browser);
    const controller = new AbortController();
    controller.abort();

    const html = await renderPage("https://example.com/jobs", {}, controller.signal);

    expect(html).toBeNull();
    // The first guard fires, so Chromium is never even launched.
    expect(launch).not.toHaveBeenCalled();
    expect(browser.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("resolves null without opening a page when the abort lands during getBrowser()", async () => {
    const page = makePage(PAGE_HTML);
    const browser = makeBrowser(page);
    // Assigned synchronously by the promise executor below; the throwing
    // default exists only so the variable keeps a callable type (TS would
    // otherwise narrow it to null and reject the later call).
    let releaseLaunch: () => void = () => {
      throw new Error("getBrowser() never launched Chromium");
    };
    launch.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseLaunch = () => resolve(browser);
        })
    );
    const controller = new AbortController();

    const pending = renderPage("https://example.com/jobs", {}, controller.signal);
    // A cold start is the slowest step; the cron deadline expires inside it.
    controller.abort();
    releaseLaunch();

    await expect(pending).resolves.toBeNull();
    // The regression: the old code registered an abort listener on an
    // already-aborted signal (which per spec never fires), so goto() ran the
    // full 30s timeout and the caller got nothing until then.
    expect(browser.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("resolves null without calling goto when the abort lands during newPage()", async () => {
    const page = makePage(PAGE_HTML);
    // Assigned by newPage()'s promise executor after the flush() below; the
    // throwing default exists only so the variable keeps a callable type (TS
    // would otherwise narrow it to null and reject the later call).
    let releaseNewPage: () => void = () => {
      throw new Error("newPage() was never called");
    };
    const browser = {
      connected: true,
      newPage: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseNewPage = () => resolve(page);
          })
      ),
      close: vi.fn(async () => {}),
      pages: vi.fn(async () => [page]),
    };
    launch.mockResolvedValue(browser);
    const controller = new AbortController();

    const pending = renderPage("https://example.com/jobs", {}, controller.signal);
    await flush();
    controller.abort();
    releaseNewPage();

    await expect(pending).resolves.toBeNull();
    expect(page.goto).not.toHaveBeenCalled();
    // The half-created page is still cleaned up on the way out.
    expect(page.close).toHaveBeenCalled();
  });

  it("renders and returns the HTML when no abort is requested", async () => {
    const page = makePage(PAGE_HTML);
    const browser = makeBrowser(page);
    launch.mockResolvedValue(browser);

    const html = await renderPage(
      "https://example.com/jobs",
      { extraWaitMs: 0, scrollDelay: 0 },
      new AbortController().signal
    );

    // Guards against an over-eager check turning every render into a no-op.
    expect(html).toBe(PAGE_HTML);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith("https://example.com/jobs", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
  });

  it("renders and returns the HTML when no signal is passed at all", async () => {
    const page = makePage(PAGE_HTML);
    launch.mockResolvedValue(makeBrowser(page));

    const html = await renderPage("https://example.com/jobs", { extraWaitMs: 0, scrollDelay: 0 });

    expect(html).toBe(PAGE_HTML);
  });

  it("closes the page and returns null when the signal aborts mid-goto", async () => {
    const page = makePage(PAGE_HTML);
    let rejectGoto: ((reason: unknown) => void) | null = null;
    page.goto.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectGoto = reject;
        })
    );
    // Puppeteer surfaces an aborted navigation by rejecting goto.
    page.close.mockImplementation(async () => {
      rejectGoto?.(new Error("Target closed"));
    });
    launch.mockResolvedValue(makeBrowser(page));
    const controller = new AbortController();

    const pending = renderPage("https://example.com/jobs", {}, controller.signal);
    await flush();
    controller.abort();

    await expect(pending).resolves.toBeNull();
    // Aborting is expressed as closing the page, so Chromium is freed at once
    // instead of staying busy until its own 30s timeout.
    expect(page.close).toHaveBeenCalled();
  });

  it("resolves null on a non-2xx response", async () => {
    const page = makePage(PAGE_HTML);
    page.goto.mockResolvedValue({ ok: () => false } as any);
    launch.mockResolvedValue(makeBrowser(page));

    const html = await renderPage(
      "https://example.com/jobs",
      { extraWaitMs: 0 },
      new AbortController().signal
    );

    expect(html).toBeNull();
  });

  it("reuses a connected browser instead of relaunching Chromium", async () => {
    const page = makePage(PAGE_HTML);
    const browser = makeBrowser(page);
    launch.mockResolvedValue(browser);

    // Count only this test's launches, not the six cold starts before it.
    launch.mockClear();
    const first = await getBrowser();
    const second = await getBrowser();

    expect(second).toBe(first);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
