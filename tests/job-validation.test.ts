import { describe, it, expect } from 'vitest';
import {
  validateSalaryRange,
  validateJobPosting,
  validateCandidateProfile,
  validateEmailDomain,
  isCompanyEmail,
} from '@/lib/job-validation';
import type { JobPostingInput, CandidateProfileInput } from '@/lib/job-validation';
import { computeProfileCompleteness, getMissingFields } from '@/lib/profile-completeness';
import {
  canTransition,
  transition,
  getValidTransitions,
  isTerminalStatus,
} from '@/lib/application-state-machine';

describe('Salary Validation', () => {
  it('rejects posting without minimum salary', () => {
    const result = validateSalaryRange(0, null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Minimum salary is required');
  });

  it('rejects posting with negative salary', () => {
    const result = validateSalaryRange(-1000, null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('greater than 0');
  });

  it('rejects when max salary is less than min salary', () => {
    const result = validateSalaryRange(80000, 70000);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cannot be less than');
  });

  it('accepts valid salary range', () => {
    const result = validateSalaryRange(75000, 110000);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('accepts minimum salary without maximum', () => {
    expect(validateSalaryRange(75000, null).valid).toBe(true);
  });

  it('accepts minimum salary with undefined maximum', () => {
    expect(validateSalaryRange(75000, undefined).valid).toBe(true);
  });
});

describe('Job Posting Validation', () => {
  const validJob: Partial<JobPostingInput> = {
    title: 'Senior ML Engineer',
    description: 'We are looking for an ML engineer.',
    salary_min: 75000,
    salary_max: 110000,
    focus_area: 'ai_ml',
    location: 'Berlin',
    is_remote: false,
    application_type: 'in_platform',
    external_application_url: null,
  };

  it('accepts a valid job posting', () => {
    const result = validateJobPosting(validJob);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects posting without salary_min (salary is mandatory)', () => {
    const result = validateJobPosting({ ...validJob, salary_min: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('salary'))).toBe(true);
  });

  it('rejects posting without title', () => {
    const result = validateJobPosting({ ...validJob, title: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('title'))).toBe(true);
  });

  it('rejects posting without description', () => {
    const result = validateJobPosting({ ...validJob, description: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-remote posting without location', () => {
    const result = validateJobPosting({ ...validJob, location: '', is_remote: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Location'))).toBe(true);
  });

  it('allows remote posting without location', () => {
    expect(validateJobPosting({ ...validJob, location: '', is_remote: true }).valid).toBe(true);
  });

  it('rejects external application type without URL', () => {
    const result = validateJobPosting({
      ...validJob,
      application_type: 'external',
      external_application_url: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('External application URL'))).toBe(true);
  });

  it('allows external application type with URL', () => {
    expect(
      validateJobPosting({
        ...validJob,
        application_type: 'external',
        external_application_url: 'https://example.com/apply',
      }).valid,
    ).toBe(true);
  });
});

describe('Candidate Profile Validation', () => {
  const validProfile: Partial<CandidateProfileInput> = {
    full_name: 'Wei Zhang',
    focus_area: 'ai_ml',
    salary_expectation_min: 70000,
    salary_expectation_max: 100000,
    bio: 'ML engineer',
    hsk_level: 5,
  };

  it('accepts a valid profile', () => {
    expect(validateCandidateProfile(validProfile).valid).toBe(true);
  });

  it('rejects profile without full name', () => {
    expect(validateCandidateProfile({ ...validProfile, full_name: '' }).valid).toBe(false);
  });

  it('rejects bio longer than 500 characters', () => {
    const result = validateCandidateProfile({ ...validProfile, bio: 'a'.repeat(501) });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('500'))).toBe(true);
  });

  it('accepts bio of exactly 500 characters', () => {
    expect(validateCandidateProfile({ ...validProfile, bio: 'a'.repeat(500) }).valid).toBe(true);
  });

  it('rejects HSK level outside 1-6', () => {
    expect(validateCandidateProfile({ ...validProfile, hsk_level: 7 }).valid).toBe(false);
    expect(validateCandidateProfile({ ...validProfile, hsk_level: 0 }).valid).toBe(false);
  });

  it('accepts HSK levels 1 and 6', () => {
    expect(validateCandidateProfile({ ...validProfile, hsk_level: 1 }).valid).toBe(true);
    expect(validateCandidateProfile({ ...validProfile, hsk_level: 6 }).valid).toBe(true);
  });

  it('rejects min salary > max salary', () => {
    expect(
      validateCandidateProfile({
        ...validProfile,
        salary_expectation_min: 100000,
        salary_expectation_max: 70000,
      }).valid,
    ).toBe(false);
  });
});

describe('Email Domain Validation', () => {
  it('accepts company email', () => {
    expect(isCompanyEmail('hr@bmw.com')).toBe(true);
    expect(isCompanyEmail('contact@startup.de')).toBe(true);
  });

  it('rejects free email providers', () => {
    expect(isCompanyEmail('user@gmail.com')).toBe(false);
    expect(isCompanyEmail('user@163.com')).toBe(false);
    expect(isCompanyEmail('user@qq.com')).toBe(false);
    expect(isCompanyEmail('user@hotmail.com')).toBe(false);
    expect(isCompanyEmail('user@yahoo.com')).toBe(false);
  });

  it('validateEmailDomain returns valid for company email', () => {
    const result = validateEmailDomain('hr@siemens.com');
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('validateEmailDomain returns invalid for free email', () => {
    const result = validateEmailDomain('user@gmail.com');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('company email');
  });

  it('validateEmailDomain returns invalid for malformed email', () => {
    expect(validateEmailDomain('notanemail').valid).toBe(false);
  });
});

describe('Profile Completeness', () => {
  const fullCandidate = {
    full_name: 'Wei Zhang',
    current_location: 'Berlin',
    desired_location: ['Berlin'],
    visa_status: 'work_permit_unrestricted' as const,
    focus_area: 'ai_ml' as const,
    sub_specializations: ['NLP'],
    years_of_experience: 5,
    current_role: 'ML Engineer',
    bio: 'bio',
    languages: { en: 'C1' },
    salary_expectation_min: 70000,
    salary_expectation_max: 100000,
    cv_url: 'https://example.com/cv.pdf',
    availability: 'actively_looking' as const,
    chinese_university: 'Tsinghua',
    hometown_province: 'Beijing',
    hsk_level: 6,
    github_url: 'https://github.com/x',
    portfolio_url: 'https://x.dev',
    linkedin_url: 'https://linkedin.com/in/x',
    photo_url: 'https://example.com/p.jpg',
    current_company: 'Bosch',
    certificate_urls: ['https://example.com/cert.pdf'],
  };

  it('returns 100 for a fully filled profile', () => {
    expect(computeProfileCompleteness(fullCandidate)).toBe(100);
  });

  it('returns 0 for an empty profile', () => {
    expect(computeProfileCompleteness({})).toBe(0);
  });

  it('lists missing required fields', () => {
    const missing = getMissingFields({ full_name: 'Wei Zhang' });
    expect(missing).toContain('focus_area');
    expect(missing).not.toContain('full_name');
  });

  it('returns no missing fields for a complete profile', () => {
    expect(getMissingFields(fullCandidate)).toHaveLength(0);
  });
});

describe('Application State Machine', () => {
  it('allows forward transitions', () => {
    expect(canTransition('applied', 'screening')).toBe(true);
    expect(canTransition('screening', 'interview')).toBe(true);
    expect(canTransition('interview', 'offer')).toBe(true);
  });

  it('allows skipping stages', () => {
    expect(canTransition('applied', 'offer')).toBe(true);
  });

  it('allows rejection from any non-terminal state', () => {
    expect(canTransition('applied', 'rejected')).toBe(true);
    expect(canTransition('screening', 'rejected')).toBe(true);
    expect(canTransition('offer', 'rejected')).toBe(true);
  });

  it('rejects backward and self transitions', () => {
    expect(canTransition('interview', 'screening')).toBe(false);
    expect(canTransition('applied', 'applied')).toBe(false);
  });

  it('rejected is terminal', () => {
    expect(isTerminalStatus('rejected')).toBe(true);
    expect(isTerminalStatus('applied')).toBe(false);
    expect(getValidTransitions('rejected')).toEqual([]);
  });

  it('transition() returns the new status on valid move', () => {
    expect(transition('applied', 'screening')).toBe('screening');
  });

  it('transition() throws on invalid move', () => {
    expect(() => transition('rejected', 'interview')).toThrow('Invalid status transition');
  });
});
