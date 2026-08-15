'use client';
import * as React from 'react';
import { useT } from '../../i18n';
import { ModalSurface } from '../ModalSurface';
import { AuthOwlBadge } from '../AuthOwlBadge';

export function UserProfileModal({
  children,
  onClose,
  branding,
}: {
  children: React.ReactNode;
  onClose: () => void;
  branding?: React.ReactNode;
}) {
  const t = useT();
  const titleId = React.useId();

  return (
    <ModalSurface
      overlayClassName="ba-profile-overlay"
      panelClassName="ba-profile ba-profile-modal"
      labelledBy={titleId}
      testId="user-profile-modal"
      onClose={onClose}
    >
        <div className="ba-profile-modal-header">
          <span>
            {branding}
            <h1 id={titleId}>{t('userProfile.title')}</h1>
            <p>{t('userProfile.description')}</p>
          </span>
          <button
            type="button"
            className="ba-profile-close"
            aria-label={t('userProfile.close')}
            onClick={onClose}
            autoFocus
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {children}
        <footer className="ba-profile-modal-footer">
          <AuthOwlBadge />
        </footer>
    </ModalSurface>
  );
}
