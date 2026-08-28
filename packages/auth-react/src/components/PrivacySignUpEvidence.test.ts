import { describe, expect, it } from 'vitest';
import type { PublicConfig } from '@authowl/core';
import { buildPrivacySignUpEvidence } from '@authowl/core/privacy';

const privacy: NonNullable<PublicConfig['privacy']> = {
  notices: [{
    noticeId: '11111111-1111-4111-8111-111111111111',
    noticeVersionId: '22222222-2222-4222-8222-222222222222',
    code: 'signup_notice',
    version: 1,
    title: { en: 'Privacy', ar: 'الخصوصية' },
    body: { en: 'Notice', ar: 'إشعار' },
    digest: { en: 'a'.repeat(64), ar: 'b'.repeat(64) },
    activityCodes: ['research'],
    purposeCodes: ['research'],
    effectiveFrom: '2026-08-27T10:00:00.000Z',
  }],
  consentPurposes: [{
    purposeId: '33333333-3333-4333-8333-333333333333',
    purposeVersionId: '44444444-4444-4444-8444-444444444444',
    code: 'research',
    version: 1,
    title: { en: 'Research', ar: 'الأبحاث' },
    description: { en: 'Optional research', ar: 'أبحاث اختيارية' },
    digest: { en: 'c'.repeat(64), ar: 'd'.repeat(64) },
    activityCodes: ['research'],
    dataCategories: ['usage'],
  }],
};

describe('privacy sign-up evidence', () => {
  it('echoes every delivered notice and records explicit optional choices', () => {
    expect(buildPrivacySignUpEvidence(
      privacy,
      'ar',
      new Set(['research']),
      '55555555-5555-4555-8555-555555555555',
    )).toEqual({
      locale: 'ar',
      correlationId: '55555555-5555-4555-8555-555555555555',
      noticeVersionIds: ['22222222-2222-4222-8222-222222222222'],
      consentDecisions: [{
        purposeCode: 'research',
        purposeVersionId: '44444444-4444-4444-8444-444444444444',
        noticeVersionId: '22222222-2222-4222-8222-222222222222',
        decision: 'granted',
        guardianRequired: false,
        guardianEvidenceId: null,
      }],
    });
  });

  it('defaults optional purposes to an explicit refusal', () => {
    expect(buildPrivacySignUpEvidence(
      privacy,
      'en',
      new Set(),
      '55555555-5555-4555-8555-555555555555',
    ).consentDecisions[0]?.decision).toBe('refused');
  });
});
