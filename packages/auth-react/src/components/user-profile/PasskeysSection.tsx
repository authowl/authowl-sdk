'use client';
import { ProfileSectionFrame } from './ProfileSectionFrame';
import { useT } from '../../i18n';
import { PasskeyManager } from '../PasskeyManager';

export function PasskeysSection({ allowAdd }: { allowAdd: boolean }) {
  const t = useT();
  return (
    <ProfileSectionFrame section="passkeys" title={t('userProfile.passkeys.title')} meta={t('userProfile.passkeys.description')} action={allowAdd ? t('passkeys.add') : t('userProfile.manage')}>
      <PasskeyManager title={null} allowAdd={allowAdd} />
    </ProfileSectionFrame>
  );
}
