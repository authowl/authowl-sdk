'use client';

import * as React from 'react';
import type { PublicConfig } from '@authowl/core';
import type { Locale } from '@authowl/core';
import { useT } from '../i18n';

type PrivacyConfig = NonNullable<PublicConfig['privacy']>;

export { buildPrivacySignUpEvidence } from '@authowl/core';

export function PrivacySignUpEvidence({
  privacy,
  locale,
  grantedPurposeCodes,
  onPurposeChange,
}: {
  privacy: PrivacyConfig;
  locale: Locale;
  grantedPurposeCodes: ReadonlySet<string>;
  onPurposeChange: (purposeCode: string, granted: boolean) => void;
}) {
  const t = useT();
  if (privacy.notices.length === 0 && privacy.consentPurposes.length === 0) return null;

  return (
    <section className="ba-privacy-signup" aria-labelledby="ba-privacy-signup-title">
      <header className="ba-privacy-signup-header">
        <p className="ba-eyebrow">{t('privacy.dataUse')}</p>
        <h3 id="ba-privacy-signup-title">{t('privacy.signup.title')}</h3>
        <p>{t('privacy.signup.description')}</p>
      </header>

      {privacy.notices.length > 0 && (
        <div className="ba-privacy-notices">
          {privacy.notices.map((notice, index) => (
            <details className="ba-privacy-notice" key={notice.noticeVersionId} open={index === 0}>
              <summary>{notice.title[locale]}</summary>
              <p>{notice.body[locale]}</p>
            </details>
          ))}
        </div>
      )}

      {privacy.consentPurposes.length > 0 && (
        <fieldset className="ba-privacy-purpose-list">
          <legend>{t('privacy.signup.optional')}</legend>
          {privacy.consentPurposes.map((purpose) => (
            <label className="ba-privacy-purpose" key={purpose.purposeVersionId}>
              <span className="ba-checkbox-control">
                <input
                  className="ba-checkbox"
                  type="checkbox"
                  checked={grantedPurposeCodes.has(purpose.code)}
                  onChange={(event) => onPurposeChange(purpose.code, event.target.checked)}
                />
                <span className="ba-checkbox-visual"><span className="ba-checkbox-check" /></span>
              </span>
              <span>
                <strong>{purpose.title[locale]}</strong>
                <small>{purpose.description[locale]}</small>
              </span>
            </label>
          ))}
          <p className="ba-privacy-choice-note">{t('privacy.signup.choiceNote')}</p>
        </fieldset>
      )}
    </section>
  );
}
