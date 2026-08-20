'use client';
import * as React from 'react';
import type { AuthActionResult } from '@authowl/core';
import { useServerError } from '../../i18n';

export type OrganizationListResource<T> = {
  data: T[] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/** Request-token-safe loader for organization-scoped list resources. */
export function useOrganizationListResource<T>({
  enabled,
  resourceKey,
  request,
  fallback,
  inactiveData = null,
}: {
  enabled: boolean;
  resourceKey: string | null;
  request: () => Promise<AuthActionResult<T[]>>;
  fallback: string;
  inactiveData?: T[] | null;
}): OrganizationListResource<T> {
  const toServerError = useServerError();
  const requestFn = React.useRef(request);
  requestFn.current = request;
  const [data, setData] = React.useState<T[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const requestToken = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const token = ++requestToken.current;
    if (!enabled || !resourceKey) {
      setData(inactiveData);
      setError(null);
      return;
    }
    setData(null);
    setError(null);
    try {
      const result = await requestFn.current();
      if (token !== requestToken.current) return;
      if (result.error) {
        setError(toServerError(result.error, fallback));
        return;
      }
      setData(result.data ?? []);
    } catch {
      if (token === requestToken.current) setError(fallback);
    }
  }, [enabled, fallback, inactiveData, resourceKey, toServerError]);

  React.useEffect(() => {
    void refresh();
    return () => {
      requestToken.current += 1;
    };
  }, [refresh]);

  return { data, isLoading: data === null && error === null, error, refresh };
}
