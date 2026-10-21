'use client';
import { useSlot } from '../../elements';
import * as React from 'react';
import { useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { BackupCodesManager } from '../BackupCodesManager';

export function RecoverySection() {
  const slot = useSlot();
  const t = useT();
  const { user } = useUser();
  const titleId = React.useId();
  return (
    <section className={slot('ba-profile-section')} aria-labelledby={titleId}>
      <header className={slot('ba-profile-section-header')}>
        <h2 id={titleId} className={slot('ba-title')}>{t('userProfile.recovery.title')}</h2>
        <p className={slot('ba-muted')}>{t('userProfile.recovery.description')}</p>
      </header>
      <div className={slot('ba-profile-recovery-card')}>
        <strong>{t('userProfile.recovery.emailTitle')}</strong>
        {user?.email && user.emailVerified ? (
          <>
            <p>{t('userProfile.recovery.emailDescription')}</p>
            <Bidi>{user.email}</Bidi>
          </>
        ) : (
          <p>{t('userProfile.recovery.emailUnavailable')}</p>
        )}
      </div>
      <BackupCodesManager title={null} />
    </section>
  );
}
