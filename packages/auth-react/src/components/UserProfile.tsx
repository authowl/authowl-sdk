'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { usePublicConfig, useUser } from '../hooks';
import { useT } from '../i18n';
import { UserProfileModal } from './user-profile/UserProfileModal';
import { UserProfileBody } from './user-profile/UserProfileBody';
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
  const [requested, setRequested] = React.useState<{ section: UserProfileSection } | undefined>(() => {
    const initial = section ?? defaultSection;
    return initial ? { section: initial } : undefined;
  });
  const [closeVersion, setCloseVersion] = React.useState(0);
  const previousSection = React.useRef(section);
  const [focusSection, setFocusSection] = React.useState<{ section: UserProfileSection } | null>(null);
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

  // Capture the incoming URL exactly once, including while config loads.
  const readHash = React.useRef(false);
  React.useEffect(() => {
    if (readHash.current) return;
    readHash.current = true;
    if (section !== undefined || defaultSection !== undefined) return;
    const next = userProfileSectionFromHash(window.location.hash);
    if (next) {
      setInternalSection(next);
      setRequested({ section: next });
      if (mode === 'page') setFocusSection({ section: next });
    }
  }, [defaultSection, mode, section]);

  React.useEffect(() => {
    if (mode !== 'page' || section !== undefined) return;
    const onHashChange = () => {
      const next = userProfileSectionFromHash(window.location.hash);
      if (next && sections.includes(next)) {
        setInternalSection(next);
        setRequested({ section: next });
        setFocusSection({ section: next });
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [mode, section, sections]);

  const visibleActive = sections.includes(active) ? active : 'profile';

  React.useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    setRequested(undefined);
    setCloseVersion((version) => version + 1);
    setFocusSection({ section: visibleActive });
  }, [section, visibleActive]);

  const select = (next: UserProfileSection) => {
    if (section === undefined) setInternalSection(next);
    setRequested(undefined);
    setCloseVersion((version) => version + 1);
    onSectionChange?.(next);
    setFocusSection({ section: next });
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
      mode={mode}
      disclosure={{ requested, closeVersion }}
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
