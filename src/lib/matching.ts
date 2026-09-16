/**
 * Candidate–job matching engine (pure functions, no I/O, no Supabase).
 *
 * Ported from the design reference matching.ts, adapted to this repo:
 * - Local adapter types (CandidateProfile / JobCriteria) replace '@/types'.
 * - `adaptJob()` bridges the local `Job` type (src/lib/types.ts) to JobCriteria.
 * - Field vocabulary mapping: ai→ai_ml, drone→drones_uav (design taxonomy).
 *
 * Algorithm: 4 hard filters (focus area, visa, language, location) gate
 * 8 weighted soft scores; alert thresholds at 85 (immediate) / 70 (digest).
 */

import type { Job, JobField } from './types';

export type FocusArea = 'cs' | 'ai_ml' | 'robotics' | 'drones_uav' | 'remote';

export type VisaStatus =
  | 'eu_citizen'
  | 'work_permit_unrestricted'
  | 'work_permit_restricted'
  | 'needs_sponsorship'
  | 'student_visa';

export interface CandidateProfile {
  id: string;
  full_name: string;
  current_location: string;
  desired_location: string[];
  visa_status: VisaStatus;
  focus_area: FocusArea;
  sub_specializations: string[];
  years_of_experience: number;
  current_role: string;
  bio: string;
  languages: Record<string, string>;
  hsk_level: number | null;
  salary_expectation_min: number;
  salary_expectation_max: number;
  chinese_university: string | null;
  hometown_province: string | null;
  profile_completeness: number;
  last_active_at: string | null;
}

export interface JobCriteria {
  id: string;
  focus_area: FocusArea;
  sub_specializations: string[];
  required_languages: Record<string, string>;
  visa_sponsorship: boolean;
  salary_min: number;
  salary_max: number | null;
  location: string;
  is_remote: boolean;
}

export interface MatchResult {
  score: number;
  reasons: string[];
  hardFilterPass: boolean;
}

export interface ScorePart {
  score: number;
  reason: string | null;
}

export const CEFR_LEVEL_ORDER: Record<string, number> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
  native: 7,
};

const FIELD_MAP: Record<JobField, FocusArea> = {
  ai: 'ai_ml',
  cs: 'cs',
  robotics: 'robotics',
  drone: 'drones_uav',
  remote: 'remote',
};

/** Parse salary strings like "€60k–€80k", "60000-80000", "80k" into numbers (EUR). */
export function parseSalaryRange(input: string): { min: number; max: number | null } | null {
  const normalized = input.replace(/[€\s,]/g, '').replace(/[–—−]/g, '-');
  const toNumber = (s: string): number | null => {
    const m = s.match(/^(\d+(?:\.\d+)?)(k?)$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return m[2] ? Math.round(n * 1000) : Math.round(n);
  };
  if (normalized.includes('-')) {
    const [a, b] = normalized.split('-');
    const min = toNumber(a);
    const max = toNumber(b);
    if (min === null || min <= 0) return null;
    return { min, max: max !== null && max >= min ? max : null };
  }
  const min = toNumber(normalized);
  if (min === null || min <= 0) return null;
  return { min, max: null };
}

/**
 * Bridge a board `Job` (src/lib/types.ts) to matchable `JobCriteria`.
 * Salary comes from parsing `salaryRange`; explicit overrides win.
 */
export function adaptJob(
  job: Job,
  overrides: Partial<Pick<JobCriteria, 'salary_min' | 'salary_max' | 'required_languages' | 'sub_specializations'>> = {},
): JobCriteria {
  const parsed = job.salaryRange ? parseSalaryRange(job.salaryRange) : null;
  return {
    id: job.id,
    focus_area: FIELD_MAP[job.field],
    sub_specializations: overrides.sub_specializations ?? [...job.tags],
    required_languages: overrides.required_languages ?? {},
    visa_sponsorship: job.visaSponsorship,
    salary_min: overrides.salary_min ?? parsed?.min ?? 0,
    salary_max: overrides.salary_max ?? parsed?.max ?? null,
    location: job.location,
    is_remote: job.remoteFriendly || job.locationCode === 'remote',
  };
}

const SOFT_SCORE_WEIGHTS = {
  subSpecializationOverlap: 0.3,
  salaryOverlap: 0.2,
  seniorityMatch: 0.15,
  languageBoost: 0.1,
  locationMatch: 0.1,
  chineseSpecific: 0.05,
  recency: 0.05,
  profileCompleteness: 0.05,
} as const;

export function passesHardFilters(candidate: CandidateProfile, job: JobCriteria): boolean {
  if (!checkFocusArea(candidate, job)) return false;
  if (!checkVisaSponsorship(candidate, job)) return false;
  if (!checkRequiredLanguage(candidate, job)) return false;
  if (!checkLocation(candidate, job)) return false;
  return true;
}

export function checkFocusArea(candidate: CandidateProfile, job: JobCriteria): boolean {
  return candidate.focus_area === job.focus_area;
}

export function checkVisaSponsorship(candidate: CandidateProfile, job: JobCriteria): boolean {
  if (job.visa_sponsorship) return true;

  const noSponsorshipNeeded: VisaStatus[] = [
    'eu_citizen',
    'work_permit_unrestricted',
    'work_permit_restricted',
  ];

  if (noSponsorshipNeeded.includes(candidate.visa_status)) return true;

  if (candidate.visa_status === 'student_visa' && !job.visa_sponsorship) {
    return true;
  }

  return false;
}

export function checkRequiredLanguage(candidate: CandidateProfile, job: JobCriteria): boolean {
  for (const [language, requiredLevel] of Object.entries(job.required_languages)) {
    if (language === 'zh') {
      const candidateHsk = candidate.hsk_level ?? 0;
      const requiredHsk = parseHskRequirement(requiredLevel);
      if (requiredHsk !== null && candidateHsk < requiredHsk) {
        return false;
      }
    } else {
      const candidateLevel = candidate.languages[language];
      if (!candidateLevel) return false;

      const candidateScore = CEFR_LEVEL_ORDER[candidateLevel] ?? 0;
      const requiredScore = CEFR_LEVEL_ORDER[requiredLevel] ?? 0;

      if (candidateScore < requiredScore) {
        return false;
      }
    }
  }
  return true;
}

export function checkLocation(candidate: CandidateProfile, job: JobCriteria): boolean {
  if (job.is_remote) return true;

  return candidate.desired_location.some(
    (loc) => loc.toLowerCase() === job.location.toLowerCase(),
  );
}

function parseHskRequirement(requirement: string): number | null {
  const match = requirement.match(/HSK\s*(\d)/i);
  if (match) return parseInt(match[1], 10);
  if (requirement.toLowerCase() === 'native') return 6;
  if (requirement.toLowerCase() === 'fluent') return 5;
  return null;
}

export function computeSubSpecializationScore(
  candidate: CandidateProfile,
  job: JobCriteria,
): ScorePart {
  if (job.sub_specializations.length === 0) {
    return { score: 0, reason: null };
  }

  const overlap = candidate.sub_specializations.filter((s) =>
    job.sub_specializations.includes(s),
  );

  const ratio = overlap.length / job.sub_specializations.length;
  const score = Math.round(ratio * 100);

  const reason = overlap.length > 0 ? overlap.join(', ') : null;

  return { score, reason };
}

export function computeSalaryScore(candidate: CandidateProfile, job: JobCriteria): ScorePart {
  const candidateMin = candidate.salary_expectation_min;
  const candidateMax = candidate.salary_expectation_max || candidateMin;
  const jobMin = job.salary_min;
  const jobMax = job.salary_max || jobMin;

  if (candidateMax < jobMin || jobMax < candidateMin) {
    return { score: 0, reason: null };
  }

  const overlapMin = Math.max(candidateMin, jobMin);
  const overlapMax = Math.min(candidateMax, jobMax);

  if (overlapMin <= overlapMax) {
    const fullOverlap = candidateMin >= jobMin && candidateMax <= jobMax;
    return {
      score: fullOverlap ? 100 : 50,
      reason: 'Salary range overlaps',
    };
  }

  return { score: 0, reason: null };
}

export function computeSeniorityScore(
  candidate: CandidateProfile,
  _job: JobCriteria,
): ScorePart {
  void _job;
  const candidateYears = candidate.years_of_experience;

  const diff = Math.abs(candidateYears - 5);

  if (diff <= 2) {
    return { score: 100, reason: 'Experience level match' };
  } else if (diff <= 5) {
    return { score: 50, reason: null };
  }
  return { score: 0, reason: null };
}

export function computeLanguageBoostScore(
  candidate: CandidateProfile,
  job: JobCriteria,
): ScorePart {
  let exceedsCount = 0;
  let totalCount = 0;

  for (const [language, requiredLevel] of Object.entries(job.required_languages)) {
    totalCount++;

    if (language === 'zh') {
      const candidateHsk = candidate.hsk_level ?? 0;
      const requiredHsk = parseHskRequirement(requiredLevel);
      if (requiredHsk !== null && candidateHsk > requiredHsk) {
        exceedsCount++;
      }
    } else {
      const candidateLevel = candidate.languages[language];
      if (candidateLevel) {
        const candidateScore = CEFR_LEVEL_ORDER[candidateLevel] ?? 0;
        const requiredScore = CEFR_LEVEL_ORDER[requiredLevel] ?? 0;
        if (candidateScore > requiredScore) {
          exceedsCount++;
        }
      }
    }
  }

  const score = totalCount > 0 ? Math.round((exceedsCount / totalCount) * 100) : 0;
  const reason = exceedsCount > 0 ? 'Language skills exceed requirements' : null;

  return { score, reason };
}

export function computeLocationScore(candidate: CandidateProfile, job: JobCriteria): ScorePart {
  if (job.is_remote) {
    return { score: 80, reason: 'Remote position' };
  }

  const exactMatch = candidate.desired_location.some(
    (loc) => loc.toLowerCase() === job.location.toLowerCase(),
  );

  if (exactMatch) {
    return { score: 100, reason: job.location };
  }

  return { score: 50, reason: null };
}

export function computeChineseSpecificScore(
  candidate: CandidateProfile,
  _job: JobCriteria,
  employerChinaOffices?: string[],
): ScorePart {
  let hasMatch = false;
  const reasons: string[] = [];

  if (candidate.chinese_university) {
    hasMatch = true;
    reasons.push('Chinese university background');
  }

  if (
    candidate.hometown_province &&
    employerChinaOffices &&
    employerChinaOffices.length > 0
  ) {
    hasMatch = true;
    reasons.push('Hometown province match');
  }

  if (candidate.hsk_level && candidate.hsk_level >= 5) {
    hasMatch = true;
    reasons.push(`HSK ${candidate.hsk_level}`);
  }

  return {
    score: hasMatch ? 100 : 0,
    reason: reasons.length > 0 ? reasons.join(', ') : null,
  };
}

export function computeRecencyScore(candidate: CandidateProfile): ScorePart {
  if (!candidate.last_active_at) {
    return { score: 0, reason: null };
  }

  const lastActive = new Date(candidate.last_active_at);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 7) {
    return { score: 100, reason: 'Recently active' };
  } else if (diffDays <= 30) {
    return { score: 50, reason: null };
  }
  return { score: 0, reason: null };
}

export function computeProfileCompletenessScore(candidate: CandidateProfile): ScorePart {
  const score = candidate.profile_completeness;
  const reason = score >= 80 ? 'Complete profile' : null;
  return { score, reason };
}

export function computeMatchScore(
  candidate: CandidateProfile,
  job: JobCriteria,
  employerChinaOffices?: string[],
): MatchResult {
  const hardFilterPass = passesHardFilters(candidate, job);

  if (!hardFilterPass) {
    return {
      score: 0,
      reasons: [],
      hardFilterPass: false,
    };
  }

  const reasons: string[] = [];
  let totalScore = 0;

  const subSpec = computeSubSpecializationScore(candidate, job);
  totalScore += subSpec.score * SOFT_SCORE_WEIGHTS.subSpecializationOverlap;
  if (subSpec.reason) reasons.push(subSpec.reason);

  const salary = computeSalaryScore(candidate, job);
  totalScore += salary.score * SOFT_SCORE_WEIGHTS.salaryOverlap;
  if (salary.reason) reasons.push(salary.reason);

  const seniority = computeSeniorityScore(candidate, job);
  totalScore += seniority.score * SOFT_SCORE_WEIGHTS.seniorityMatch;
  if (seniority.reason) reasons.push(seniority.reason);

  const languageBoost = computeLanguageBoostScore(candidate, job);
  totalScore += languageBoost.score * SOFT_SCORE_WEIGHTS.languageBoost;
  if (languageBoost.reason) reasons.push(languageBoost.reason);

  const location = computeLocationScore(candidate, job);
  totalScore += location.score * SOFT_SCORE_WEIGHTS.locationMatch;
  if (location.reason) reasons.push(location.reason);

  const chineseSpecific = computeChineseSpecificScore(candidate, job, employerChinaOffices);
  totalScore += chineseSpecific.score * SOFT_SCORE_WEIGHTS.chineseSpecific;
  if (chineseSpecific.reason) reasons.push(chineseSpecific.reason);

  const recency = computeRecencyScore(candidate);
  totalScore += recency.score * SOFT_SCORE_WEIGHTS.recency;
  if (recency.reason) reasons.push(recency.reason);

  const completeness = computeProfileCompletenessScore(candidate);
  totalScore += completeness.score * SOFT_SCORE_WEIGHTS.profileCompleteness;
  if (completeness.reason) reasons.push(completeness.reason);

  return {
    score: Math.round(totalScore),
    reasons,
    hardFilterPass: true,
  };
}

export function shouldTriggerImmediateAlert(score: number): boolean {
  return score >= 85;
}

export function shouldIncludeInDigest(score: number): boolean {
  return score >= 70 && score < 85;
}

export function shouldHideFromUser(score: number): boolean {
  return score < 70;
}

export { SOFT_SCORE_WEIGHTS };
