'use client';
import { ProfileRow, ProfileSectionShell } from './ProfileSectionShell';
import { useSlot } from '../../elements';
import { useAccount, useSession } from '../../hooks';
import { useLocale, useT } from '../../i18n';
import { useSubmitAction } from '../use-submit-action';
import { formatSessionTime, sortSessionsByRecency } from './model';
import { useAccountResource } from './use-account-resource';
import { FormError } from '../FormError';

export function SessionsSection() {
  const slot = useSlot();
  const t = useT();
  const locale = useLocale();
  const account = useAccount();
  const sessionState = useSession();
  const mutation = useSubmitAction();
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
    <ProfileSectionShell section="sessions" title={t('userProfile.sessions.title')} list>
      {resource.data === null ? (
        resource.loading
          ? <div className={slot('ba-profile-list-skeleton')} aria-busy="true"><div className={slot('ba-skeleton')} /><div className={slot('ba-skeleton')} /></div>
          : null
      ) : (
        <ul className={slot('ba-profile-list')}>
          {sessions.map((session) => {
            const label = session.userAgent?.trim() || t('userProfile.sessions.unknownDevice');
            return (
              <li key={session.id}>
                <ProfileRow section="sessions" title={label}
                  badge={session.id === currentId ? <span className={slot('ba-profile-pill')}>{t('userProfile.sessions.current')}</span> : undefined}
                  meta={formatSessionTime(session.updatedAt, locale)}
                  action={<button className={slot('ba-profile-row-button')} type="button" disabled={mutation.pending} onClick={() => revoke(session.id, label)}>
                    {t('userProfile.sessions.revoke')}
                  </button>} />
              </li>
            );
          })}
          {sessions.length === 0 && <li className={slot('ba-muted')}>{t('userProfile.sessions.empty')}</li>}
        </ul>
      )}
      {sessions.some((session) => session.id !== currentId) && (
        <button
          className={slot('ba-button ba-button-secondary ba-profile-submit')}
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
        <div className={slot('ba-profile-inline-error')}>
          <FormError>{resource.error}</FormError>
          <button className={slot('ba-link-button')} type="button" onClick={() => void resource.load()}>{t('userProfile.retry')}</button>
        </div>
      )}
      <FormError>{mutation.error}</FormError>
    </ProfileSectionShell>
  );
}
