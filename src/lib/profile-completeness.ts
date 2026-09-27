/**
 * Candidate profile completeness (pure functions).
 *
 * Ported from the design reference profile-completeness.ts.
 * Score = filled fields / (required + optional) fields, 0–100.
 */

import type { CandidateProfile } from './matching';

type CandidateShape = Partial<CandidateProfile> & Record<string, unknown>;

const OPTIONAL_FIELDS = [
  'chinese_university',
  'hometown_province',
  'hsk_level',
  'github_url',
  'portfolio_url',
  'linkedin_url',
  'photo_url',
  'current_company',
  'certificate_urls',
] as const;

const REQUIRED_FIELDS = [
  'full_name',
  'current_location',
  'desired_location',
  'visa_status',
  'focus_area',
  'sub_specializations',
  'years_of_experience',
  'current_role',
  'bio',
  'languages',
  'salary_expectation_min',
  'salary_expectation_max',
  'cv_url',
  'availability',
] as const;

// The single definition of "this field counts toward completeness". BOTH loops
// below must use it. An earlier version had a second, inline copy in the
// optional loop that disagreed with this one -- it skipped plain objects and
// counted any number, including NaN -- so adding a boolean or object field to
// OPTIONAL_FIELDS would have scored the two halves differently.
//
// Booleans count as filled when present: `false` is a deliberate answer to a
// question, not an empty field. The required loop has always scored it that
// way, and unifying on this function is what keeps the two halves in agreement.
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  // Trim before the empty check so a whitespace-only bio ("   ") is not
  // mistaken for a filled one.
  if (typeof value === 'string') return value.trim().length > 0;
  // NaN (and Infinity) are not real answers; a padded profile should not
  // score as complete.
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function computeProfileCompleteness(candidate: CandidateShape): number {
  let filled = 0;
  const total = REQUIRED_FIELDS.length + OPTIONAL_FIELDS.length;

  for (const field of REQUIRED_FIELDS) {
    if (isFilled(candidate[field])) filled++;
  }

  for (const field of OPTIONAL_FIELDS) {
    if (isFilled(candidate[field])) filled++;
  }

  return Math.round((filled / total) * 100);
}

export function getMissingFields(candidate: CandidateShape): string[] {
  const missing: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = candidate[field];
    if (value === null || value === undefined || value === '') {
      missing.push(field);
    } else if (Array.isArray(value) && value.length === 0) {
      missing.push(field);
    } else if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      missing.push(field);
    }
  }

  return missing;
}
