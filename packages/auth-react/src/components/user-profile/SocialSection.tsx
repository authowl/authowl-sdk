'use client';
import { ProfileRow, ProfileSectionShell } from './ProfileSectionShell';
import { useSlot } from '../../elements';
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
    <ProfileSectionShell section="social" title={t('userProfile.social.title')} list>
      {resource.data === null ? (
        resource.loading
          ? <div className={slot('ba-profile-list-skeleton')} aria-busy="true"><div className={slot('ba-skeleton')} /></div>
          : null
      ) : (
        <ul className={slot('ba-profile-list')}>
          {linked.map((item) => (
            <li key={item.id}>
              <ProfileRow section="social" title={providerLabel(item.providerId)}
                meta={t(item.canUnlink ? 'userProfile.social.connected' : 'userProfile.social.lastMethod')}
                action={<button className={slot('ba-profile-row-button')} type="button" disabled={mutation.pending || !item.canUnlink}
                  onClick={() => unlink(item.providerId, item.accountId, providerLabel(item.providerId))}>
                  {t('userProfile.social.disconnect')}
                </button>} />
            </li>
          ))}
          {linked.length === 0 && <li className={slot('ba-muted')}>{t('userProfile.social.empty')}</li>}
        </ul>
      )}
      {available.length > 0 && (
        <ul className={slot('ba-profile-list')}>
          {available.map((provider) => (
            <li key={provider}>
              <ProfileRow section="social" title={providerLabel(provider)} meta={t('userProfile.social.add')}
                action={<button type="button" className={slot('ba-profile-row-button')} disabled={mutation.pending} onClick={() => link(provider)}>
                  {t('userProfile.social.connectProvider', { provider: providerLabel(provider) })}
                </button>} />
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
    </ProfileSectionShell>
  );
}
