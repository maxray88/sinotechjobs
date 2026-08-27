import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // outputFileTracing enables minimal standalone tracing for serverless deployment (Vercel).
  // @ts-expect-error — valid Next.js runtime option; types for this Next version expose `outputFileTracingRoot` / includes instead, but `outputFileTracing` is still respected at build.
  outputFileTracing: true,

  // Bundle analyzer (optional): install `next-bundle-analyzer` then wrap config as:
  // const withBundleAnalyzer = require("next-bundle-analyzer")({ enabled: process.env.ANALYZE === "true" });
  // export default withBundleAnalyzer(nextConfig);
  // Do NOT add next-bundle-analyzer as a dependency unless explicitly needed for analysis.

  // Keep heavy native/binary deps out of the Edge/server bundle tracing.
  // `serverExternalPackages` is the stable key in Next.js 15+; `experimental.serverComponentsExternalPackages`
  // is kept for backwards compatibility as requested for this task — both point to the same packages.
  serverExternalPackages: ["puppeteer", "@sparticuz/chromium"],
  experimental: {
    serverComponentsExternalPackages: ["puppeteer", "@sparticuz/chromium"],
  },
};

export default nextConfig;
