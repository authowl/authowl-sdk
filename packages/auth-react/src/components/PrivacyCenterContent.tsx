'use client';

import * as React from 'react';
import type {
  PrivacyConsentPreference,
  PrivacyRightState,
  PrivacyRightType,
} from '@authowl/core';
import { useAuthClient, usePublicConfig, useUser } from '../hooks';
import { useLocale, useServerError, useT, type MessageKey } from '../i18n';
import { Busy } from './Spinner';
import { FormError } from './FormError';

const RIGHT_KEYS: Record<PrivacyRightType, MessageKey> = {
  access: 'privacy.right.access',
  correction: 'privacy.right.correction',
  portability: 'privacy.right.portability',
  erasure: 'privacy.right.erasure',
  restriction: 'privacy.right.restriction',
  objection: 'privacy.right.objection',
  consent_withdrawal: 'privacy.right.consentWithdrawal',
};

const STATE_KEYS: Record<PrivacyRightState, MessageKey> = {
  received: 'privacy.state.received',
  identity_pending: 'privacy.state.identityPending',
  in_progress: 'privacy.state.inProgress',
  restricted: 'privacy.state.restricted',
  completed: 'privacy.state.completed',
  denied: 'privacy.state.denied',
  withdrawn: 'privacy.state.withdrawn',
};

export type PrivacyCenterContentProps = {
  /** Optional class name on the privacy-center section. */
  className?: string;
};

export function PrivacyCenterContent({ className }: PrivacyCenterContentProps = {}) {
  const t = useT();
  const locale = useLocale();
  const toServerError = useServerError();
  const client = useAuthClient();
  const { config } = usePublicConfig();
  const { isLoaded, isSignedIn, user } = useUser();
  const [preferences, setPreferences] = React.useState<PrivacyConsentPreference[]>([]);
  const [requests, setRequests] = React.useState<Awaited<ReturnType<typeof loadPrivacy>>['requests']>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPurpose, setPendingPurpose] = React.useState<string | null>(null);
  const [pendingRight, setPendingRight] = React.useState<PrivacyRightType | null>(null);
  // Only the rights the server says it can accept. A project whose compliance
  // profile is not approved, or whose data sources do not cover an operation,
  // refuses that right - and offering the button anyway is how seven controls
  // that could only ever fail ended up in front of end users.
  //
  // ABSENT means an older server that cannot tell us; show everything, exactly
  // as this component did before the field existed.
  //
  // Declared with the other hooks, ABOVE the loading and signed-out returns:
  // below them it runs conditionally, which is a hook-order crash the moment
  // the component finishes loading.
  const offeredRights = React.useMemo(() => {
    const advertised = config?.privacy?.availableRightTypes;
    const all = Object.keys(RIGHT_KEYS) as PrivacyRightType[];
    return advertised === undefined ? all : all.filter((right) => advertised.includes(right));
  }, [config?.privacy?.availableRightTypes]);
  const refresh = React.useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setError(null);
    const result = await loadPrivacy(client);
    if (result.error) setError(toServerError(result.error, t('privacy.error.load')));
    else {
      setPreferences(result.preferences);
      setRequests(result.requests);
    }
    setLoading(false);
  }, [client, isSignedIn, t, toServerError]);

  React.useEffect(() => {
    if (isLoaded && isSignedIn) void refresh();
    else if (isLoaded) setLoading(false);
  }, [isLoaded, isSignedIn, refresh, user?.id]);

  if (!isLoaded || loading) {
    return (
      <section className={classes('ba-profile-section ba-privacy-center', className)} aria-busy="true">
        <div className="ba-skeleton" /><div className="ba-skeleton" /><div className="ba-skeleton" />
      </section>
    );
  }
  if (!isSignedIn) return <p className="ba-muted">{t('privacy.signedOut')}</p>;

  const privacy = config?.privacy;

  const preferenceByCode = new Map(preferences.map((item) => [item.code, item]));

  async function updateConsent(purposeCode: string, granted: boolean) {
    const purpose = privacy?.consentPurposes.find((item) => item.code === purposeCode);
    const notice = privacy?.notices.find((item) => item.purposeCodes.includes(purposeCode));
    if (!purpose || !notice) {
      setError(t('privacy.error.unavailable'));
      return;
    }
    setPendingPurpose(purposeCode);
    setError(null);
    const result = await client.privacy.recordConsent({
      purposeCode,
      purposeVersionId: purpose.purposeVersionId,
      noticeVersionId: notice.noticeVersionId,
      decision: granted ? 'granted' : 'withdrawn',
      locale,
    });
    if (result.error) setError(toServerError(result.error, t('privacy.error.save')));
    else await refresh();
    setPendingPurpose(null);
  }

  async function createRequest(rightType: PrivacyRightType) {
    setPendingRight(rightType);
    setError(null);
    const result = await client.privacy.createRightsRequest({ rightType, locale });
    if (result.error) setError(toServerError(result.error, t('privacy.error.request')));
    else await refresh();
    setPendingRight(null);
  }

  return (
    <section className={classes('ba-profile-section ba-privacy-center', className)} aria-labelledby="ba-privacy-title">
      <header className="ba-profile-section-header ba-privacy-center-header">
        <p className="ba-eyebrow">{t('privacy.dataUse')}</p>
        <h2 className="ba-title" id="ba-privacy-title">{t('privacy.title')}</h2>
        <p className="ba-muted">{t('privacy.description')}</p>
      </header>
      <FormError>{error}</FormError>

      <div className="ba-privacy-center-block">
        <div className="ba-privacy-center-block-heading">
          <h3>{t('privacy.choices.title')}</h3>
          <p>{t('privacy.choices.description')}</p>
        </div>
        {(privacy?.consentPurposes.length ?? 0) === 0 ? (
          <p className="ba-privacy-empty">{t('privacy.choices.empty')}</p>
        ) : (
          <div className="ba-privacy-center-choices">
            {privacy!.consentPurposes.map((purpose) => {
              const granted = preferenceByCode.get(purpose.code)?.state === 'granted';
              const pending = pendingPurpose === purpose.code;
              return (
                <div className="ba-privacy-center-choice" key={purpose.purposeVersionId}>
                  <span>
                    <strong>{purpose.title[locale]}</strong>
                    <small>{purpose.description[locale]}</small>
                  </span>
                  <button
                    type="button"
                    className="ba-privacy-toggle"
                    role="switch"
                    aria-checked={granted}
                    aria-label={purpose.title[locale]}
                    disabled={pending}
                    onClick={() => void updateConsent(purpose.code, !granted)}
                  >
                    <span aria-hidden="true" />
                    <b>{pending ? t('common.working') : granted ? t('privacy.on') : t('privacy.off')}</b>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="ba-privacy-center-block">
        <div className="ba-privacy-center-block-heading">
          <h3>{t('privacy.rights.title')}</h3>
          <p>{t('privacy.rights.description')}</p>
        </div>
        {offeredRights.length === 0 ? (
          <p className="ba-privacy-empty">{t('privacy.rights.unavailable')}</p>
        ) : (
          <div className="ba-privacy-right-grid">
            {offeredRights.map((right) => (
              <button
                type="button"
                className={right === 'erasure' ? 'ba-privacy-right ba-privacy-right-danger' : 'ba-privacy-right'}
                key={right}
                disabled={pendingRight !== null}
                onClick={() => void createRequest(right)}
              >
                <Busy busy={pendingRight === right} label={t('common.working')}>{t(RIGHT_KEYS[right])}</Busy>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ba-privacy-center-block">
        <div className="ba-privacy-center-block-heading">
          <h3>{t('privacy.requests.title')}</h3>
          <p>{t('privacy.requests.description')}</p>
        </div>
        {requests.length === 0 ? (
          <p className="ba-privacy-empty">{t('privacy.requests.empty')}</p>
        ) : (
          <ol className="ba-privacy-request-list">
            {requests.map((request) => (
              <li key={request.id}>
                <span><strong>{t(RIGHT_KEYS[request.rightType])}</strong><small>{formatCairo(request.receivedAt, locale)}</small></span>
                <b data-state={request.state}>{t(STATE_KEYS[request.state])}</b>
              </li>
            ))}
          </ol>
        )}
      </div>

      {(privacy?.notices.length ?? 0) > 0 && (
        <div className="ba-privacy-center-block">
          <div className="ba-privacy-center-block-heading">
            <h3>{t('privacy.notices.title')}</h3>
            <p>{t('privacy.notices.description')}</p>
          </div>
          <div className="ba-privacy-notices">
            {privacy!.notices.map((notice) => (
              <details className="ba-privacy-notice" key={notice.noticeVersionId}>
                <summary>{notice.title[locale]}</summary>
                <p>{notice.body[locale]}</p>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

async function loadPrivacy(client: ReturnType<typeof useAuthClient>) {
  const [consent, rights] = await Promise.all([
    client.privacy.listConsentPreferences({ retry: 2 }),
    client.privacy.listRightsRequests({ retry: 2 }),
  ]);
  return {
    preferences: consent.data?.preferences ?? [],
    requests: rights.data?.requests ?? [],
    error: consent.error ?? rights.error,
  };
}

function formatCairo(date: Date, locale: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    dateStyle: 'medium',
    timeZone: 'Africa/Cairo',
  }).format(date);
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
