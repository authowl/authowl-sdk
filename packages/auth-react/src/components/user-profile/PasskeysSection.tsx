'use client';
import { ProfileSectionDisclosure } from './ProfileSectionShell';
import { PasskeyManager } from '../PasskeyManager';

export function PasskeysSection({ allowAdd }: { allowAdd: boolean }) {
  return (
    <ProfileSectionDisclosure section="passkeys">
      <PasskeyManager title={null} allowAdd={allowAdd} />
    </ProfileSectionDisclosure>
  );
}
