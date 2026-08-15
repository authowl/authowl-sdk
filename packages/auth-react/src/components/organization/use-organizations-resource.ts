'use client';
import * as React from 'react';
import type { Organization } from '@authowl/core';
import { useAuthClient, useUser } from '../../hooks';
import { useServerError, useT } from '../../i18n';

export type OrganizationsResource = {
  organizations: Organization[] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/** Identity-safe organization list loader shared by list and switcher surfaces. */
export function useOrganizationsResource(enabled = true): OrganizationsResource {
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const { user, isLoaded, isSignedIn } = useUser();
  const t = useT();
  const toServerError = useServerError();
  const [organizations, setOrganizations] = React.useState<Organization[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);
  const identity = user?.id ?? null;

  const refresh = React.useCallback(async () => {
    const token = ++requestRef.current;
    if (!enabled || !identity || !isSignedIn) {
      setOrganizations([]);
      setError(null);
      return;
    }
    try {
      const result = await apiRef.current.list();
      if (token !== requestRef.current) return;
      if (result.error) {
        setError(toServerError(result.error, t('organization.error.load')));
        return;
      }
      setError(null);
      setOrganizations(result.data ?? []);
    } catch {
      if (token === requestRef.current) setError(t('organization.error.load'));
    }
  }, [enabled, identity, isSignedIn, t, toServerError]);

  React.useEffect(() => {
    setOrganizations(null);
    setError(null);
    if (!isLoaded) return;
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [identity, isLoaded, refresh]);

  return {
    organizations,
    isLoading: !isLoaded || (organizations === null && error === null),
    error,
    refresh,
  };
}
