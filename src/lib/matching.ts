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

import type { Job, JobField, LanguageLevel } from './types';

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
  /**
   * Always populated by `adaptJob` — an absent requirement is an explicit
   * decision, never a silent default. See `defaultRequiredLanguages` for why
   * the fallback is a real, enforceable requirement rather than `{}`.
   */
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

/**
 * The one text normaliser used by every comparison in this module.
 *
 * Order matters: NFKC first (so full-width/half-width forms and the
 * ideographic space fold), then whitespace collapsing, then trim + lowercase.
 *
 * It is applied to *both* sides of every comparison, so equality semantics are
 * preserved: `Array.prototype.includes` is SameValueZero, which means "Java"
 * still does not match "JavaScript".
 *
 * TOTAL BY CONTRACT. The parameter is `string | null | undefined` and anything
 * that is not a usable string becomes `""`, never an exception. A throwing
 * text helper is a trap: it takes down the whole match (the hard filters run
 * before any soft score), so one absent field would blank the entire board
 * rather than degrade one comparison. `rowToJob` already coerces the columns
 * the board reads, but `adaptJob` also indexes `FIELD_MAP` and
 * `LANGUAGE_LEVEL_TO_REQUIRED_ZH` with *unvalidated* DB values, and callers
 * outside this repo's boundary can hand over any shape. Callers therefore
 * never guard this themselves -- the guard lives here, once.
 */
export function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Coerce a maybe-array of maybe-strings into a real `string[]`.
 *
 * Same rationale as `normalizeText`: `.some`/`.map`/`.filter` on a value that
 * is null, a bare string, or an array holding nulls throws or silently
 * misbehaves. The DB stores these as `TEXT[] DEFAULT '{}'`, and a
 * single-string column shape is a real thing to receive from an HTTP body.
 * Non-string elements are dropped rather than stringified, so `[null, "Berlin"]`
 * cannot normalise to `["null", "berlin"]` and match a "null" job location.
 */
function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Case-folded index of CEFR_LEVEL_ORDER so level lookup can ignore case.
 *
 * Null-prototype on purpose. A bare `{}` literal makes `index[normalizeText(level)]`
 * a live prototype read: a requirement of `"constructor"` or `"toString"`
 * returns an inherited function, which is non-nullish, so the `?? null` in
 * `cefrRank` never fires and the "unknown requirement rejects" rule silently
 * stops applying to exactly the inputs it was written for. `Object.hasOwn` is
 * the same guard the /api/match route applies to FOCUS_AREA_ALIASES.
 */
const CEFR_RANK_BY_LEVEL: Record<string, number> = (() => {
  const index: Record<string, number> = Object.create(null);
  for (const level of Object.keys(CEFR_LEVEL_ORDER)) {
    index[normalizeText(level)] = CEFR_LEVEL_ORDER[level];
  }
  return index;
})();

/** Rank of a CEFR/native level, or `null` when the level is not one we understand. */
function cefrRank(level: unknown): number | null {
  if (typeof level !== 'string') return null;
  return CEFR_RANK_BY_LEVEL[normalizeText(level)] ?? null;
}

/** Coerce missing/NaN/non-numeric input to a finite number, else `fallback`. */
function finiteNumber(value: unknown, fallback: number): number {
  // `Number(symbol)` throws, which would break the "total" promise above it.
  if (typeof value === 'symbol') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

/**
 * `Job.languageLevel` is the job's Chinese-language requirement — the one
 * requirement this board can always enforce, because the whole premise is
 * Chinese-language capability. The values are written as HSK levels because
 * `parseHskRequirement` understands those: a fallback the hard filter cannot
 * act on would be exactly the silent zero this replaces.
 */
const LANGUAGE_LEVEL_TO_REQUIRED_ZH: Record<LanguageLevel, string> = {
  'nice-to-have': 'HSK1',
  required: 'HSK4',
  fluent: 'HSK5',
};

/**
 * Fallback `required_languages` for a job adapted without an explicit
 * override. Note the consequence: a candidate with `hsk_level: null` has no
 * evidence of Chinese ability and is now rejected by `checkRequiredLanguage`
 * on such a job, where previously the filter was vacuous and let them through.
 * "nice-to-have" is mapped to HSK1 because it gates only the unknown; a job
 * that means Chinese is merely preferred should not hide candidates outright.
 */
function defaultRequiredLanguages(job: Job): Record<string, string> {
  return { zh: LANGUAGE_LEVEL_TO_REQUIRED_ZH[job.languageLevel] ?? 'HSK1' };
}

export function adaptJob(
  job: Job,
  overrides: Partial<Pick<JobCriteria, 'salary_min' | 'salary_max' | 'required_languages' | 'sub_specializations'>> = {},
): JobCriteria {
  const parsed = job.salaryRange ? parseSalaryRange(job.salaryRange) : null;
  return {
    id: job.id,
    focus_area: FIELD_MAP[job.field],
    // `toStringList` rather than a bare spread: `[...undefined]` throws, and
    // this runs for every job on the board inside a `useMemo`, so one untagged
    // row would take the whole /jobs page down rather than score one job low.
    sub_specializations: overrides.sub_specializations ?? toStringList(job.tags),
    required_languages: overrides.required_languages ?? defaultRequiredLanguages(job),
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

/**
 * Score used when a job gives us nothing to compare against. Neither 0 nor
 * 100 is honest: 0 punishes the candidate for the job's missing data and 100
 * rewards them for it. 50 keeps the part in play without inventing a signal.
 */
const NEUTRAL_SCORE = 50;

export function passesHardFilters(candidate: CandidateProfile, job: JobCriteria): boolean {
  if (!checkFocusArea(candidate, job)) return false;
  if (!checkVisaSponsorship(candidate, job)) return false;
  if (!checkRequiredLanguage(candidate, job)) return false;
  if (!checkLocation(candidate, job)) return false;
  return true;
}

export function checkFocusArea(candidate: CandidateProfile, job: JobCriteria): boolean {
  const candidateFocus = normalizeText(candidate.focus_area);
  const jobFocus = normalizeText(job.focus_area);
  // Fail closed on absence. `normalizeText` maps a missing value to "", so a
  // bare `===` would report a candidate with no declared focus area as
  // matching a job whose `field` is not in FIELD_MAP -- two unknowns are not
  // evidence of agreement. "Unknown" must never be read as a match.
  if (!candidateFocus || !jobFocus) return false;
  return candidateFocus === jobFocus;
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
  for (const [language, requiredLevel] of Object.entries(job.required_languages ?? {})) {
    if (normalizeText(language) === 'zh') {
      const requiredHsk = parseHskRequirement(requiredLevel);
      // Fail closed: a zh requirement we cannot parse must not silently
      // disable the filter (`zh: 'B1'` used to gate nobody at all).
      if (requiredHsk === null) return false;
      if (candidateHskLevel(candidate) < requiredHsk) {
        return false;
      }
    } else {
      const requiredScore = cefrRank(requiredLevel);
      // Same rule for a non-zh level missing from CEFR_LEVEL_ORDER
      // ('C1+', 'advanced', …): an unknown requirement rejects.
      if (requiredScore === null) return false;

      const candidateScore = cefrRank(candidateLanguageLevel(candidate, language));
      // No declared level, or one we do not understand, is no evidence of
      // meeting a stated requirement.
      if (candidateScore === null) return false;
      if (candidateScore < requiredScore) {
        return false;
      }
    }
  }
  return true;
}

export function checkLocation(candidate: CandidateProfile, job: JobCriteria): boolean {
  if (job.is_remote) return true;

  const jobLocation = normalizeText(job.location);
  if (!jobLocation) return false;
  return toStringList(candidate.desired_location).some(
    (loc) => normalizeText(loc) === jobLocation,
  );
}

function parseHskRequirement(requirement: string): number | null {
  // `normalizeText` already NFKC-folds, collapses and case-folds, and is total,
  // so this is the one pipeline rather than a second hand-rolled copy. An
  // absent requirement normalises to "" and falls through to `null` below,
  // which callers treat as "cannot act on this requirement".
  const text = normalizeText(requirement);
  const match = text.match(/HSK\s*(\d)/i);
  if (match) return parseInt(match[1], 10);
  if (text === 'native') return 6;
  if (text === 'fluent') return 5;
  return null;
}

/** Candidate's HSK level; missing or NaN means "no evidence" (0). */
function candidateHskLevel(candidate: CandidateProfile): number {
  return finiteNumber(candidate.hsk_level, 0);
}

/**
 * A candidate's level for a language. Exact key match first, then a normalised
 * scan, so a profile keyed `'ZH'` or `'De'` is not read as absent.
 */
function candidateLanguageLevel(candidate: CandidateProfile, language: string): unknown {
  const languages = candidate.languages ?? {};
  if (Object.prototype.hasOwnProperty.call(languages, language)) {
    return languages[language];
  }
  const key = normalizeText(language);
  for (const [candidateKey, level] of Object.entries(languages)) {
    if (normalizeText(candidateKey) === key) return level;
  }
  return undefined;
}

export function computeSubSpecializationScore(
  candidate: CandidateProfile,
  job: JobCriteria,
): ScorePart {
  // Set first so case/whitespace variants of one tag count once in the ratio.
  const required = new Set(toStringList(job.sub_specializations).map(normalizeText));

  if (required.size === 0) {
    // The job declares no sub-specializations, so there is no evidence either
    // way. Score neutral instead of 0: 0 forfeited the heaviest weight (0.3)
    // and capped every candidate at 70, making the >=85 immediate alert
    // unreachable on every untagged job. `reason: null` keeps "Skills match"
    // off a job we never actually compared.
    return { score: NEUTRAL_SCORE, reason: null };
  }

  const overlap = toStringList(candidate.sub_specializations).filter((s) =>
    required.has(normalizeText(s)),
  );

  const ratio = overlap.length / required.size;
  const score = Math.round(ratio * 100);

  const reason = overlap.length > 0 ? overlap.join(', ') : null;

  return { score, reason };
}

export function computeSalaryScore(candidate: CandidateProfile, job: JobCriteria): ScorePart {
  const candidateMin = finiteNumber(candidate.salary_expectation_min, 0);
  const rawCandidateMax = finiteNumber(candidate.salary_expectation_max, 0);
  const candidateMax = rawCandidateMax > 0 ? rawCandidateMax : candidateMin;
  const jobMin = finiteNumber(job.salary_min, 0);

  // `salary_max: null` is a supported input (validateSalaryRange permits it):
  // it means "from €80k", an open-ended range. Substituting the floor as the
  // ceiling turned that into a hard ceiling and scored 0 on 20% of the weight
  // for a candidate hoping for more than the floor. Score on the floor alone.
  const declaredMax = job.salary_max;
  const openEnded =
    declaredMax === null ||
    declaredMax === undefined ||
    !Number.isFinite(declaredMax) ||
    // Inverted range (max below min) is malformed, not a real ceiling.
    declaredMax < jobMin;

  if (openEnded) {
    if (jobMin <= 0) return { score: 0, reason: null };
    if (candidateMax < jobMin) return { score: 0, reason: null };
    // Candidate's whole range sits at or above the published floor.
    const fullyAbove = candidateMin >= jobMin;
    return { score: fullyAbove ? 100 : 50, reason: 'Salary range overlaps' };
  }

  const jobMax = declaredMax as number;

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
  const candidateYears = finiteNumber(candidate.years_of_experience, 0);

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

  for (const [language, requiredLevel] of Object.entries(job.required_languages ?? {})) {
    const isChinese = normalizeText(language) === 'zh';
    const requiredRank = isChinese
      ? parseHskRequirement(requiredLevel)
      : cefrRank(requiredLevel);

    // A requirement we cannot parse earns nothing and is left out of the
    // denominator: treating it as rank 0 previously made every candidate
    // "exceed" it, handing out the full 0.1 weight for free.
    if (requiredRank === null) continue;

    totalCount++;

    if (isChinese) {
      if (candidateHskLevel(candidate) > requiredRank) {
        exceedsCount++;
      }
    } else {
      // An undeclared or unparseable candidate level stays in the denominator
      // and earns no point — excluding it would inflate the ratio.
      const candidateScore = cefrRank(candidateLanguageLevel(candidate, language));
      if (candidateScore !== null && candidateScore > requiredRank) {
        exceedsCount++;
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

  const jobLocation = normalizeText(job.location);
  if (!jobLocation) return { score: 0, reason: null };
  const exactMatch = toStringList(candidate.desired_location).some(
    (loc) => normalizeText(loc) === jobLocation,
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
  // This is the only scorer input with no 0–100 invariant upstream: a stored
  // 200 would add free weight, and an undefined field produced NaN, which
  // fails every threshold gate open (not hidden, no alert, no digest).
  const score = Math.min(100, Math.max(0, finiteNumber(candidate.profile_completeness, 0)));
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
    // Every part is clamped to 0–100, so the weighted sum is bounded; this
    // guard exists so no future unguarded input can produce a NaN total,
    // which would pass silently through all three threshold gates.
    score: Number.isFinite(totalScore) ? Math.min(100, Math.max(0, Math.round(totalScore))) : 0,
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
