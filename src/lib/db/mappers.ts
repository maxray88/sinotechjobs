import type { JobRow } from "./types";
import type { Job, JobField, JobLocation, LanguageLevel, EmploymentType } from "../types";

// ---------------------------------------------------------------------------
// Mappers: JobRow <-> Job
// ---------------------------------------------------------------------------

export function rowToJob(row: JobRow): Job {
  // No `as Job` here on purpose. 001_init.sql leaves title_zh, location,
  // description_zh, requirements, requirements_zh and tags nullable, so the
  // `??` coercions below are load-bearing -- they are what makes the `Job`
  // type's non-null promises true. An assertion would let someone delete a
  // coercion and still typecheck, turning a guaranteed-safe field into a
  // null-crash for the next caller that writes `job.description.slice(...)`.
  // If you add a field here, coerce it; the return type will check you.
  return {
    id: row.id,
    title: row.title,
    titleZh: row.title_zh ?? row.title,
    company: row.company,
    ...(row.company_zh ? { companyZh: row.company_zh } : {}),
    field: (row.field as JobField) ?? "cs",
    location: row.location ?? "",
    locationCode: (row.location_code as JobLocation) ?? "de",
    languageLevel: (row.language_level as LanguageLevel) ?? "nice-to-have",
    employmentType: (row.employment_type as EmploymentType) ?? "full-time",
    ...(row.salary_range ? { salaryRange: row.salary_range } : {}),
    description: row.description ?? "",
    descriptionZh: row.description_zh ?? row.description ?? "",
    requirements: row.requirements ?? [],
    requirementsZh: row.requirements_zh ?? [],
    tags: row.tags ?? [],
    applicationUrl: row.application_url,
    postedDate:
      row.posted_date ??
      (row.created_at ? row.created_at.split("T")[0] : new Date().toISOString().split("T")[0]),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    isExpired: row.is_expired ?? false,
    remoteFriendly: row.remote_friendly ?? false,
    visaSponsorship: row.visa_sponsorship ?? false,
    featured: row.featured ?? false,
  };
}

export function jobToRow(job: Job): JobRow {
  // Job may not have sourceUrl / tier / source / sourceId / featuredUntil / expiresAt
  const extended = job as Job & {
    sourceUrl?: string;
    source?: string;
    sourceId?: string;
    tier?: string;
    featuredUntil?: string | null;
  };
  return {
    id: job.id,
    title: job.title,
    title_zh: job.titleZh ?? job.title,
    company: job.company,
    company_zh: job.companyZh ?? null,
    field: job.field ?? null,
    location: job.location ?? null,
    location_code: job.locationCode ?? null,
    language_level: job.languageLevel ?? null,
    employment_type: job.employmentType ?? null,
    salary_range: job.salaryRange ?? null,
    description: job.description ?? "",
    description_zh: job.descriptionZh ?? null,
    requirements: job.requirements ?? [],
    requirements_zh: job.requirementsZh ?? [],
    tags: job.tags ?? [],
    application_url: job.applicationUrl,
    // Store applicationUrl as source_url for deduplication if sourceUrl not present
    source_url: extended.sourceUrl ?? job.applicationUrl ?? null,
    posted_date: job.postedDate ?? null,
    expires_at: job.expiresAt ?? null,
    is_expired: job.isExpired ?? null,
    remote_friendly: job.remoteFriendly ?? null,
    visa_sponsorship: job.visaSponsorship ?? null,
    featured: job.featured ?? null,
    featured_until: extended.featuredUntil ?? null,
    tier: extended.tier ?? null,
    source: extended.source ?? null,
    source_id: extended.sourceId ?? null,
    created_at: null,
    updated_at: null,
  };
}

// Alias exports for testing convenience
export const mapRowToJob = rowToJob;
export const mapJobToRow = jobToRow;
