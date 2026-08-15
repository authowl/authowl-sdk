'use client';
import * as React from 'react';
import { useT } from '../i18n';

export type ConsentDocLinksProps = {
  termsUrl?: string;
  privacyUrl?: string;
};

/**
 * Renders the "Terms of Service and Privacy Policy" links for whichever docs the
 * project configured (one, the other, or both joined with "and"). Returns null
 * when neither is set. Shared by <SignUp/>'s consent checkbox and <ConsentGate/>
 * so the link copy lives in one place. The caller supplies the surrounding
 * sentence ("I agree to the …", "We've updated our …").
 */
export function ConsentDocLinks({ termsUrl, privacyUrl }: ConsentDocLinksProps) {
  const t = useT();
  if (!termsUrl && !privacyUrl) return null;
  return (
    <>
      {termsUrl && (
        <a href={termsUrl} target="_blank" rel="noopener noreferrer">
          {t('consent.termsOfService')}
        </a>
      )}
      {termsUrl && privacyUrl && t('consent.docJoiner')}
      {privacyUrl && (
        <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
          {t('consent.privacyPolicy')}
        </a>
      )}
    </>
  );
}
