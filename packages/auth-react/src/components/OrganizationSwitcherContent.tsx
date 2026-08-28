'use client';
import * as React from 'react';
import type { Organization } from '@authowl/core';
import { useAuthClient, usePublicConfig, useSession, useUser } from '../hooks';
import { useT } from '../i18n';
import { CreateOrganization } from './CreateOrganization';
import { OrganizationModal } from './organization/OrganizationModal';
import { useOrganizationsResource } from './organization/use-organizations-resource';
import { OrganizationProfile } from './OrganizationProfile';
import { useSubmitAction } from './use-submit-action';
import { FormError } from './FormError';

export type OrganizationSwitcherContentProps = {
  showPersonalWorkspace?: boolean;
  onOrganizationChange?: (organization: Organization | null) => void;
};

export function OrganizationSwitcherContent({ showPersonalWorkspace = true, onOrganizationChange }: OrganizationSwitcherContentProps = {}) {
  const t = useT();
  const { config, isLoading: configLoading } = usePublicConfig();
  const { isLoaded, isSignedIn } = useUser();
  const session = useSession();
  const api = useAuthClient().organization;
  const enabled = config?.organizations === true && isSignedIn;
  const { organizations, isLoading, error: loadError, refresh } = useOrganizationsResource(enabled);
  const { pending, error, run } = useSubmitAction();
  const [open, setOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<'create' | 'profile' | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  const activeId = session.data?.session.activeOrganizationId ?? null;
  const active = organizations?.find((organization) => organization.id === activeId) ?? null;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (configLoading || !isLoaded) return <div className="ba-skeleton ba-organization-switcher-skeleton" aria-label={t('organization.loading')} />;
  if (config?.organizations !== true) return null;
  if (!isSignedIn) return <p className="ba-muted">{t('organization.signedOut')}</p>;

  const select = (organization: Organization | null) => {
    void run(
      () => api.setActive({ organizationId: organization?.id ?? null }),
      {
        failure: t('organization.switcher.error'),
        onSuccess: async () => {
          await session.refetch({ query: { disableCookieCache: true } });
          setOpen(false);
          onOrganizationChange?.(organization);
        },
      },
    );
  };

  const afterProfileRemoval = async () => {
    await refresh();
    await session.refetch({ query: { disableCookieCache: true } });
    setDialog(null);
  };

  const focusMenuItem = (position: 'first' | 'last') => {
    window.requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
      if (!items?.length) return;
      items[position === 'first' ? 0 : items.length - 1]?.focus();
    });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items.at(-1)?.focus();
    else if (event.key === 'ArrowDown') items[(current + 1 + items.length) % items.length]?.focus();
    else items[(current - 1 + items.length) % items.length]?.focus();
  };

  return (
    <>
      <div ref={rootRef} className="ba-organization-switcher">
        <button
          ref={triggerRef}
          className="ba-organization-switcher-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setOpen(true);
            focusMenuItem(event.key === 'ArrowDown' ? 'first' : 'last');
          }}
        >
          <span className="ba-organization-avatar" aria-hidden="true">{active?.name.trim().charAt(0).toUpperCase() || 'P'}</span>
          <span>{active?.name ?? t('organization.personal')}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <div ref={menuRef} id={menuId} className="ba-organization-menu" role="menu" aria-label={t('organization.switcher.label')} onKeyDown={onMenuKeyDown}>
            {isLoading ? <div className="ba-skeleton" /> : (
              <>
                {showPersonalWorkspace && (
                  <button className="ba-organization-menu-item" type="button" role="menuitem" aria-current={activeId === null ? 'true' : undefined} disabled={pending} onClick={() => select(null)}>
                    <span className="ba-organization-avatar" aria-hidden="true">P</span>
                    <span>{t('organization.personal')}</span>
                  </button>
                )}
                {organizations?.map((organization) => (
                  <button key={organization.id} className="ba-organization-menu-item" type="button" role="menuitem" aria-current={activeId === organization.id ? 'true' : undefined} disabled={pending} onClick={() => select(organization)}>
                    <span className="ba-organization-avatar" aria-hidden="true">{organization.name.trim().charAt(0).toUpperCase() || '?'}</span>
                    <span>{organization.name}<small>{organization.slug}</small></span>
                  </button>
                ))}
              </>
            )}
            {(loadError || error) && (
              <div className="ba-inline-error">
                <FormError>{loadError ?? error}</FormError>
                {loadError && <button className="ba-link-button" type="button" onClick={() => void refresh()}>{t('organization.retry')}</button>}
              </div>
            )}
            <div className="ba-organization-menu-actions">
              {active && <button className="ba-menu-item" type="button" role="menuitem" onClick={() => { setOpen(false); setDialog('profile'); }}>{t('organization.switcher.manage')}</button>}
              <button className="ba-menu-item" type="button" role="menuitem" onClick={() => { setOpen(false); setDialog('create'); }}>{t('organization.switcher.create')}</button>
            </div>
          </div>
        )}
      </div>
      {dialog === 'create' && (
        <OrganizationModal title={t('organization.create.title')} returnFocusRef={triggerRef} onClose={() => setDialog(null)}>
          <CreateOrganization
            title={null}
            onCreated={(organization) => {
              void (async () => {
                await refresh();
                await session.refetch({ query: { disableCookieCache: true } });
                setDialog(null);
                onOrganizationChange?.(organization);
              })();
            }}
          />
        </OrganizationModal>
      )}
      {dialog === 'profile' && active && (
        <OrganizationModal title={t('organization.profile.title')} returnFocusRef={triggerRef} onClose={() => setDialog(null)}>
          <OrganizationProfile organizationId={active.id} onDeleted={() => void afterProfileRemoval()} onLeft={() => void afterProfileRemoval()} />
        </OrganizationModal>
      )}
    </>
  );
}
