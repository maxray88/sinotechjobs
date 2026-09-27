export type JobField = "ai" | "cs" | "robotics" | "drone" | "remote";
export type JobLocation = "de" | "at" | "ch" | "remote";
export type LanguageLevel = "nice-to-have" | "required" | "fluent";
export type EmploymentType = "full-time" | "part-time" | "internship" | "contract";

/**
 * A job as the application sees it -- a normalized domain shape, NOT a
 * database row.
 *
 * `JobRow` (src/lib/db/types.ts) mirrors 001_init.sql, where `title_zh`,
 * `location`, `description_zh`, `requirements`, `requirements_zh` and `tags`
 * are all nullable. `rowToJob` (src/lib/db/mappers.ts) is the single boundary
 * that coerces those nulls to "" / [], and it deliberately carries no type
 * assertion, so the compiler rejects any change letting a null escape.
 *
 * Consequence: `job.description.slice(0, 80)` is safe for any value that
 * reached this type via `rowToJob` or the scraper's `rawToJob`. Do not add
 * `as Job` / `as unknown as Job` at a new call site -- that reopens the hole.
 */
export interface Job {
  id: string;
  title: string;
  titleZh: string;
  company: string;
  companyZh?: string;
  field: JobField;
  location: string;
  locationCode: JobLocation;
  languageLevel: LanguageLevel;
  employmentType: EmploymentType;
  salaryRange?: string;
  description: string;
  descriptionZh: string;
  requirements: string[];
  requirementsZh: string[];
  tags: string[];
  applicationUrl: string;
  postedDate: string;
  expiresAt?: string;
  isExpired?: boolean;
  remoteFriendly: boolean;
  visaSponsorship: boolean;
  featured?: boolean;
}

export type Language = "en" | "zh" | "de";
