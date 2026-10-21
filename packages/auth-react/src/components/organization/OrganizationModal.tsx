'use client';
import { useSlot } from '../../elements';
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
  const slot = useSlot();
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
        <div className={slot('ba-organization-modal-header')}>
          <h2 id={titleId} className={slot('ba-title')}>{title}</h2>
          <button
            className={slot('ba-profile-close')}
            type="button"
            aria-label={t('organization.close')}
            onClick={onClose}
            autoFocus
          >
            ×
          </button>
        </div>
        <div className={slot('ba-organization-modal-body')}>{children}</div>
    </ModalSurface>
  );
}
