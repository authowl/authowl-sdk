'use client';
import * as React from 'react';
import { useMFA, usePublicConfig, useSession, useUser } from '../../hooks';
import { useT } from '../../i18n';
import { MFAEnrollment } from '../MFAEnrollment';
import { useSubmitAction } from '../use-submit-action';
import { Busy } from '../Spinner';
import { FormError } from '../FormError';
import { resolveProjectCapabilities } from '../../project-capabilities';

export function MfaSection() {
  const t = useT();
  const { user } = useUser();
  const session = useSession();
  const { config } = usePublicConfig();
  const { disable } = useMFA();
  const { pending, error, run } = useSubmitAction();
  const [password, setPassword] = React.useState('');
  const [showDisable, setShowDisable] = React.useState(false);
  const titleId = React.useId();
  const required = resolveProjectCapabilities(config).mfaRequired;

  if (!user?.twoFactorEnabled) {
    return (
      <section className="ba-profile-section" aria-labelledby={titleId}>
        <header className="ba-profile-section-header">
          <h2 id={titleId} className="ba-title">{t('userProfile.mfa.title')}</h2>
          <p className="ba-muted">
            {required
              ? t('userProfile.mfa.requiredDescription')
              : t('userProfile.mfa.description')}
          </p>
        </header>
        <MFAEnrollment
          title={null}
          onEnrolled={() => session.refetch({ query: { disableCookieCache: true } })}
        />
      </section>
    );
  }

  const submitDisable = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () => disable({ password }),
      {
        failure: t('userProfile.mfa.disableError'),
        onSuccess: () => {
          setPassword('');
          setShowDisable(false);
          session.refetch({ query: { disableCookieCache: true } });
        },
      },
    );
  };

  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.mfa.title')}</h2>
        <p className="ba-muted">
          {required ? t('userProfile.mfa.requiredActive') : t('userProfile.mfa.active')}
        </p>
      </header>
      <div className="ba-profile-status" role="status">
        <strong>{t('userProfile.mfa.enabled')}</strong>
        <span>{t('userProfile.mfa.authenticator')}</span>
      </div>
      {!showDisable ? (
        <button
          className="ba-button ba-button-secondary ba-profile-submit"
          type="button"
          onClick={() => setShowDisable(true)}
        >
          {required ? t('userProfile.mfa.replace') : t('userProfile.mfa.disable')}
        </button>
      ) : (
        <form method="post" className="ba-fields ba-profile-security-form" onSubmit={submitDisable}>
          <p className="ba-muted">
            {required ? t('userProfile.mfa.replaceWarning') : t('userProfile.mfa.disableWarning')}
          </p>
          <label className="ba-label">
            {t('common.passwordLabel')}
            <input
              className="ba-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <FormError>{error}</FormError>
          <span className="ba-profile-action-row">
            <button
              className="ba-button ba-danger-button"
              type="submit"
              disabled={pending || !password}
              aria-busy={pending || undefined}
            >
              <Busy busy={pending} label={t('common.working')}>
                {required ? t('userProfile.mfa.replaceConfirm') : t('userProfile.mfa.disableConfirm')}
              </Busy>
            </button>
            <button
              className="ba-button ba-button-secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setShowDisable(false);
                setPassword('');
              }}
            >
              {t('userProfile.cancel')}
            </button>
          </span>
        </form>
      )}
    </section>
  );
}
