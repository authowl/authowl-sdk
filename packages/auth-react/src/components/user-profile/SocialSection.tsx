'use client';
import { ProfileIcon } from './ProfileSectionFrame';
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
    <section className={slot('ba-profile-section')} aria-labelledby={titleId} data-profile-section="social">
      <header className={slot('ba-profile-section-header')}>
        <h2 id={titleId} tabIndex={-1} className={slot('ba-profile-section-title')}>{t('userProfile.social.title')}</h2>
      </header>
      {resource.data === null ? (
        resource.loading
          ? <div className={slot('ba-profile-list-skeleton')} aria-busy="true"><div className={slot('ba-skeleton')} /></div>
          : null
      ) : (
        <ul className={slot('ba-profile-list')}>
          {linked.map((item) => (
            <li className={slot('ba-profile-list-item')} key={item.id}>
              <ProfileIcon section="social" />
              <span className={slot('ba-profile-row-copy')}>
                <strong>{providerLabel(item.providerId)}</strong>
                <small>
                  {item.canUnlink
                    ? t('userProfile.social.connected')
                    : t('userProfile.social.lastMethod')}
                </small>
              </span>
              <button
                className={slot('ba-profile-row-button')}
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
        <ul className={slot('ba-profile-list')}>
          {available.map((provider) => (
            <li key={provider} className={slot('ba-profile-list-item')}>
              <ProfileIcon section="social" />
              <span className={slot('ba-profile-row-copy')}>
                <strong className={slot('ba-profile-row-title')}>{providerLabel(provider)}</strong>
                <small className={slot('ba-profile-row-meta')}>{t('userProfile.social.add')}</small>
              </span>
              <button type="button" className={slot('ba-profile-row-button')} disabled={mutation.pending} onClick={() => link(provider)}>
                {t('userProfile.social.connectProvider', { provider: providerLabel(provider) })}
              </button>
            </li>
          ))}
        </ul>
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
