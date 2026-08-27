#!/bin/bash
set -e
echo "=== Build size report ==="
npm run build 2>&1 | tail -20
echo "--- .next size ---"
du -sh .next 2>&1 | head -5
echo "--- Puppeteer / chromium size ---"
du -sh node_modules/puppeteer 2>&1 | head -3
du -sh node_modules/@sparticuz/chromium 2>&1 | head -3
echo "--- Vercel function size estimate ---"
du -sh .vercel/output 2>&1 | head -3 || echo "no .vercel/output (run vercel build for estimate)"
