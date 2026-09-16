import { describe, it, expect } from 'vitest';
import {
  computeMatchScore,
  passesHardFilters,
  checkFocusArea,
  checkVisaSponsorship,
  checkRequiredLanguage,
  checkLocation,
  computeSubSpecializationScore,
  computeSalaryScore,
  computeSeniorityScore,
  computeLanguageBoostScore,
  computeLocationScore,
  computeChineseSpecificScore,
  computeRecencyScore,
  computeProfileCompletenessScore,
  shouldTriggerImmediateAlert,
  shouldIncludeInDigest,
  shouldHideFromUser,
  adaptJob,
  parseSalaryRange,
  SOFT_SCORE_WEIGHTS,
} from '@/lib/matching';
import type { CandidateProfile, JobCriteria } from '@/lib/matching';

function makeCandidate(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    id: 'cand-1',
    full_name: 'Test Candidate',
    current_location: 'Berlin',
    desired_location: ['Berlin', 'Munich'],
    visa_status: 'work_permit_unrestricted',
    focus_area: 'ai_ml',
    sub_specializations: ['NLP / LLMs', 'Computer Vision'],
    years_of_experience: 5,
    current_role: 'ML Engineer',
    bio: 'Test bio',
    languages: { en: 'C1', de: 'B2', zh: 'native' },
    hsk_level: 6,
    salary_expectation_min: 70000,
    salary_expectation_max: 100000,
    chinese_university: 'Tsinghua University',
    hometown_province: 'Beijing',
    profile_completeness: 80,
    last_active_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobCriteria> = {}): JobCriteria {
  return {
    id: 'job-1',
    focus_area: 'ai_ml',
    sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'],
    required_languages: { en: 'B2', de: 'B1' },
    visa_sponsorship: true,
    salary_min: 75000,
    salary_max: 110000,
    location: 'Berlin',
    is_remote: false,
    ...overrides,
  };
}

describe('Matching Algorithm — Hard Filters', () => {
  describe('checkFocusArea', () => {
    it('passes when focus areas match', () => {
      expect(checkFocusArea(makeCandidate({ focus_area: 'ai_ml' }), makeJob({ focus_area: 'ai_ml' }))).toBe(true);
    });

    it('fails when focus areas differ', () => {
      expect(checkFocusArea(makeCandidate({ focus_area: 'ai_ml' }), makeJob({ focus_area: 'robotics' }))).toBe(false);
    });
  });

  describe('checkVisaSponsorship', () => {
    it('passes when employer offers visa sponsorship', () => {
      expect(
        checkVisaSponsorship(makeCandidate({ visa_status: 'needs_sponsorship' }), makeJob({ visa_sponsorship: true })),
      ).toBe(true);
    });

    it('passes when candidate is EU citizen regardless of sponsorship', () => {
      expect(
        checkVisaSponsorship(makeCandidate({ visa_status: 'eu_citizen' }), makeJob({ visa_sponsorship: false })),
      ).toBe(true);
    });

    it('passes when candidate has unrestricted work permit', () => {
      expect(
        checkVisaSponsorship(
          makeCandidate({ visa_status: 'work_permit_unrestricted' }),
          makeJob({ visa_sponsorship: false }),
        ),
      ).toBe(true);
    });

    it('passes when candidate has restricted work permit', () => {
      expect(
        checkVisaSponsorship(
          makeCandidate({ visa_status: 'work_permit_restricted' }),
          makeJob({ visa_sponsorship: false }),
        ),
      ).toBe(true);
    });

    it('fails when candidate needs sponsorship but employer does not offer', () => {
      expect(
        checkVisaSponsorship(makeCandidate({ visa_status: 'needs_sponsorship' }), makeJob({ visa_sponsorship: false })),
      ).toBe(false);
    });

    it('passes for student visa without sponsorship requirement', () => {
      expect(
        checkVisaSponsorship(makeCandidate({ visa_status: 'student_visa' }), makeJob({ visa_sponsorship: false })),
      ).toBe(true);
    });
  });

  describe('checkRequiredLanguage', () => {
    it('passes when candidate meets all required language levels', () => {
      expect(
        checkRequiredLanguage(
          makeCandidate({ languages: { en: 'C1', de: 'B2' } }),
          makeJob({ required_languages: { en: 'B2', de: 'B1' } }),
        ),
      ).toBe(true);
    });

    it('fails when candidate is below required level', () => {
      expect(
        checkRequiredLanguage(
          makeCandidate({ languages: { en: 'A2', de: 'B2' } }),
          makeJob({ required_languages: { en: 'B2', de: 'B1' } }),
        ),
      ).toBe(false);
    });

    it('fails when candidate does not have a required language', () => {
      expect(
        checkRequiredLanguage(
          makeCandidate({ languages: { en: 'C1' } }),
          makeJob({ required_languages: { en: 'B2', de: 'B1' } }),
        ),
      ).toBe(false);
    });

    it('handles HSK requirements for Chinese', () => {
      expect(
        checkRequiredLanguage(makeCandidate({ hsk_level: 5 }), makeJob({ required_languages: { zh: 'HSK4' } })),
      ).toBe(true);
    });

    it('fails when HSK level is below requirement', () => {
      expect(
        checkRequiredLanguage(makeCandidate({ hsk_level: 3 }), makeJob({ required_languages: { zh: 'HSK5' } })),
      ).toBe(false);
    });

    it('handles native Chinese requirement', () => {
      expect(
        checkRequiredLanguage(
          makeCandidate({ hsk_level: 6, languages: { zh: 'native' } }),
          makeJob({ required_languages: { zh: 'native' } }),
        ),
      ).toBe(true);
    });
  });

  describe('checkLocation', () => {
    it('passes when candidate desires the job location', () => {
      expect(
        checkLocation(makeCandidate({ desired_location: ['Berlin', 'Munich'] }), makeJob({ location: 'Berlin', is_remote: false })),
      ).toBe(true);
    });

    it('passes when job is remote', () => {
      expect(
        checkLocation(makeCandidate({ desired_location: ['Berlin'] }), makeJob({ location: 'Munich', is_remote: true })),
      ).toBe(true);
    });

    it('fails when candidate does not desire the location and job is not remote', () => {
      expect(
        checkLocation(makeCandidate({ desired_location: ['Berlin'] }), makeJob({ location: 'Munich', is_remote: false })),
      ).toBe(false);
    });

    it('is case insensitive', () => {
      expect(
        checkLocation(makeCandidate({ desired_location: ['berlin'] }), makeJob({ location: 'Berlin', is_remote: false })),
      ).toBe(true);
    });
  });

  describe('passesHardFilters', () => {
    it('passes all filters for a perfect match', () => {
      expect(passesHardFilters(makeCandidate(), makeJob())).toBe(true);
    });

    it('fails when focus area does not match', () => {
      expect(passesHardFilters(makeCandidate({ focus_area: 'robotics' }), makeJob({ focus_area: 'ai_ml' }))).toBe(false);
    });

    it('fails when visa sponsorship is needed but not offered', () => {
      expect(
        passesHardFilters(makeCandidate({ visa_status: 'needs_sponsorship' }), makeJob({ visa_sponsorship: false })),
      ).toBe(false);
    });
  });
});

describe('Matching Algorithm — Soft Scores', () => {
  describe('computeSubSpecializationScore', () => {
    it('returns 100 for full overlap', () => {
      const result = computeSubSpecializationScore(
        makeCandidate({ sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'] }),
        makeJob({ sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'] }),
      );
      expect(result.score).toBe(100);
    });

    it('returns 50 for partial overlap', () => {
      const result = computeSubSpecializationScore(
        makeCandidate({ sub_specializations: ['NLP / LLMs'] }),
        makeJob({ sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'] }),
      );
      expect(result.score).toBe(50);
    });

    it('returns 0 for no overlap', () => {
      const result = computeSubSpecializationScore(
        makeCandidate({ sub_specializations: ['Edge AI'] }),
        makeJob({ sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'] }),
      );
      expect(result.score).toBe(0);
    });

    it('returns 0 when job has no sub-specializations', () => {
      const result = computeSubSpecializationScore(
        makeCandidate({ sub_specializations: ['NLP / LLMs'] }),
        makeJob({ sub_specializations: [] }),
      );
      expect(result.score).toBe(0);
    });
  });

  describe('computeSalaryScore', () => {
    it('returns 100 for full overlap', () => {
      const result = computeSalaryScore(
        makeCandidate({ salary_expectation_min: 80000, salary_expectation_max: 90000 }),
        makeJob({ salary_min: 75000, salary_max: 100000 }),
      );
      expect(result.score).toBe(100);
    });

    it('returns 50 for partial overlap', () => {
      const result = computeSalaryScore(
        makeCandidate({ salary_expectation_min: 90000, salary_expectation_max: 120000 }),
        makeJob({ salary_min: 75000, salary_max: 100000 }),
      );
      expect(result.score).toBe(50);
    });

    it('returns 0 for no overlap', () => {
      const result = computeSalaryScore(
        makeCandidate({ salary_expectation_min: 120000, salary_expectation_max: 150000 }),
        makeJob({ salary_min: 75000, salary_max: 100000 }),
      );
      expect(result.score).toBe(0);
    });
  });

  describe('computeSeniorityScore', () => {
    it('returns 100 for ±2 years', () => {
      expect(computeSeniorityScore(makeCandidate({ years_of_experience: 5 }), makeJob()).score).toBe(100);
    });

    it('returns 50 for ±5 years', () => {
      expect(computeSeniorityScore(makeCandidate({ years_of_experience: 2 }), makeJob()).score).toBe(50);
    });

    it('returns 0 for >5 years difference', () => {
      expect(computeSeniorityScore(makeCandidate({ years_of_experience: 15 }), makeJob()).score).toBe(0);
    });
  });

  describe('computeLanguageBoostScore', () => {
    it('returns higher score when candidate exceeds requirements', () => {
      const result = computeLanguageBoostScore(
        makeCandidate({ languages: { en: 'C2', de: 'C1' } }),
        makeJob({ required_languages: { en: 'B2', de: 'B1' } }),
      );
      expect(result.score).toBe(100);
    });

    it('returns 0 when candidate meets but does not exceed', () => {
      const result = computeLanguageBoostScore(
        makeCandidate({ languages: { en: 'B2', de: 'B1' } }),
        makeJob({ required_languages: { en: 'B2', de: 'B1' } }),
      );
      expect(result.score).toBe(0);
    });
  });

  describe('computeLocationScore', () => {
    it('returns 100 for exact city match', () => {
      expect(
        computeLocationScore(makeCandidate({ desired_location: ['Berlin'] }), makeJob({ location: 'Berlin', is_remote: false })).score,
      ).toBe(100);
    });

    it('returns 80 for remote', () => {
      expect(
        computeLocationScore(makeCandidate({ desired_location: ['Berlin'] }), makeJob({ location: 'Munich', is_remote: true })).score,
      ).toBe(80);
    });

    it('returns 50 for no match', () => {
      expect(
        computeLocationScore(makeCandidate({ desired_location: ['Berlin'] }), makeJob({ location: 'Munich', is_remote: false })).score,
      ).toBe(50);
    });
  });

  describe('computeChineseSpecificScore', () => {
    it('returns 100 for candidate with Chinese university and HSK 5+', () => {
      const result = computeChineseSpecificScore(
        makeCandidate({ chinese_university: 'Tsinghua', hsk_level: 6, hometown_province: 'Beijing' }),
        makeJob(),
        ['Beijing'],
      );
      expect(result.score).toBe(100);
    });

    it('returns 0 for candidate without Chinese-specific fields', () => {
      const result = computeChineseSpecificScore(
        makeCandidate({ chinese_university: null, hsk_level: null, hometown_province: null }),
        makeJob(),
      );
      expect(result.score).toBe(0);
    });
  });

  describe('computeRecencyScore', () => {
    it('returns 100 for active in last 7 days', () => {
      expect(computeRecencyScore(makeCandidate({ last_active_at: new Date().toISOString() })).score).toBe(100);
    });

    it('returns 50 for active within 30 days', () => {
      expect(
        computeRecencyScore(
          makeCandidate({ last_active_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() }),
        ).score,
      ).toBe(50);
    });

    it('returns 0 for inactive >30 days', () => {
      expect(
        computeRecencyScore(
          makeCandidate({ last_active_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() }),
        ).score,
      ).toBe(0);
    });

    it('returns 0 when never active', () => {
      expect(computeRecencyScore(makeCandidate({ last_active_at: null })).score).toBe(0);
    });
  });

  describe('computeProfileCompletenessScore', () => {
    it('returns the candidate profile_completeness value', () => {
      expect(computeProfileCompletenessScore(makeCandidate({ profile_completeness: 75 })).score).toBe(75);
    });
  });

  describe('soft score weights sum to 1', () => {
    it('weights add up to 1.0', () => {
      const sum = Object.values(SOFT_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });
});

describe('Matching Algorithm — Full Score Computation', () => {
  it('returns score 0 and hardFilterPass false when hard filters fail', () => {
    const result = computeMatchScore(makeCandidate({ focus_area: 'robotics' }), makeJob({ focus_area: 'ai_ml' }));
    expect(result.score).toBe(0);
    expect(result.hardFilterPass).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('returns positive score when hard filters pass', () => {
    const result = computeMatchScore(makeCandidate(), makeJob());
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.hardFilterPass).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('includes match reasons in the result', () => {
    const result = computeMatchScore(
      makeCandidate({
        sub_specializations: ['NLP / LLMs'],
        salary_expectation_min: 75000,
        salary_expectation_max: 100000,
      }),
      makeJob({ sub_specializations: ['NLP / LLMs'], salary_min: 80000, salary_max: 110000 }),
    );
    expect(result.reasons).toContain('NLP / LLMs');
    expect(result.reasons).toContain('Salary range overlaps');
  });

  it('produces a near-perfect score for ideal match', () => {
    const result = computeMatchScore(
      makeCandidate({
        sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'],
        salary_expectation_min: 75000,
        salary_expectation_max: 110000,
        years_of_experience: 5,
        languages: { en: 'C2', de: 'C1' },
        desired_location: ['Berlin'],
        chinese_university: 'Tsinghua',
        hsk_level: 6,
        hometown_province: 'Beijing',
        profile_completeness: 95,
        last_active_at: new Date().toISOString(),
      }),
      makeJob({
        sub_specializations: ['NLP / LLMs', 'MLOps / Infrastructure'],
        salary_min: 75000,
        salary_max: 110000,
        required_languages: { en: 'B2', de: 'B1' },
        location: 'Berlin',
        is_remote: false,
      }),
      ['Beijing'],
    );
    expect(result.score).toBeGreaterThanOrEqual(85);
  });
});

describe('Matching Algorithm — Alert Thresholds', () => {
  it('triggers immediate alert for score >= 85', () => {
    expect(shouldTriggerImmediateAlert(85)).toBe(true);
    expect(shouldTriggerImmediateAlert(90)).toBe(true);
    expect(shouldTriggerImmediateAlert(100)).toBe(true);
  });

  it('does not trigger immediate alert for score < 85', () => {
    expect(shouldTriggerImmediateAlert(84)).toBe(false);
    expect(shouldTriggerImmediateAlert(70)).toBe(false);
  });

  it('includes in digest for score >= 70 and < 85', () => {
    expect(shouldIncludeInDigest(70)).toBe(true);
    expect(shouldIncludeInDigest(84)).toBe(true);
  });

  it('does not include in digest for score >= 85', () => {
    expect(shouldIncludeInDigest(85)).toBe(false);
  });

  it('does not include in digest for score < 70', () => {
    expect(shouldIncludeInDigest(69)).toBe(false);
  });

  it('hides from user for score < 70', () => {
    expect(shouldHideFromUser(69)).toBe(true);
    expect(shouldHideFromUser(0)).toBe(true);
  });

  it('does not hide for score >= 70', () => {
    expect(shouldHideFromUser(70)).toBe(false);
  });
});

describe('Board Job adapter', () => {
  const boardJob = {
    id: 'j1',
    title: 'ML Engineer',
    titleZh: '机器学习工程师',
    company: 'Bosch',
    field: 'ai' as const,
    location: 'Stuttgart',
    locationCode: 'de' as const,
    languageLevel: 'required' as const,
    employmentType: 'full-time' as const,
    salaryRange: '€70k-€90k',
    description: 'desc',
    descriptionZh: '描述',
    requirements: ['Python'],
    requirementsZh: ['Python'],
    tags: ['PyTorch', 'MLOps'],
    applicationUrl: 'https://example.com/apply',
    postedDate: '2026-09-01',
    remoteFriendly: false,
    visaSponsorship: true,
  };

  it('maps board field ai to ai_ml focus area', () => {
    expect(adaptJob(boardJob).focus_area).toBe('ai_ml');
  });

  it('parses salaryRange into salary_min/max', () => {
    const adapted = adaptJob(boardJob);
    expect(adapted.salary_min).toBe(70000);
    expect(adapted.salary_max).toBe(90000);
  });

  it('marks remote when remoteFriendly', () => {
    expect(adaptJob({ ...boardJob, remoteFriendly: true }).is_remote).toBe(true);
  });

  it('parseSalaryRange handles plain numbers and k-suffix', () => {
    expect(parseSalaryRange('80000')).toEqual({ min: 80000, max: null });
    expect(parseSalaryRange('60k-80k')).toEqual({ min: 60000, max: 80000 });
    expect(parseSalaryRange('n/a')).toBeNull();
  });
});
