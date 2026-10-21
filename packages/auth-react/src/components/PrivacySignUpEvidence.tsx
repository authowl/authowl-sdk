'use client';
import { useSlot } from '../elements';


import * as React from 'react';
import type { PublicConfig } from '@authowl/core';
import type { Locale } from '@authowl/core';
import { useT } from '../i18n';

type PrivacyConfig = NonNullable<PublicConfig['privacy']>;

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
  const slot = useSlot();
  const t = useT();
  if (privacy.notices.length === 0 && privacy.consentPurposes.length === 0) return null;

  return (
    <section className={slot('ba-privacy-signup')} aria-labelledby="ba-privacy-signup-title">
      <header className={slot('ba-privacy-signup-header')}>
        <p className={slot('ba-eyebrow')}>{t('privacy.dataUse')}</p>
        <h3 id="ba-privacy-signup-title">{t('privacy.signup.title')}</h3>
        <p>{t('privacy.signup.description')}</p>
      </header>

      {privacy.notices.length > 0 && (
        <div className={slot('ba-privacy-notices')}>
          {privacy.notices.map((notice, index) => (
            <details className={slot('ba-privacy-notice')} key={notice.noticeVersionId} open={index === 0}>
              <summary>{notice.title[locale]}</summary>
              <p>{notice.body[locale]}</p>
            </details>
          ))}
        </div>
      )}

      {privacy.consentPurposes.length > 0 && (
        <fieldset className={slot('ba-privacy-purpose-list')}>
          <legend>{t('privacy.signup.optional')}</legend>
          {privacy.consentPurposes.map((purpose) => (
            <label className={slot('ba-privacy-purpose')} key={purpose.purposeVersionId}>
              <span className={slot('ba-checkbox-control')}>
                <input
                  className={slot('ba-checkbox')}
                  type="checkbox"
                  checked={grantedPurposeCodes.has(purpose.code)}
                  onChange={(event) => onPurposeChange(purpose.code, event.target.checked)}
                />
                <span className={slot('ba-checkbox-visual')}><span className={slot('ba-checkbox-check')} /></span>
              </span>
              <span>
                <strong>{purpose.title[locale]}</strong>
                <small>{purpose.description[locale]}</small>
              </span>
            </label>
          ))}
          <p className={slot('ba-privacy-choice-note')}>{t('privacy.signup.choiceNote')}</p>
        </fieldset>
      )}
    </section>
  );
}
