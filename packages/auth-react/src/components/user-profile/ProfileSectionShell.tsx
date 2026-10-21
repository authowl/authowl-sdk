'use client';
import * as React from 'react';
import { useSlot } from '../../elements';
import { useT, type MessageKey } from '../../i18n';
import { codeIconAttributes } from '../factor-icons';
import { BackupCodesCloseGuard } from '../BackupCodesCloseGuard';
import type { UserProfileSection } from './model';

export const ProfileDisclosureContext = React.createContext<{ requested?: { section: UserProfileSection }; closeVersion: number }>({ closeVersion: 0 });

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

export function ProfileIcon({ section, success = false }: { section: UserProfileSection; success?: boolean }) {
  const slot = useSlot();
  return <span className={slot(`ba-profile-icon${success ? ' ba-profile-icon-success' : ''}`)} aria-hidden="true">
    <svg className={slot('ba-profile-icon-svg')} {...codeIconAttributes}>
      <path d={ICON_PATHS[section]} />
    </svg>
  </span>;
}

/** One section landmark and focus target, shared by disclosures and lists. */
export function ProfileSectionShell({ section, title, children, list = false }: {
  section: UserProfileSection; title: string; list?: boolean;
  children: React.ReactNode | ((heading: React.ReactNode, titleId: string) => React.ReactNode);
}) {
  const slot = useSlot();
  const titleId = React.useId();
  const heading = <h2 id={titleId} tabIndex={-1} className={slot(list ? 'ba-profile-section-title' : 'ba-profile-row-title')}>{title}</h2>;
  return <section className={slot(list ? 'ba-profile-section ba-profile-section-list' : 'ba-profile-section')} data-profile-section={section} aria-labelledby={titleId}>
    {list && heading}
    {typeof children === 'function' ? children(heading, titleId) : children}
  </section>;
}

/** Every summary or list entry has one icon, copy block and action. */
export function ProfileRow({ section, title, meta, action, badge, success }: {
  section: UserProfileSection; title: React.ReactNode; meta: React.ReactNode;
  action?: React.ReactNode; badge?: React.ReactNode; success?: boolean;
}) {
  const slot = useSlot();
  return <div className={slot('ba-profile-row')}>
    <ProfileIcon section={section} success={success} />
    <div className={slot('ba-profile-row-copy')}>
      <div className={slot('ba-profile-row-heading')}>{typeof title === 'string' ? <strong className={slot('ba-profile-row-title')}>{title}</strong> : title}{badge}</div>
      <span className={slot('ba-profile-row-meta')}>{meta}</span>
    </div>
    {action}
  </div>;
}

const SECTION_ROWS = {
  password: { title: 'userProfile.password.title', meta: 'userProfile.password.description' },
  passkeys: { title: 'userProfile.passkeys.title', meta: 'userProfile.passkeys.description' },
  recovery: { title: 'userProfile.recovery.title', meta: 'userProfile.recovery.description' },
  privacy: { title: 'privacy.title', meta: 'privacy.description' },
  danger: { title: 'userProfile.delete.title', meta: 'userProfile.delete.description', action: 'userProfile.delete.title' },
} satisfies Partial<Record<UserProfileSection, { title: MessageKey; meta: MessageKey; action?: MessageKey }>>;

/** Children mount only for the lifetime of an opened security workflow. */
export function ProfileSectionDisclosure({ section, title, meta, action, children, success }: {
  section: UserProfileSection; title?: string; meta?: React.ReactNode; action?: string;
  children?: React.ReactNode; success?: boolean;
}) {
  const slot = useSlot();
  const t = useT();
  const request = React.useContext(ProfileDisclosureContext);
  const [open, setOpen] = React.useState(request.requested?.section === section);
  const [codesVisible, setCodesVisible] = React.useState(false);
  const bodyId = React.useId();
  const closeReasonId = React.useId();
  const previousClose = React.useRef(request.closeVersion);
  React.useEffect(() => {
    if (previousClose.current !== request.closeVersion) setOpen(false);
    else if (request.requested?.section === section) setOpen(true);
    previousClose.current = request.closeVersion;
  }, [request.requested, request.closeVersion, section]);
  const row = section in SECTION_ROWS ? SECTION_ROWS[section as keyof typeof SECTION_ROWS] : undefined;
  const label = title ?? (row ? t(row.title) : '');
  return <ProfileSectionShell section={section} title={label}>
    {(heading, titleId) => <>
      <ProfileRow section={section} title={heading} meta={meta ?? (row && t(row.meta))} success={success}
        badge={success ? <span className={slot('ba-profile-pill ba-profile-pill-success')}>{t('privacy.on')}</span> : undefined}
        action={children && <button type="button" className={slot('ba-profile-row-button')} disabled={open && codesVisible} aria-expanded={open} aria-controls={bodyId} aria-describedby={open && codesVisible ? `${titleId} ${closeReasonId}` : titleId} aria-label={open ? `${label}: ${t('common.close')}` : undefined} onClick={() => setOpen(!open)}>
          {open ? t('common.close') : action ?? (row && 'action' in row ? t(row.action) : t('userProfile.manage'))}
        </button>} />
      {open && codesVisible && <p id={closeReasonId} className={slot('ba-muted')}>{t('mfa.enroll.backupCodesWarningStrong')}</p>}
      {open && <div id={bodyId} className={slot('ba-profile-row-body')}><BackupCodesCloseGuard.Provider value={setCodesVisible}>{children}</BackupCodesCloseGuard.Provider></div>}
    </>}
  </ProfileSectionShell>;
}
