'use client';
import * as React from 'react';
import { useSlot } from '../../elements';
import { useUser } from '../../hooks';
import { Bidi, useT } from '../../i18n';
import type { resolveProjectCapabilities } from '../../project-capabilities';
import { Avatar } from '../Avatar';
import { PrivacyCenter } from '../PrivacyCenter';
import { EmailSection } from './EmailSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { MfaSection } from './MfaSection';
import { PasswordSection } from './PasswordSection';
import { PasskeysSection } from './PasskeysSection';
import { ProfileSection } from './ProfileSection';
import { RecoverySection } from './RecoverySection';
import { SessionsSection } from './SessionsSection';
import { SocialSection } from './SocialSection';
import { ProfileSectionDisclosure, ProfileDisclosureContext } from './ProfileSectionShell';
import { userProfileGroupsFor, userProfileSectionHash, type UserProfileSection } from './model';

export function UserProfileBody({
  active,
  mode,
  disclosure,
  focusSection,
  sections,
  onSelect,
  onDeleted,
  capabilities,
}: {
  active: UserProfileSection;
  mode: 'page' | 'modal';
  disclosure: React.ContextType<typeof ProfileDisclosureContext>;
  focusSection: { section: UserProfileSection } | null;
  sections: readonly UserProfileSection[];
  onSelect: (section: UserProfileSection) => void;
  onDeleted?: () => void;
  capabilities: ReturnType<typeof resolveProjectCapabilities>;
}) {
  const slot = useSlot();
  const t = useT();
  const { user } = useUser();
  const groups = userProfileGroupsFor(sections);
  const group = groups.find((item) => item.sections.some((item) => item === active)) ?? groups.find((item) => item.id === 'profile');
  const contentRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (focusSection?.section !== active) return;
    const heading = contentRef.current?.querySelector<HTMLElement>(`[data-profile-section="${active}"] h2`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({ block: 'nearest' });
  }, [active, focusSection]);
  if (!group) return null;
  const GroupTitle = mode === 'modal' ? 'h2' : 'h1';
  const SECTION_RENDERERS: Record<UserProfileSection, React.ReactNode> = {
    profile: <ProfileSection firstLastName={capabilities.firstLastName} usernameEnabled={capabilities.collectUsername} legacyNameField={capabilities.legacyNameField} />,
    email: <EmailSection allowChange={capabilities.emailChange} />,
    password: <PasswordSection passwordMinLength={capabilities.passwordMinLength} passwordMaxLength={capabilities.passwordMaxLength} />,
    passkeys: <PasskeysSection allowAdd={capabilities.passkeyAdd} />,
    mfa: <MfaSection required={capabilities.mfaRequired} />,
    recovery: <RecoverySection />,
    sessions: <SessionsSection />,
    social: <SocialSection />,
    privacy: <ProfileSectionDisclosure section="privacy"><PrivacyCenter title={null} /></ProfileSectionDisclosure>,
    danger: <DeleteAccountSection onDeleted={onDeleted} />,
  };
  return (
    <div className={slot('ba-profile-layout')}>
      <nav className={slot('ba-profile-nav')} aria-label={t('userProfile.nav.aria')}>
        <div className={slot('ba-profile-identity')}>
          <Avatar name={user?.name} email={user?.email} image={user?.image} profile />
          <div className={slot('ba-profile-identity-copy')}>
            <strong>{user?.name}</strong>
            {user?.email && <small><Bidi>{user.email}</Bidi></small>}
          </div>
        </div>
        {groups.map((item) => (
          <a
            key={item.id}
            href={userProfileSectionHash(item.sections[0])}
            className={slot('ba-profile-nav-item')}
            aria-current={group.id === item.id ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onSelect(item.sections[0]);
            }}
          >
            {t(item.title)}
          </a>
        ))}
      </nav>
      <div key={group.id} ref={contentRef} className={slot('ba-profile-content ba-step')} data-section={active} data-group={group.id}>
        <header className={slot('ba-profile-group-heading')}>
          <GroupTitle className={slot('ba-profile-group-title')}>{t(group.title)}</GroupTitle>
          <p className={slot('ba-profile-group-subtitle')}>{t(group.subtitle)}</p>
        </header>
        <ProfileDisclosureContext.Provider value={disclosure}>
          {group.sections.map((section) => <React.Fragment key={section}>{SECTION_RENDERERS[section]}</React.Fragment>)}
        </ProfileDisclosureContext.Provider>
      </div>
    </div>
  );
}
