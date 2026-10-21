'use client';
import { ProfileSectionDisclosure } from './ProfileSectionShell';
import { useSlot } from '../../elements';
import { useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import { BackupCodesManager } from '../BackupCodesManager';

export function RecoverySection() {
  return (
    <ProfileSectionDisclosure section="recovery">
      <RecoverySectionContent />
    </ProfileSectionDisclosure>
  );
}

function RecoverySectionContent() {
  const slot = useSlot();
  const t = useT();
  const { user } = useUser();
  return (
    <>
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
    </>
  );
}
