/**
 * Job posting + candidate profile validation (pure functions).
 *
 * Ported from the design reference validation.ts, adapted to local types:
 * - salary is mandatory (salary_min > 0, max >= min when present)
 * - employer accounts must use a company email (free providers rejected)
 * - candidate HSK level must be 1-6, bio capped at 500 chars
 *
 * These are BOUNDARY validators: callers hand them a parsed JSON body, so every
 * field is attacker-controlled and the declared TypeScript types are not a
 * runtime guarantee. Every field is therefore `typeof`-checked before it is
 * measured, so a wrong-typed field (`{"title": 123}`, `hsk_level: "3"`) yields a
 * validation ERROR instead of a thrown TypeError that would surface as a 500.
 *
 * On success the returned `normalized` object carries the trimmed, length-capped
 * and URL-normalised values. Callers must persist THAT, not the raw input.
 */

import { safeExternalUrl } from "@/lib/safe-url";

export interface JobPostingInput {
  title?: string | null;
  description?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  focus_area?: string | null;
  location?: string | null;
  is_remote?: boolean;
  application_type?: string | null;
  external_application_url?: string | null;
}

export interface CandidateProfileInput {
  full_name?: string | null;
  focus_area?: string | null;
  headline?: string | null;
  salary_expectation_min?: number | null;
  salary_expectation_max?: number | null;
  bio?: string | null;
  hsk_level?: number | null;
}

/**
 * Per-field character caps.
 *
 * Every text column in `db/migrations/001..006` is an unbounded `TEXT` — there
 * is no `varchar(n)`, no `char(n)` and no length `CHECK` on any of them, so the
 * database enforces nothing and these caps are the only bound on stored size
 * (and therefore on email size for the approval / digest mailers). The numbers
 * match what the UI and the mail templates can actually render: a 20k
 * description still fits an HTML body, a 200-char title still fits a subject.
 */
const FIELD_LIMITS = {
  title: 200,
  description: 20_000,
  location: 120,
  focus_area: 120,
  application_type: 64,
  external_application_url: 2_000,
  full_name: 120,
  headline: 200,
  bio: 500,
} as const;

/**
 * C0 controls and DEL, EXCLUDING TAB (0x09) and LF (0x0A) — those two are
 * legitimate inside prose (descriptions and bios are multi-line text areas) and
 * `\r` (0x0D) is normalised away before this runs, so a stored value can never
 * carry a bare CR to pair with the LF. What remains is rejected: NUL breaks
 * Postgres text handling and downstream consumers, and the rest can terminate
 * or forge a line in the plain-text mailer.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Every C0 control plus DEL, for values that must stay on a single line (they
 * end up in a mail `Subject`, a breadcrumb or a column formatted for one line).
 */
const CONTROL_CHARS_SINGLE_LINE = /[\u0000-\u001F\u007F]/;

type StringCheck =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Type-check, normalise and cap a single string field. Returns `value: null`
 * for an absent or blank field that was not required; the trimmed string
 * otherwise. Never throws, whatever it is handed.
 */
function checkStringField(
  raw: unknown,
  opts: { label: string; maxLength: number; required?: boolean; multiline?: boolean },
): StringCheck {
  const { label, maxLength, required = false, multiline = false } = opts;

  if (raw === undefined || raw === null) {
    return required ? { ok: false, error: `${label} is required` } : { ok: true, value: null };
  }

  if (typeof raw !== "string") {
    return { ok: false, error: `${label} must be a string` };
  }

  // CRLF -> LF for prose only, so a Windows text area is not rejected for a
  // line ending that carries no injection risk on its own. Single-line fields
  // are left alone: their CR/LF are rejected by the control check below.
  const value = (multiline ? raw.replace(/\r\n?/g, "\n") : raw).trim();

  if (value.length === 0) {
    return required ? { ok: false, error: `${label} is required` } : { ok: true, value: null };
  }

  const control = multiline ? CONTROL_CHARS : CONTROL_CHARS_SINGLE_LINE;
  if (control.test(value)) {
    return { ok: false, error: `${label} must not contain control characters` };
  }

  if (value.length > maxLength) {
    return { ok: false, error: `${label} must not exceed ${maxLength} characters` };
  }

  return { ok: true, value };
}

type NumberCheck =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Reject non-numbers and non-finite numbers. `1e400` in a JSON body parses to
 * `Infinity`, which passes every `> 0` and `<=` comparison, so the finite check
 * is load-bearing rather than defensive decoration.
 */
function checkFiniteNumber(raw: unknown, label: string): NumberCheck {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, error: `${label} must be a finite number` };
  }
  return { ok: true, value: raw };
}

export function validateSalaryRange(
  salaryMin: number,
  salaryMax: number | null | undefined,
): { valid: boolean; error: string | null } {
  if (!salaryMin || salaryMin <= 0) {
    return {
      valid: false,
      error: 'Minimum salary is required and must be greater than 0',
    };
  }

  if (salaryMax !== null && salaryMax !== undefined && salaryMax < salaryMin) {
    return {
      valid: false,
      error: 'Maximum salary cannot be less than minimum salary',
    };
  }

  return { valid: true, error: null };
}

export function validateJobPosting(job: Partial<JobPostingInput>): {
  valid: boolean;
  errors: string[];
  normalized: Partial<JobPostingInput>;
} {
  const errors: string[] = [];
  const normalized: Partial<JobPostingInput> = {};

  const title = checkStringField(job.title, {
    label: 'Job title',
    maxLength: FIELD_LIMITS.title,
    required: true,
  });
  if (title.ok) {
    if (title.value !== null) normalized.title = title.value;
  } else {
    errors.push(title.error);
  }

  const description = checkStringField(job.description, {
    label: 'Job description',
    maxLength: FIELD_LIMITS.description,
    required: true,
    multiline: true,
  });
  if (description.ok) {
    if (description.value !== null) normalized.description = description.value;
  } else {
    errors.push(description.error);
  }

  // is_remote gates whether location is required, so it must be a real boolean:
  // a truthy "false" would otherwise wave through a posting with no location.
  const isRemote =
    job.is_remote === undefined || job.is_remote === null
      ? false
      : typeof job.is_remote === "boolean"
        ? job.is_remote
        : null;
  if (isRemote === null) {
    errors.push('Remote flag must be a boolean');
  } else {
    normalized.is_remote = isRemote;
  }

  const salaryMin = checkFiniteNumber(job.salary_min, 'Minimum salary');
  if (!salaryMin.ok) {
    errors.push(salaryMin.error);
  }
  const salaryMax = checkFiniteNumber(job.salary_max, 'Maximum salary');
  if (!salaryMax.ok) {
    errors.push(salaryMax.error);
  }
  if (salaryMin.ok && salaryMax.ok) {
    const salaryValidation = validateSalaryRange(salaryMin.value ?? 0, salaryMax.value);
    if (!salaryValidation.valid) {
      errors.push(salaryValidation.error!);
    }
  }

  const focusArea = checkStringField(job.focus_area, {
    label: 'Focus area',
    maxLength: FIELD_LIMITS.focus_area,
    required: true,
  });
  if (focusArea.ok) {
    if (focusArea.value !== null) normalized.focus_area = focusArea.value;
  } else {
    errors.push(focusArea.error);
  }

  // Location is validated whenever it is present (it is persisted and rendered
  // either way) but only REQUIRED when the posting is not remote.
  const location = checkStringField(job.location, {
    label: 'Location',
    maxLength: FIELD_LIMITS.location,
  });
  if (!location.ok) {
    errors.push(location.error);
  } else {
    if (location.value !== null) normalized.location = location.value;
    if (location.value === null && isRemote === false) {
      errors.push('Location is required for non-remote jobs');
    }
  }

  const applicationType = checkStringField(job.application_type, {
    label: 'Application type',
    maxLength: FIELD_LIMITS.application_type,
  });
  if (!applicationType.ok) {
    errors.push(applicationType.error);
  } else if (applicationType.value !== null) {
    normalized.application_type = applicationType.value;
  }

  // external_application_url is an href sink: it is rendered into an anchor, so
  // `javascript:` / `data:` / `vbscript:` here is a stored XSS. Presence alone
  // was never sufficient. `safeExternalUrl` is the repo's single allowlist for
  // externally-ingested hrefs (added for scraped job URLs, used by
  // JobDetailClient); it rejects those schemes but does not parse, so parse
  // here as well: a malformed URL becomes an error, and the NORMALISED form is
  // what gets persisted, not the raw string.
  const externalUrl = checkStringField(job.external_application_url, {
    label: 'External application URL',
    maxLength: FIELD_LIMITS.external_application_url,
  });
  let hasExternalUrl = false;
  if (!externalUrl.ok) {
    errors.push(externalUrl.error);
  } else if (externalUrl.value !== null) {
    hasExternalUrl = true;
    const schemeOk = safeExternalUrl(externalUrl.value);
    let parsed: URL | null = null;
    try {
      parsed = schemeOk === null ? null : new URL(schemeOk);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      errors.push('External application URL must be a valid http(s) URL');
    } else {
      normalized.external_application_url = parsed.toString();
    }
  }

  if (applicationType.ok && applicationType.value === 'external' && !hasExternalUrl) {
    errors.push('External application URL is required for external applications');
  }

  return { valid: errors.length === 0, errors, normalized };
}

export function validateCandidateProfile(profile: Partial<CandidateProfileInput>): {
  valid: boolean;
  errors: string[];
  normalized: Partial<CandidateProfileInput>;
} {
  const errors: string[] = [];
  const normalized: Partial<CandidateProfileInput> = {};

  const fullName = checkStringField(profile.full_name, {
    label: 'Full name',
    maxLength: FIELD_LIMITS.full_name,
    required: true,
  });
  if (fullName.ok) {
    if (fullName.value !== null) normalized.full_name = fullName.value;
  } else {
    errors.push(fullName.error);
  }

  const focusArea = checkStringField(profile.focus_area, {
    label: 'Focus area',
    maxLength: FIELD_LIMITS.focus_area,
    required: true,
  });
  if (focusArea.ok) {
    if (focusArea.value !== null) normalized.focus_area = focusArea.value;
  } else {
    errors.push(focusArea.error);
  }

  // `headline` was absent from this interface even though candidate_profiles has
  // a headline TEXT column (003_candidate_features.sql) — it was therefore
  // completely unvalidated. Added here so it is capped like every other field.
  const headline = checkStringField(profile.headline, {
    label: 'Headline',
    maxLength: FIELD_LIMITS.headline,
  });
  if (!headline.ok) {
    errors.push(headline.error);
  } else if (headline.value !== null) {
    normalized.headline = headline.value;
  }

  const min = checkFiniteNumber(profile.salary_expectation_min, 'Minimum salary expectation');
  if (!min.ok) {
    errors.push(min.error);
  }
  const max = checkFiniteNumber(profile.salary_expectation_max, 'Maximum salary expectation');
  if (!max.ok) {
    errors.push(max.error);
  }
  if (min.ok && max.ok) {
    const minValue = min.value;
    const maxValue = max.value;
    if (minValue !== null && maxValue !== null && maxValue > 0 && minValue > maxValue) {
      errors.push('Minimum salary expectation cannot exceed maximum');
    }
  }

  const bio = checkStringField(profile.bio, {
    label: 'Bio',
    maxLength: FIELD_LIMITS.bio,
    multiline: true,
  });
  if (!bio.ok) {
    errors.push(bio.error);
  } else if (bio.value !== null) {
    normalized.bio = bio.value;
  }

  // hsk_level must be a whole number: "3" and 3.5 both slipped through the old
  // bare range check, because relational operators coerce rather than throw.
  if (profile.hsk_level !== undefined && profile.hsk_level !== null) {
    if (typeof profile.hsk_level !== 'number' || !Number.isInteger(profile.hsk_level)) {
      errors.push('HSK level must be a whole number');
    } else if (profile.hsk_level < 1 || profile.hsk_level > 6) {
      errors.push('HSK level must be between 1 and 6');
    } else {
      normalized.hsk_level = profile.hsk_level;
    }
  }

  return { valid: errors.length === 0, errors, normalized };
}

const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  '163.com',
  'qq.com',
  '126.com',
  'foxmail.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
];

/**
 * Strict single-address shape, mirroring RECIPIENT_REGEX in `src/lib/email.ts`
 * (added when the admin approval route was hardened). It is duplicated rather
 * than imported because `email.ts` is marked `server-only` and pulls in Resend:
 * importing it here would make this pure validator unusable from a client
 * component. The `@` is explicitly excluded from both halves, which is what
 * makes `user@x@gmail.com` invalid instead of merely unusual.
 */
const EMAIL_REGEX = /^[^\s@,\r\n]+@[^\s@,\r\n]+\.[^\s@,\r\n]+$/;

export function isCompanyEmail(email: string): boolean {
  if (typeof email !== "string") return false;

  const trimmed = email.trim();
  if (!EMAIL_REGEX.test(trimmed)) return false;

  // The domain is the LAST segment, not `split('@')[1]`. The regex above already
  // guarantees exactly one unquoted @, so the two are equivalent — but popping
  // is what actually defeats `user@x@gmail.com`, which the old `[1]` reduced to
  // the domain `x` and let through as a company address.
  const domain = trimmed.split('@').pop()!.toLowerCase();
  return !FREE_EMAIL_DOMAINS.includes(domain);
}

export function validateEmailDomain(email: string): {
  valid: boolean;
  error: string | null;
} {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (!isCompanyEmail(email)) {
    return {
      valid: false,
      error: 'Please use a company email address. Free email providers are not accepted for employer accounts.',
    };
  }

  return { valid: true, error: null };
}
