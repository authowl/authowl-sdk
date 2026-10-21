'use client';
import { useSlot } from '../../elements';
import * as React from 'react';
import { useAccount, usePublicConfig } from '../../hooks';
import { useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { useAccountResource } from './use-account-resource';
import { FormError } from '../FormError';

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function SocialSection() {
  const slot = useSlot();
  const t = useT();
  const account = useAccount();
  const { config } = usePublicConfig();
  const mutation = useSubmitAction();
  const titleId = React.useId();
  const resource = useAccountResource(
    () => account.listSocialAccounts(),
    t('userProfile.social.loadError'),
  );
  const linked = resource.data ?? [];
  const linkedProviders = new Set(linked.map((item) => item.providerId));
  const available = resource.data === null
    ? []
    : (config?.socialProviders ?? []).filter((provider) => !linkedProviders.has(provider));

  const link = (provider: string) => {
    void mutation.run(
      () => account.linkSocial({
        provider,
        callbackURL: typeof window === 'undefined' ? undefined : window.location.href,
      }),
      {
        failure: t('userProfile.social.linkError'),
        onSuccess: (result) => {
          if (result.data?.url && typeof window !== 'undefined') {
            window.location.assign(result.data.url);
          }
        },
      },
    );
  };

  const unlink = (providerId: string, accountId: string, label: string) => {
    if (!window.confirm(t('userProfile.social.confirmDisconnect', { provider: label }))) return;
    void mutation.run(
      () => account.unlinkSocial({ providerId, accountId }),
      { failure: t('userProfile.social.unlinkError'), onSuccess: resource.load },
    );
  };

  return (
    <section className={slot('ba-profile-section')} aria-labelledby={titleId}>
      <header className={slot('ba-profile-section-header')}>
        <h2 id={titleId} className={slot('ba-title')}>{t('userProfile.social.title')}</h2>
        <p className={slot('ba-muted')}>{t('userProfile.social.description')}</p>
      </header>
      {resource.data === null ? (
        resource.loading
          ? <div className={slot('ba-profile-list-skeleton')} aria-busy="true"><div className={slot('ba-skeleton')} /></div>
          : null
      ) : (
        <ul className={slot('ba-profile-list')}>
          {linked.map((item) => (
            <li className={slot('ba-profile-list-item')} key={item.id}>
              <span>
                <strong>{providerLabel(item.providerId)}</strong>
                <small>
                  {item.canUnlink
                    ? t('userProfile.social.connected')
                    : t('userProfile.social.lastMethod')}
                </small>
              </span>
              <button
                className={slot('ba-link-button ba-danger')}
                type="button"
                disabled={mutation.pending || !item.canUnlink}
                onClick={() => unlink(
                  item.providerId,
                  item.accountId,
                  providerLabel(item.providerId),
                )}
              >
                {t('userProfile.social.disconnect')}
              </button>
            </li>
          ))}
          {linked.length === 0 && <li className={slot('ba-muted')}>{t('userProfile.social.empty')}</li>}
        </ul>
      )}
      {available.length > 0 && (
        <div className={slot('ba-profile-provider-actions')}>
          <p className={slot('ba-profile-subtitle')}>{t('userProfile.social.add')}</p>
          {available.map((provider) => (
            <button key={provider} type="button" className={slot('ba-button ba-button-secondary')} disabled={mutation.pending} onClick={() => link(provider)}>
              {t('userProfile.social.connectProvider', { provider: providerLabel(provider) })}
            </button>
          ))}
        </div>
      )}
      {resource.error && (
        <div className={slot('ba-profile-inline-error')}>
          <FormError>{resource.error}</FormError>
          <button className={slot('ba-link-button')} type="button" onClick={() => void resource.load()}>{t('userProfile.retry')}</button>
        </div>
      )}
      <FormError>{mutation.error}</FormError>
    </section>
  );
}
