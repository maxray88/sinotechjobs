import type { NextConfig } from "next";

// Baseline security headers applied to every route.
//
// NOTE: Content-Security-Policy is deliberately NOT set here. Next.js emits
// inline bootstrap scripts and streams inline <script> tags for the App Router,
// so a static CSP blocks the app outright. A correct CSP needs a per-request
// nonce minted in middleware and threaded through as an `x-nonce` header —
// that is separate work, not a header you can paste in. Do not "fix" this by
// adding a static CSP; it will break every page.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Bundle analyzer (optional): install `next-bundle-analyzer` then wrap config as:
  // const withBundleAnalyzer = require("next-bundle-analyzer")({ enabled: process.env.ANALYZE === "true" });
  // export default withBundleAnalyzer(nextConfig);
  // Do NOT add next-bundle-analyzer as a dependency unless explicitly needed for analysis.

  // Keep heavy native/binary deps out of the Edge/server bundle tracing.
  // `serverExternalPackages` is the stable key in Next.js 15+; the superseded
  // `experimental.serverComponentsExternalPackages` is deliberately not set, as
  // Next only reads one of the two and keeping both just invites drift.
  serverExternalPackages: ["puppeteer", "@sparticuz/chromium"],

  // Output file tracing is always on in Next.js 16 and is not toggled by a
  // config key; the previous `outputFileTracing: true` entry was dead config
  // that only existed behind a @ts-expect-error.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
