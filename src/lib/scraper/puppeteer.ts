import puppeteer, { type Browser } from "puppeteer";
import chromium from "@sparticuz/chromium";

let browserInstance: Browser | null = null;

export interface PuppeteerOptions {
  waitForSelector?: string;
  waitTimeout?: number;
  scrollDelay?: number;
  extraWaitMs?: number;
}

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  const isVercel = !!process.env.VERCEL;
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isVercel || isLambda) {
    browserInstance = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  } else {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });
  }

  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function renderPage(
  url: string,
  options: PuppeteerOptions = {}
): Promise<string | null> {
  const {
    waitForSelector,
    waitTimeout = 10000,
    scrollDelay = 1000,
    extraWaitMs = 2000,
  } = options;

  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1920, height: 1080 });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
        req.abort();
      } else {
        req.continue();
      }
    });

    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    if (!response || !response.ok()) {
      return null;
    }

    if (waitForSelector) {
      try {
        await page.waitForSelector(waitForSelector, { timeout: waitTimeout });
      } catch {
        // Selector not found, continue anyway
      }
    }

    await autoScroll(page, scrollDelay);

    await delay(extraWaitMs);

    const html = await page.content();
    return html;
  } catch {
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }
}

async function autoScroll(page: import("puppeteer").Page, delayMs: number): Promise<void> {
  await page.evaluate(async (d: number) => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 200;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, d / 10);
    });
  }, delayMs);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderMultiplePages(
  urls: string[],
  options?: PuppeteerOptions
): Promise<(string | null)[]> {
  const results: (string | null)[] = [];
  for (const url of urls) {
    const html = await renderPage(url, options);
    results.push(html);
    await delay(1000);
  }
  return results;
}

export async function isPuppeteerAvailable(): Promise<boolean> {
  try {
    const browser = await getBrowser();
    const pages = await browser.pages();
    return pages.length >= 0;
  } catch {
    return false;
  }
}
