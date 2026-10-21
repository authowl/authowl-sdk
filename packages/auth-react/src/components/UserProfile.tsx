'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { usePublicConfig, useUser } from '../hooks';
import { Bidi, useT, type MessageKey } from '../i18n';
import { EmailSection } from './user-profile/EmailSection';
import { DeleteAccountSection } from './user-profile/DeleteAccountSection';
import { MfaSection } from './user-profile/MfaSection';
import { PasswordSection } from './user-profile/PasswordSection';
import { PasskeysSection } from './user-profile/PasskeysSection';
import { ProfileSection } from './user-profile/ProfileSection';
import { RecoverySection } from './user-profile/RecoverySection';
import { SessionsSection } from './user-profile/SessionsSection';
import { SocialSection } from './user-profile/SocialSection';
import { UserProfileModal } from './user-profile/UserProfileModal';
import { ProfileSectionFrame } from './user-profile/ProfileSectionFrame';
import { PrivacyCenter } from './PrivacyCenter';
import { AuthOwlBadge } from './AuthOwlBadge';
import { AuthOwlBranding } from './AuthOwlBranding';
import { resolveProjectCapabilities } from '../project-capabilities';
import {
  userProfileSectionsFor,
  userProfileGroupsFor,
  type UserProfileGroup,
  userProfileSectionFromHash,
  userProfileSectionHash,
  type UserProfileSection,
} from './user-profile/model';

type UserProfileSharedProps = {
  /** Controlled active section. */
  section?: UserProfileSection;
  /** Initial section when uncontrolled. Falls back to the AuthOwl URL hash. */
  defaultSection?: UserProfileSection;
  onSectionChange?: (section: UserProfileSection) => void;
  /** Called after the signed-in account is permanently deleted. */
  onDeleted?: () => void;
  /** Hide the project header when the host surface renders the same branding itself. */
  showBranding?: boolean;
};

export type UserProfileProps = UserProfileSharedProps & (
  | {
    /** Render the account settings inline. */
    mode?: 'page';
    onClose?: never;
  }
  | {
    /** Render an accessible account-settings overlay. */
    mode: 'modal';
    /** Called by the close button, backdrop, or Escape key. */
    onClose: () => void;
  }
);

const GROUP_KEYS: Record<UserProfileGroup, { title: MessageKey; subtitle: MessageKey }> = {
  profile: { title: 'userProfile.nav.profile', subtitle: 'userProfile.group.profile.description' },
  security: { title: 'userProfile.group.security', subtitle: 'userProfile.group.security.description' },
  connections: { title: 'userProfile.nav.social', subtitle: 'userProfile.group.connections.description' },
  privacy: { title: 'userProfile.nav.privacy', subtitle: 'userProfile.group.privacy.description' },
};

export function UserProfile(props: UserProfileProps = {}) {
  const slot = useSlot();
  const {
    section,
    defaultSection,
    onSectionChange,
    onDeleted,
    showBranding = true,
  } = props;
  const mode = props.mode ?? 'page';
  const t = useT();
  const { user, isLoaded, isSignedIn } = useUser();
  const { config } = usePublicConfig();
  const [internalSection, setInternalSection] = React.useState<UserProfileSection>(defaultSection ?? 'profile');
  const active = section ?? internalSection;
  const [focusSection, setFocusSection] = React.useState<UserProfileSection | null>(null);
  const capabilities = resolveProjectCapabilities(config);
  const passwordEnabled = config !== null && capabilities.passwordSignIn;
  const passkeysEnabled = capabilities.passkeySignIn || capabilities.passkeyAdd;
  const mfaEnabled = capabilities.totp;
  const recoveryEnabled = capabilities.backupCodes && user?.twoFactorEnabled === true;
  const deletionEnabled = capabilities.accountDeletion;
  const socialEnabled = (config?.socialProviders?.length ?? 0) > 0;
  const privacyEnabled = config?.privacy !== undefined;
  const sections = React.useMemo<readonly UserProfileSection[]>(
    () => userProfileSectionsFor({
      password: passwordEnabled,
      passkeys: passkeysEnabled,
      mfa: mfaEnabled,
      recovery: recoveryEnabled,
      accountDeletion: deletionEnabled,
      social: socialEnabled,
      privacy: privacyEnabled,
    }),
    [deletionEnabled, mfaEnabled, passkeysEnabled, passwordEnabled, privacyEnabled, recoveryEnabled, socialEnabled],
  );

  React.useEffect(() => {
    if (section !== undefined) return;
    const onHashChange = () => {
      const next = userProfileSectionFromHash(window.location.hash);
      if (next && sections.includes(next)) {
        setInternalSection(next);
        if (mode === 'page') setFocusSection(next);
      }
    };
    if (!defaultSection) onHashChange();
    if (mode !== 'page') return;
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [defaultSection, mode, section, sections]);

  const visibleActive = sections.includes(active) ? active : 'profile';
  const select = (next: UserProfileSection) => {
    if (section === undefined) setInternalSection(next);
    onSectionChange?.(next);
    setFocusSection(next);
    if (mode === 'page' && typeof window !== 'undefined') {
      window.history.replaceState(null, '', userProfileSectionHash(next));
    }
  };

  const content = !isLoaded ? (
    <div className={slot('ba-profile-loading')} aria-busy="true">
      <div className={slot('ba-skeleton')} /><div className={slot('ba-skeleton')} /><div className={slot('ba-skeleton')} />
    </div>
  ) : !isSignedIn || !user ? (
    <p className={slot('ba-muted')}>{t('userProfile.signedOut')}</p>
  ) : (
    <UserProfileBody
      key={user.id}
      active={visibleActive}
      focusSection={focusSection}
      sections={sections}
      onSelect={select}
      onDeleted={onDeleted}
      capabilities={capabilities}
    />
  );

  if (props.mode === 'modal') {
    return (
      <UserProfileModal
        onClose={props.onClose}
        branding={showBranding ? <AuthOwlBranding /> : null}
      >
        {content}
      </UserProfileModal>
    );
  }

  return (
    <article className={slot('ba-profile ba-profile-page')} data-testid="user-profile">
      {showBranding && <header className={slot('ba-profile-heading')}><AuthOwlBranding /></header>}
      {content}
      <footer className={slot('ba-profile-modal-footer')}>
        <AuthOwlBadge />
      </footer>
    </article>
  );
}

function UserProfileBody({
  active,
  focusSection,
  sections,
  onSelect,
  onDeleted,
  capabilities,
}: {
  active: UserProfileSection;
  focusSection: UserProfileSection | null;
  sections: readonly UserProfileSection[];
  onSelect: (section: UserProfileSection) => void;
  onDeleted?: () => void;
  capabilities: ReturnType<typeof resolveProjectCapabilities>;
}) {
  const slot = useSlot();
  const t = useT();
  const { user } = useUser();
  const groups = userProfileGroupsFor(sections);
  const group = groups.find((item) => item.sections.some((item) => item === active)) ?? groups[0]!;
  const contentRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (focusSection !== active) return;
    const heading = contentRef.current?.querySelector<HTMLElement>(`[data-profile-section="${active}"] h2`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({ block: 'nearest' });
  }, [active, focusSection]);
  const available = (item: UserProfileSection) => group.sections.some((section) => section === item);
  return (
    <div className={slot('ba-profile-layout')}>
      <nav className={slot('ba-profile-nav')} aria-label={t('userProfile.nav.aria')}>
        <div className={slot('ba-profile-identity')}>
          {user?.image ? <img className={slot('ba-profile-avatar')} src={user.image} alt="" /> : (
            <span className={slot('ba-profile-avatar')} aria-hidden="true">
              {(user?.name || user?.email || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
            </span>
          )}
          <div className={slot('ba-profile-identity-copy')}>
            <strong>{user?.name}</strong>
            <small><Bidi>{user?.email}</Bidi></small>
          </div>
        </div>
        {groups.map((item) => (
          <a
            key={item.id}
            href={userProfileSectionHash(item.sections[0]!)}
            className={slot('ba-profile-nav-item')}
            aria-current={group.id === item.id ? 'page' : undefined}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onSelect(item.sections[0]!);
            }}
          >
            {t(GROUP_KEYS[item.id].title)}
          </a>
        ))}
      </nav>
      <div key={group.id} ref={contentRef} className={slot('ba-profile-content ba-step')} data-section={active} data-group={group.id}>
        <header className={slot('ba-profile-group-heading')}>
          <h1 className={slot('ba-profile-group-title')}>{t(GROUP_KEYS[group.id].title)}</h1>
          <p className={slot('ba-profile-group-subtitle')}>{t(GROUP_KEYS[group.id].subtitle)}</p>
        </header>
        {available('profile') && (
          <ProfileSection
            firstLastName={capabilities.firstLastName}
            usernameEnabled={capabilities.collectUsername}
            legacyNameField={capabilities.legacyNameField}
          />
        )}
        {available('email') && <EmailSection allowChange={capabilities.emailChange} />}
        {available('password') && <PasswordSection />}
        {available('passkeys') && <PasskeysSection allowAdd={capabilities.passkeyAdd} />}
        {available('mfa') && <MfaSection />}
        {available('recovery') && <RecoverySection />}
        {available('sessions') && <SessionsSection />}
        {available('social') && <SocialSection />}
        {available('privacy') && (
          <ProfileSectionFrame section="privacy" title={t('userProfile.nav.privacy')} meta={t('userProfile.group.privacy.description')}>
            <PrivacyCenter />
          </ProfileSectionFrame>
        )}
        {available('danger') && <DeleteAccountSection onDeleted={onDeleted} />}
      </div>
    </div>
  );
}
