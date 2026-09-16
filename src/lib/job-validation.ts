/**
 * Job posting + candidate profile validation (pure functions).
 *
 * Ported from the design reference validation.ts, adapted to local types:
 * - salary is mandatory (salary_min > 0, max >= min when present)
 * - employer accounts must use a company email (free providers rejected)
 * - candidate HSK level must be 1–6, bio capped at 500 chars
 */

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
  salary_expectation_min?: number | null;
  salary_expectation_max?: number | null;
  bio?: string | null;
  hsk_level?: number | null;
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
} {
  const errors: string[] = [];

  if (!job.title || job.title.trim().length === 0) {
    errors.push('Job title is required');
  }

  if (!job.description || job.description.trim().length === 0) {
    errors.push('Job description is required');
  }

  const salaryValidation = validateSalaryRange(job.salary_min ?? 0, job.salary_max);
  if (!salaryValidation.valid) {
    errors.push(salaryValidation.error!);
  }

  if (!job.focus_area) {
    errors.push('Focus area is required');
  }

  if (!job.location && !job.is_remote) {
    errors.push('Location is required for non-remote jobs');
  }

  if (job.application_type === 'external' && !job.external_application_url) {
    errors.push('External application URL is required for external applications');
  }

  return { valid: errors.length === 0, errors };
}

export function validateCandidateProfile(profile: Partial<CandidateProfileInput>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!profile.full_name || profile.full_name.trim().length === 0) {
    errors.push('Full name is required');
  }

  if (!profile.focus_area) {
    errors.push('Focus area is required');
  }

  if (
    profile.salary_expectation_min !== undefined &&
    profile.salary_expectation_max !== undefined &&
    profile.salary_expectation_min !== null &&
    profile.salary_expectation_max !== null &&
    profile.salary_expectation_max > 0 &&
    profile.salary_expectation_min > profile.salary_expectation_max
  ) {
    errors.push('Minimum salary expectation cannot exceed maximum');
  }

  if (profile.bio && profile.bio.length > 500) {
    errors.push('Bio must not exceed 500 characters');
  }

  if (
    profile.hsk_level !== undefined &&
    profile.hsk_level !== null &&
    (profile.hsk_level < 1 || profile.hsk_level > 6)
  ) {
    errors.push('HSK level must be between 1 and 6');
  }

  return { valid: errors.length === 0, errors };
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

export function isCompanyEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.includes(domain);
}

export function validateEmailDomain(email: string): {
  valid: boolean;
  error: string | null;
} {
  if (!email || !email.includes('@')) {
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
