'use client';
import * as React from 'react';
import { useAccount, useSession } from '../../hooks';
import { useLocale, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { formatSessionTime, sortSessionsByRecency } from './model';
import { useAccountResource } from './use-account-resource';
import { FormError } from '../FormError';

export function SessionsSection() {
  const t = useT();
  const locale = useLocale();
  const account = useAccount();
  const sessionState = useSession();
  const mutation = useSubmitAction();
  const titleId = React.useId();
  const resource = useAccountResource(
    () => account.listSessions(),
    t('userProfile.sessions.loadError'),
  );
  const sessions = sortSessionsByRecency(resource.data ?? []);
  const currentId = sessionState.data?.session.id;

  const revoke = (id: string, label: string) => {
    if (!window.confirm(t('userProfile.sessions.confirm', { device: label }))) return;
    void mutation.run(
      () => account.revokeSession({ sessionId: id }),
      {
        failure: t('userProfile.sessions.revokeError'),
        onSuccess: async () => {
          await resource.load();
          if (id === currentId) {
            sessionState.refetch({ query: { disableCookieCache: true } });
          }
        },
      },
    );
  };

  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.sessions.title')}</h2>
        <p className="ba-muted">{t('userProfile.sessions.description')}</p>
      </header>
      {resource.data === null ? (
        resource.loading
          ? <div className="ba-profile-list-skeleton" aria-busy="true"><div className="ba-skeleton" /><div className="ba-skeleton" /></div>
          : null
      ) : (
        <ul className="ba-profile-list">
          {sessions.map((session) => {
            const label = session.userAgent?.trim() || t('userProfile.sessions.unknownDevice');
            return (
              <li className="ba-profile-list-item" key={session.id}>
                <span>
                  <strong>{label}</strong>
                  <small>
                    {session.id === currentId && <em>{t('userProfile.sessions.current')}</em>}
                    {formatSessionTime(session.updatedAt, locale)}
                  </small>
                </span>
                <button className="ba-link-button ba-danger" type="button" disabled={mutation.pending} onClick={() => revoke(session.id, label)}>
                  {t('userProfile.sessions.revoke')}
                </button>
              </li>
            );
          })}
          {sessions.length === 0 && <li className="ba-muted">{t('userProfile.sessions.empty')}</li>}
        </ul>
      )}
      {sessions.some((session) => session.id !== currentId) && (
        <button
          className="ba-button ba-button-secondary ba-profile-submit"
          type="button"
          disabled={mutation.pending}
          onClick={() => {
            if (!window.confirm(t('userProfile.sessions.confirmOthers'))) return;
            void mutation.run(
              () => account.revokeOtherSessions(),
              { failure: t('userProfile.sessions.revokeError'), onSuccess: resource.load },
            );
          }}
        >
          {t('userProfile.sessions.revokeOthers')}
        </button>
      )}
      {resource.error && (
        <div className="ba-profile-inline-error">
          <FormError>{resource.error}</FormError>
          <button className="ba-link-button" type="button" onClick={() => void resource.load()}>{t('userProfile.retry')}</button>
        </div>
      )}
      <FormError>{mutation.error}</FormError>
    </section>
  );
}
