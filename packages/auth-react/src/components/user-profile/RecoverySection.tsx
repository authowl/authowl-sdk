'use client';
import * as React from 'react';
import { useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { BackupCodesManager } from '../BackupCodesManager';

export function RecoverySection() {
  const t = useT();
  const { user } = useUser();
  const titleId = React.useId();
  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.recovery.title')}</h2>
        <p className="ba-muted">{t('userProfile.recovery.description')}</p>
      </header>
      <div className="ba-profile-recovery-card">
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
