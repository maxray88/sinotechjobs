import type { Job } from "@/lib/types";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "full-time": "FULL_TIME",
  "part-time": "PART_TIME",
  internship: "INTERN",
  contract: "CONTRACTOR",
};

export function buildJobPostingJsonLd(job: Job): object {
  const j = job as unknown as Record<string, unknown>;

  const descriptionRaw =
    (j["description"] as string | undefined) ?? "";
  const title = (j["title"] as string | undefined) ?? "";
  const company = (j["company"] as string | undefined) ?? "";
  const jobId = (j["id"] as string | undefined) ?? "";

  const postedDate =
    (j["posted_date"] as string | undefined) ??
    (j["postedDate"] as string | undefined) ??
    (j["created_at"] as string | undefined) ??
    (j["createdAt"] as string | undefined) ??
    new Date().toISOString().split("T")[0];

  const validThrough =
    (j["featured_until"] as string | undefined) ??
    (j["featuredUntil"] as string | undefined) ??
    undefined;

  const employmentTypeRaw =
    (j["employment_type"] as string | undefined) ??
    (j["employmentType"] as string | undefined);
  const employmentType = employmentTypeRaw
    ? (EMPLOYMENT_TYPE_MAP[employmentTypeRaw] ?? employmentTypeRaw)
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

  const salaryRange =
    (j["salary_range"] as string | undefined) ??
    (j["salaryRange"] as string | undefined);

  // Build base object; omit undefined fields via conditional spreads
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title,
    description: stripHtml(descriptionRaw).slice(0, 5000),
    datePosted: postedDate,
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
            addressCountry: (locationCode || "de").toUpperCase(),
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
    ...(salaryRange
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "EUR",
            value: {
              "@type": "QuantitativeValue",
              value: salaryRange,
            },
          },
        }
      : {}),
    directApply: true,
    url: `https://sinotechjobs.vercel.app/jobs/${jobId}`,
  };

  return jsonLd;
}
