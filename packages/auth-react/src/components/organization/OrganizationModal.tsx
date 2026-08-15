'use client';
import * as React from 'react';
import { useT } from '../../i18n';
import { ModalSurface } from '../ModalSurface';

export function OrganizationModal({
  title,
  onClose,
  returnFocusRef,
  children,
}: {
  title: string;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const t = useT();
  const titleId = React.useId();

  return (
    <ModalSurface
      overlayClassName="ba-organization-overlay"
      panelClassName="ba-organization-modal"
      labelledBy={titleId}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
        <div className="ba-organization-modal-header">
          <h2 id={titleId} className="ba-title">{title}</h2>
          <button
            className="ba-profile-close"
            type="button"
            aria-label={t('organization.close')}
            onClick={onClose}
            autoFocus
          >
            ×
          </button>
        </div>
        <div className="ba-organization-modal-body">{children}</div>
    </ModalSurface>
  );
}
