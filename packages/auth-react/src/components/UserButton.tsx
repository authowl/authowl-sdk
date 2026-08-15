'use client';
import * as React from 'react';
import { useUser, useSignOut } from '../hooks';
import { useT } from '../i18n';
import { UserProfile } from './UserProfile';
import { AuthOwlBadge } from './AuthOwlBadge';

export function UserButton() {
  const t = useT();
  const { user, isLoaded } = useUser();
  const { signOut } = useSignOut();
  const [open, setOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  if (!isLoaded || !user) return null;
  const identity = user.email ?? user.phoneNumber ?? user.name ?? '?';

  return (
    <div className="ba-user-button" data-testid="user-button">
      <button
        ref={triggerRef}
        className="ba-user-button-trigger"
        aria-label={t('userButton.openMenuAria')}
        onClick={() => setOpen((v) => !v)}
      >
        {user.image ? (
          <img className="ba-avatar" src={user.image} alt="" />
        ) : (
          <span className="ba-avatar ba-avatar-fallback">{identity[0]?.toUpperCase()}</span>
        )}
      </button>
      {open && (
        <div className="ba-menu">
          <p className="ba-menu-label">{identity}</p>
          <button
            className="ba-menu-item"
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
          >
            {t('userButton.manageAccount')}
          </button>
          <button className="ba-menu-item" onClick={() => signOut()}>
            {t('userButton.signOut')}
          </button>
          <div className="ba-menu-badge">
            <AuthOwlBadge />
          </div>
        </div>
      )}
      {profileOpen && (
        <UserProfile
          mode="modal"
          defaultSection="profile"
          onDeleted={() => setProfileOpen(false)}
          onClose={() => {
            setProfileOpen(false);
            window.setTimeout(() => triggerRef.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
}
