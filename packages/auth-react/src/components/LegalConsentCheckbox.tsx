'use client';
import * as React from 'react';
import type { PublicConfig } from '@authowl/core';
import { richMessage, useT } from '../i18n';
import { ConsentDocLinks } from './ConsentDocLinks';

export type LegalConsentCheckboxProps = {
  legal: PublicConfig['legal'];
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  testId?: string;
};

/** Shared required-consent control for every SDK flow that may create a user. */
export function LegalConsentCheckbox({
  legal,
  accepted,
  onAcceptedChange,
  testId,
}: LegalConsentCheckboxProps) {
  const t = useT();
  if (!legal.required) return null;
  return (
    <label className="ba-consent" data-testid={testId}>
      <span className="ba-checkbox-control">
        <input
          className="ba-checkbox"
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
        />
        <span className="ba-checkbox-visual" aria-hidden="true">
          <span className="ba-checkbox-check" />
        </span>
      </span>
      <span>
        {richMessage(t('signUp.consentLabel'), {
          links: <ConsentDocLinks termsUrl={legal.termsUrl} privacyUrl={legal.privacyUrl} />,
        })}
      </span>
    </label>
  );
}
