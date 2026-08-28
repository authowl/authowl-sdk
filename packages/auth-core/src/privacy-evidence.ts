import { createIdempotencyKey } from './idempotency';
import type { PublicConfig } from './public-config';
import type { PrivacyLocale } from './privacy-client';

type PrivacyPublicConfig = NonNullable<PublicConfig['privacy']>;

/**
 * Build the exact notice-delivery and optional-purpose evidence accepted by
 * sign-up. Shared by browser and native UI so every managed surface emits the
 * same version-pinned contract.
 */
export function buildPrivacySignUpEvidence(
  privacy: PrivacyPublicConfig,
  locale: PrivacyLocale,
  grantedPurposeCodes: ReadonlySet<string>,
  correlationId: string = createIdempotencyKey(),
) {
  return {
    locale,
    correlationId,
    noticeVersionIds: privacy.notices.map((notice) => notice.noticeVersionId),
    consentDecisions: privacy.consentPurposes.flatMap((purpose) => {
      const notice = privacy.notices.find((candidate) =>
        candidate.purposeCodes.includes(purpose.code));
      if (!notice) return [];
      return [{
        purposeCode: purpose.code,
        purposeVersionId: purpose.purposeVersionId,
        noticeVersionId: notice.noticeVersionId,
        decision: grantedPurposeCodes.has(purpose.code) ? 'granted' as const : 'refused' as const,
        guardianRequired: false,
        guardianEvidenceId: null,
      }];
    }),
  };
}
