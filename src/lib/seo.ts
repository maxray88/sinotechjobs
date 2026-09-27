import type { Job } from "@/lib/types";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Serialise an object for embedding inside a <script> block.
 * JSON.stringify escapes quotes and backslashes but NOT `<`, `>` or `&`, and the
 * HTML parser terminates a script element at the first `</script` regardless of
 * JS string context. Escaping those three as \uXXXX keeps the output valid JSON
 * (the browser parses it back to the original string) while making script-block
 * breakout impossible.
 */
export function jsonLdScriptContent(obj: unknown): string {
  return JSON.stringify(obj).replace(
    /[<>&]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "full-time": "FULL_TIME",
  fulltime: "FULL_TIME",
  "full time": "FULL_TIME",
  permanent: "FULL_TIME",
  "part-time": "PART_TIME",
  parttime: "PART_TIME",
  "part time": "PART_TIME",
  internship: "INTERN",
  intern: "INTERN",
  contract: "CONTRACTOR",
  contractor: "CONTRACTOR",
  temporary: "TEMPORARY",
  freelance: "FREELANCE",
};

/** Collapse separators so "Full Time", "full_time" and "full-time " all match. */
function normalizeEmploymentType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "CNY",
  "￥": "CNY",
  "₣": "CHF",
};

function detectCurrency(text: string): string | null {
  const code = text.match(
    /\b(EUR|USD|GBP|CHF|CNY|RMB|CAD|AUD|SEK|NOK|DKK|PLN|JPY)\b/i,
  );
  if (code) {
    const upper = code[1].toUpperCase();
    return upper === "RMB" ? "CNY" : upper;
  }
  const symbol = text.match(/[€$£¥￥₣]/);
  return symbol ? CURRENCY_BY_SYMBOL[symbol[0]] ?? null : null;
}

/**
 * Turn "50.000 - 60.000 €" / "€50,000-60,000" into numbers. Handles both
 * European (1.234.567,89) and Anglo (1,234,567.89) grouping, since scraped
 * salary strings mix them freely.
 */
function parseAmount(raw: string): number | null {
  const token = raw.trim();
  if (!/^\d/.test(token)) return null;

  const commas = (token.match(/,/g) ?? []).length;
  const dots = (token.match(/\./g) ?? []).length;
  let normalized: string;

  if (commas > 0 && dots > 0) {
    // Whichever separator comes last is the decimal point; the rest group.
    const decimalAt = Math.max(token.lastIndexOf(","), token.lastIndexOf("."));
    normalized =
      token.slice(0, decimalAt).replace(/[.,]/g, "") + "." + token.slice(decimalAt + 1);
  } else if (commas > 0 || dots > 0) {
    const separator = commas > 0 ? "," : ".";
    const count = commas > 0 ? commas : dots;
    const parts = token.split(separator);
    normalized =
      count === 1 && parts[1]?.length === 3
        ? parts.join("") // "50.000" -> thousands grouping
        : parts.join("."); // "50.5" -> genuine decimal
  } else {
    normalized = token;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * All-or-nothing: returns null unless BOTH a min and a max AND a currency can
 * be read. A half-parsed range is worse than no salary markup at all, because
 * Google trusts whatever numbers we publish.
 */
function parseSalaryRange(
  range: string,
): { currency: string; minValue: number; maxValue: number; unitText: string } | null {
  const text = range.trim();
  if (!text) return null;

  const amounts = (text.match(/\d[\d.,]*/g) ?? [])
    .map(parseAmount)
    .filter((value): value is number => value !== null);
  if (amounts.length < 2) return null;

  const currency = detectCurrency(text);
  if (!currency) return null;

  const unitText =
    /\b(monat(e|lich)?|monthly|per\s+month|mtl)\b/i.test(text) ? "MONTH" : "YEAR";

  return {
    currency,
    minValue: Math.min(...amounts),
    maxValue: Math.max(...amounts),
    unitText,
  };
}

export function buildJobPostingJsonLd(job: Job): object {
  const j = job as unknown as Record<string, unknown>;

  const descriptionRaw =
    (j["description"] as string | undefined) ?? "";
  const company = (j["company"] as string | undefined) ?? "";
  const jobId = (j["id"] as string | undefined) ?? "";

  // `title` and `description` are both REQUIRED JobPosting properties: Google
  // discards the entire rich result when either is present but empty. An
  // untitled job falls back to the company name, and either key is omitted
  // outright when there is genuinely nothing to say — never emitted as "".
  const title =
    ((j["title"] as string | undefined) ?? "").trim() || company.trim();
  const description = stripHtml(descriptionRaw).trim().slice(0, 5000);

  const postedDate =
    (j["posted_date"] as string | undefined) ??
    (j["postedDate"] as string | undefined) ??
    (j["created_at"] as string | undefined) ??
    (j["createdAt"] as string | undefined);
  // No fallback to `new Date()`: a page-render date would report an expired
  // listing as brand new to crawlers and defeat the soft-expiry logic. Only
  // emit a date we can actually source.

  const validThrough =
    (j["featured_until"] as string | undefined) ??
    (j["featuredUntil"] as string | undefined) ??
    undefined;

  const employmentTypeRaw =
    (j["employment_type"] as string | undefined) ??
    (j["employmentType"] as string | undefined);
  // An unmapped value ("freelance", "Full Time", "full-time ") would otherwise
  // pass through raw as an invalid schema.org enum, which flags the whole
  // JobPosting. "OTHER" is a valid enum member and states nothing false.
  const employmentType = employmentTypeRaw
    ? (EMPLOYMENT_TYPE_MAP[normalizeEmploymentType(employmentTypeRaw)] ?? "OTHER")
    : undefined;

  const applicationUrl =
    (j["application_url"] as string | undefined) ??
    (j["applicationUrl"] as string | undefined);

  const remoteFriendly =
    (j["remote_friendly"] as boolean | undefined) ??
    (j["remoteFriendly"] as boolean | undefined) ??
    false;

  const location = (j["location"] as string | undefined) ?? "";

  const locationCode =
    (j["location_code"] as string | undefined) ??
    (j["locationCode"] as string | undefined) ??
    "de";

  // A scraped "germany" or "berlin, de" upper-cases to "GERMANY" / "BERLIN,
 // DE", neither of which is a valid ISO 3166-1 alpha-2 code, and an invalid
  // addressCountry invalidates the enclosing Place.
  const trimmedLocationCode = locationCode.trim();
  const addressCountry = /^[a-z]{2}$/i.test(trimmedLocationCode)
    ? trimmedLocationCode.toUpperCase()
    : "DE";

  const salaryRange =
    (j["salary_range"] as string | undefined) ??
    (j["salaryRange"] as string | undefined);

  const salary = salaryRange ? parseSalaryRange(salaryRange) : null;

  // Build base object; omit undefined fields via conditional spreads
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(postedDate ? { datePosted: postedDate } : {}),
    ...(validThrough ? { validThrough } : {}),
    ...(employmentType ? { employmentType } : {}),
    hiringOrganization: {
      "@type": "Organization",
      name: company,
      sameAs: applicationUrl,
    },
    jobLocation: remoteFriendly
      ? {
          "@type": "Place",
          address: { addressCountry: "DE", addressRegion: "Remote" },
        }
      : {
          "@type": "Place",
          address: {
            addressLocality: location,
            addressCountry,
          },
        },
    ...(remoteFriendly
      ? {
          applicantLocationRequirements: {
            "@type": "Country",
            name: "Germany",
          },
        }
      : {}),
    ...(salary
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: salary.currency,
            value: {
              "@type": "QuantitativeValue",
              minValue: salary.minValue,
              maxValue: salary.maxValue,
              unitText: salary.unitText,
            },
          },
        }
      : {}),
    directApply: true,
    url: `https://sinotechjobs.vercel.app/jobs/${jobId}`,
  };

  return jsonLd;
}
