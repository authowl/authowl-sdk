'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { useUser, useSignOut } from '../hooks';
import { useT } from '../i18n';
import { UserProfile } from './UserProfile';
import { Avatar } from './Avatar';
import { AuthOwlBadge } from './AuthOwlBadge';

export function UserButton() {
  const slot = useSlot();
  const t = useT();
  const { user, isLoaded } = useUser();
  const { signOut } = useSignOut();
  const [open, setOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  if (!isLoaded || !user) return null;
  const identity = user.email ?? user.phoneNumber ?? user.name ?? '?';

  return (
    <div className={slot('ba-user-button')} data-testid="user-button">
      <button
        ref={triggerRef}
        className={slot('ba-user-button-trigger')}
        aria-label={t('userButton.openMenuAria')}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} email={user.email} image={user.image} />
      </button>
      {open && (
        <div className={slot('ba-menu')}>
          <p className={slot('ba-menu-label')}>{identity}</p>
          <button
            className={slot('ba-menu-item')}
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
          >
            {t('userButton.manageAccount')}
          </button>
          <button className={slot('ba-menu-item')} onClick={() => signOut()}>
            {t('userButton.signOut')}
          </button>
          <div className={slot('ba-menu-badge')}>
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
