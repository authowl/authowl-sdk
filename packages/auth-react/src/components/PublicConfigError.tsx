'use client';
import * as React from 'react';
import { usePublicConfig } from '../hooks';
import { useT } from '../i18n';
import { AuthOwlBadge } from './AuthOwlBadge';
import { AuthOwlBranding } from './AuthOwlBranding';

export type PublicConfigErrorProps = {
  showBadge?: boolean;
  showBranding?: boolean;
};

/** Fail-closed state shared by the sign-in and sign-up drop-ins. */
export function PublicConfigError({
  showBadge,
  showBranding = true,
}: PublicConfigErrorProps) {
  const t = useT();
  const { retry } = usePublicConfig();

  return (
    <div className="ba-form" data-testid="authowl-config-error" role="alert">
      {showBranding ? <AuthOwlBranding /> : null}
      <h2 className="ba-title">{t('publicConfig.error.title')}</h2>
      <p className="ba-muted">{t('publicConfig.error.description')}</p>
      <button className="ba-button" type="button" onClick={retry}>
        {t('publicConfig.retry')}
      </button>
      <AuthOwlBadge force={showBadge} />
    </div>
  );
}
