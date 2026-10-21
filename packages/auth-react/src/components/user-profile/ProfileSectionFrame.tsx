'use client';
import * as React from 'react';
import { useSlot } from '../../elements';
import { useT } from '../../i18n';
import type { UserProfileSection } from './model';

const ICON_PATHS: Record<UserProfileSection, string> = {
  profile: 'M20 21v-2a7 7 0 0 0-14 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  email: 'M3 5h18v14H3zM3 5l9 8 9-8',
  password: 'M4 10h16v11H4zM8 10V7a4 4 0 0 1 8 0v3',
  passkeys: 'M12 11v3M8 18c1-2 1-4 1-7a3 3 0 0 1 6 0c0 3 0 6-1 9M5 14v-3a7 7 0 0 1 14 0v6',
  mfa: 'M12 3l7 3v5c0 5-4 8-7 10-3-2-7-5-7-10V6zM9 12l2 2 4-4',
  recovery: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  sessions: 'M3 5h18v12H3zM8 21h8M12 17v4',
  social: 'M10 14l4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M13 17a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  privacy: 'M12 3l8 4v5c0 4-4 7-8 9-4-2-8-5-8-9V7z',
  danger: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
};

export function ProfileIcon({ section }: { section: UserProfileSection }) {
  const slot = useSlot();
  return <span className={slot('ba-profile-icon')} aria-hidden="true">
    <svg className={slot('ba-profile-icon-svg')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON_PATHS[section]} />
    </svg>
  </span>;
}

/** The summary owns presentation only; the child retains its security workflow. */
export function ProfileSectionFrame({ section, title, meta, action, children }: {
  section: UserProfileSection;
  title: string;
  meta: React.ReactNode;
  action?: string;
  children?: React.ReactNode;
}) {
  const slot = useSlot();
  const t = useT();
  const titleId = React.useId();
  const bodyId = React.useId();
  const [open, setOpen] = React.useState(false);
  return (
    <section className={slot('ba-profile-section')} data-profile-section={section} aria-labelledby={titleId}>
      <h2 id={titleId} tabIndex={-1} className={slot('ba-profile-section-title')}>{title}</h2>
      <div className={slot('ba-profile-row')}>
        <ProfileIcon section={section} />
        <div className={slot('ba-profile-row-copy')}>
          <strong className={slot('ba-profile-row-title')}>{title}</strong>
          <span className={slot('ba-profile-row-meta')}>{meta}</span>
        </div>
        {children && <button type="button" className={slot('ba-profile-row-button')} aria-expanded={open} aria-controls={bodyId} aria-describedby={titleId} aria-label={open ? `${title}: ${t('common.cancel')}` : undefined} onClick={() => setOpen(!open)}>
          {open ? t('common.cancel') : action ?? t('userProfile.manage')}
        </button>}
      </div>
      {open && <div id={bodyId} className={slot('ba-profile-row-body')}>{children}</div>}
    </section>
  );
}
