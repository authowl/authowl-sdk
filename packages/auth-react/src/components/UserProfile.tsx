'use client';
import * as React from 'react';
import { usePublicConfig, useUser } from '../hooks';
import { useT, type MessageKey } from '../i18n';
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
import { PrivacyCenter } from './PrivacyCenter';
import { AuthOwlBadge } from './AuthOwlBadge';
import { AuthOwlBranding } from './AuthOwlBranding';
import { resolveProjectCapabilities } from '../project-capabilities';
import {
  userProfileSectionsFor,
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

const SECTION_KEYS: Record<UserProfileSection, MessageKey> = {
  profile: 'userProfile.nav.profile',
  email: 'userProfile.nav.email',
  password: 'userProfile.nav.password',
  social: 'userProfile.nav.social',
  sessions: 'userProfile.nav.sessions',
  passkeys: 'userProfile.nav.passkeys',
  mfa: 'userProfile.nav.mfa',
  recovery: 'userProfile.nav.recovery',
  privacy: 'userProfile.nav.privacy',
  danger: 'userProfile.nav.danger',
};

function initialSection(fallback?: UserProfileSection): UserProfileSection {
  if (fallback) return fallback;
  if (typeof window === 'undefined') return 'profile';
  return userProfileSectionFromHash(window.location.hash) ?? 'profile';
}

export function UserProfile(props: UserProfileProps = {}) {
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
  const [internalSection, setInternalSection] = React.useState(() => initialSection(defaultSection));
  const active = section ?? internalSection;
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
    if (section || mode !== 'page') return;
    const onHashChange = () => {
      const next = userProfileSectionFromHash(window.location.hash);
      if (next && sections.includes(next)) setInternalSection(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [mode, section, sections]);

  const visibleActive = sections.includes(active) ? active : 'profile';
  const select = (next: UserProfileSection) => {
    if (section === undefined) setInternalSection(next);
    onSectionChange?.(next);
    if (mode === 'page' && typeof window !== 'undefined') {
      window.history.replaceState(null, '', userProfileSectionHash(next));
    }
  };

  const content = !isLoaded ? (
    <div className="ba-profile-loading" aria-busy="true">
      <div className="ba-skeleton" /><div className="ba-skeleton" /><div className="ba-skeleton" />
    </div>
  ) : !isSignedIn || !user ? (
    <p className="ba-muted">{t('userProfile.signedOut')}</p>
  ) : (
    <UserProfileBody
      key={user.id}
      active={visibleActive}
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
    <article className="ba-profile ba-profile-page" data-testid="user-profile">
      <header className="ba-profile-heading">
        {showBranding ? <AuthOwlBranding /> : null}
        <h1>{t('userProfile.title')}</h1>
        <p>{t('userProfile.description')}</p>
      </header>
      {content}
      <footer className="ba-profile-modal-footer">
        <AuthOwlBadge />
      </footer>
    </article>
  );
}

function UserProfileBody({
  active,
  sections,
  onSelect,
  onDeleted,
  capabilities,
}: {
  active: UserProfileSection;
  sections: readonly UserProfileSection[];
  onSelect: (section: UserProfileSection) => void;
  onDeleted?: () => void;
  capabilities: ReturnType<typeof resolveProjectCapabilities>;
}) {
  const t = useT();
  return (
    <div className="ba-profile-layout">
      <nav className="ba-profile-nav" aria-label={t('userProfile.nav.aria')}>
        {sections.map((item) => (
          <button
            key={item}
            type="button"
            className="ba-profile-nav-item"
            aria-current={active === item ? 'page' : undefined}
            onClick={() => onSelect(item)}
          >
            {t(SECTION_KEYS[item])}
          </button>
        ))}
      </nav>
      <div className="ba-profile-content" data-section={active}>
        {active === 'profile' && (
          <ProfileSection
            firstLastName={capabilities.firstLastName}
            usernameEnabled={capabilities.collectUsername}
            legacyNameField={capabilities.legacyNameField}
          />
        )}
        {active === 'email' && <EmailSection allowChange={capabilities.emailChange} />}
        {active === 'password' && <PasswordSection />}
        {active === 'social' && <SocialSection />}
        {active === 'sessions' && <SessionsSection />}
        {active === 'passkeys' && <PasskeysSection allowAdd={capabilities.passkeyAdd} />}
        {active === 'mfa' && <MfaSection />}
        {active === 'recovery' && <RecoverySection />}
        {active === 'privacy' && <PrivacyCenter />}
        {active === 'danger' && <DeleteAccountSection onDeleted={onDeleted} />}
      </div>
    </div>
  );
}
